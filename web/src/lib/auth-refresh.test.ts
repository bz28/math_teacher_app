// Unit tests for the 401 → refresh → replay path in apiFetch.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node --experimental-strip-types src/lib/auth-refresh.test.ts
//
// The regression this file exists for: the refresh branch was gated on
// `!path.startsWith("/auth/")`. The intent was right — a 401 from
// /auth/login means a wrong password, and retrying it is pointless — but
// the prefix also swallowed /auth/me, which is an ordinary
// session-authenticated endpoint that merely lives under the same
// prefix. AuthProvider calls /auth/me on every mount AND every tab
// focus, so ~15 minutes after sign-in the next focus event returned a
// 401 that never attempted a refresh; the caller then cleared both
// tokens and bounced the student to /login mid-homework. Their
// week-long refresh token was discarded without ever being used.
//
// Production signature before the fix: 87 of 90 sessions created in a
// single day never rotated once, and students signed in 6-12x/day.
//
// The second guarantee here is the retry bound. The success path is
// `return apiFetch(path, options, true)` — a recursive replay. Without
// the `retried` flag, an endpoint that keeps 401ing after a SUCCESSFUL
// refresh recurses forever, re-refreshing every lap. That was dormant
// only because /auth/me could never enter the branch; widening the
// branch is precisely what would have woken it.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;
(globalThis as unknown as { window: unknown }).window = globalThis;

type Reply = { status: number; body?: unknown };

/** Requests seen by the mock, in order, as "METHOD /path". */
let calls: string[] = [];
/** Path suffix → queue of replies; the last reply repeats once drained. */
let script: Record<string, Reply[]> = {};

function reply(status: number, body: unknown = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

(globalThis as unknown as { fetch: unknown }).fetch = async (
  url: string,
  init?: RequestInit,
): Promise<Response> => {
  const path = url.replace(/^.*?\/v1/, "").replace(/^https?:\/\/[^/]+/, "");
  calls.push(`${init?.method ?? "GET"} ${path}`);
  const queue = script[path];
  if (!queue || queue.length === 0) return reply(404, { detail: "unscripted" });
  const next = queue.length > 1 ? queue.shift()! : queue[0];
  return reply(next.status, next.body);
};

const { auth, schoolStudent, saveTokens, isCredentialPath, ApiError } =
  await import("./api.ts");

const TOKENS = {
  access_token: "access_1",
  refresh_token: "refresh_1",
  token_type: "bearer",
};
const accessToken = () => localStorage.getItem("veradic_access_token");
const refreshToken = () => localStorage.getItem("veradic_refresh_token");

beforeEach(() => {
  store.clear();
  calls = [];
  script = {};
});

// ── Classification ────────────────────────────────────────────────

test("credential endpoints are the only /auth/ paths exempt from refresh", () => {
  // A 401 here really does mean "wrong credentials".
  for (const p of [
    "/auth/login",
    "/auth/login/verify-mfa", // prefix-covered by /auth/login
    "/auth/register",
    "/auth/refresh",
    "/auth/check-email",
    "/auth/forgot-password",
    "/auth/set-password",
  ]) {
    assert.equal(isCredentialPath(p), true, `${p} should be a credential path`);
  }

  // These are session-authenticated and MUST refresh. /auth/me is the
  // one that caused the outage.
  for (const p of [
    "/auth/me",
    "/auth/me/tour-seen",
    "/auth/entitlements",
    "/auth/enrolled-courses",
    "/auth/invite/section/claim",
    "/auth/account",
    "/school/student/classes",
  ]) {
    assert.equal(isCredentialPath(p), false, `${p} must go through refresh`);
  }
});

// ── The regression ────────────────────────────────────────────────

test("an expired access token on /auth/me refreshes and replays instead of logging out", async () => {
  // Fails on the commit this file was added to fix: /auth/me matched
  // the old `startsWith("/auth/")` gate, so no refresh was attempted
  // and the caller cleared both tokens.
  saveTokens(TOKENS);
  script = {
    "/auth/me": [{ status: 401 }, { status: 200, body: { id: "u1" } }],
    "/auth/refresh": [
      {
        status: 200,
        body: {
          access_token: "access_2",
          refresh_token: "refresh_2",
          token_type: "bearer",
        },
      },
    ],
  };

  const me = await auth.me();

  assert.deepEqual(me, { id: "u1" });
  assert.deepEqual(calls, [
    "GET /auth/me", // 401, token lapsed
    "POST /auth/refresh", // swap in a fresh one
    "GET /auth/me", // replay, succeeds
  ]);
  // Still signed in, now on the rotated pair.
  assert.equal(accessToken(), "access_2");
  assert.equal(refreshToken(), "refresh_2");
});

test("a 401 from a credential endpoint does not burn a refresh", async () => {
  saveTokens(TOKENS);
  script = { "/auth/login": [{ status: 401, body: { detail: "bad password" } }] };

  await assert.rejects(
    () => auth.login("a@b.com", "wrong"),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );

  assert.deepEqual(calls, ["POST /auth/login"]);
});

// ── Retry bound ───────────────────────────────────────────────────

test("a 401 that survives a successful refresh terminates instead of looping", async () => {
  // Revoked token, deactivated user, downgraded role: refresh keeps
  // succeeding while the endpoint keeps rejecting. Must be exactly one
  // refresh and one replay, then give up.
  saveTokens(TOKENS);
  script = {
    "/auth/me": [{ status: 401 }], // last reply repeats — always 401
    "/auth/refresh": [
      {
        status: 200,
        body: {
          access_token: "access_2",
          refresh_token: "refresh_2",
          token_type: "bearer",
        },
      },
    ],
  };

  await assert.rejects(
    () => auth.me(),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );

  assert.deepEqual(calls, [
    "GET /auth/me",
    "POST /auth/refresh",
    "GET /auth/me", // one replay only — no second refresh
  ]);
});

test("the retry bound also holds for endpoints that always refreshed", async () => {
  // /school/student/* was never covered by the old `/auth/` gate, so it
  // has always been able to reach the recursive replay — the replay is
  // unbounded by inspection, and this scenario drives it. The assertion
  // is the call list; the fact that this test RETURNS at all is the
  // other half of the guarantee.
  saveTokens(TOKENS);
  script = {
    "/school/student/classes": [{ status: 401 }],
    "/auth/refresh": [
      {
        status: 200,
        body: {
          access_token: "access_2",
          refresh_token: "refresh_2",
          token_type: "bearer",
        },
      },
    ],
  };

  await assert.rejects(
    () => schoolStudent.listClasses(),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );

  assert.deepEqual(calls, [
    "GET /school/student/classes",
    "POST /auth/refresh",
    "GET /school/student/classes",
  ]);
});

// ── Genuine expiry still logs out ─────────────────────────────────

test("a rejected refresh clears both tokens", async () => {
  // The refresh token really is dead (past 7 days, or reuse detected).
  // This is the one case where logging the student out is correct.
  saveTokens(TOKENS);
  script = {
    "/auth/me": [{ status: 401 }],
    "/auth/refresh": [{ status: 401 }],
  };

  await assert.rejects(
    () => auth.me(),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );

  assert.equal(accessToken(), null);
  assert.equal(refreshToken(), null);
});

test("a transient refresh failure leaves tokens intact", async () => {
  // A 5xx from /auth/refresh is not proof the session is over; keeping
  // the tokens lets the next attempt succeed without a re-login.
  saveTokens(TOKENS);
  script = {
    "/auth/me": [{ status: 401 }],
    "/auth/refresh": [{ status: 503 }],
  };

  await assert.rejects(
    () => auth.me(),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );

  assert.equal(accessToken(), "access_1");
  assert.equal(refreshToken(), "refresh_1");
});
