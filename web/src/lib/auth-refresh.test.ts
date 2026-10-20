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
// Node has no window events; capture the cross-tab `storage` listener.
let storageListener: ((e: { key: string | null }) => void) | null = null;
(globalThis as unknown as { addEventListener: unknown }).addEventListener = (
  type: string,
  fn: (e: { key: string | null }) => void,
) => {
  if (type === "storage") storageListener = fn;
};

/** `during` runs as the request lands — e.g. another tab writing storage. */
type Reply = { status: number; body?: unknown; during?: () => void };

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
  next.during?.();
  return reply(next.status, next.body);
};

const { auth, schoolStudent, saveTokens, clearTokens, isCredentialPath, onSessionEnded, ApiError } =
  await import("./api.ts");

let sessionEndings = 0;
onSessionEnded(() => {
  sessionEndings++;
});

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
  sessionEndings = 0;
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

// ── A session that ends mid-use says so ───────────────────────────
//
// Prod, 2026-10-18: a teacher's stored tokens were wiped by another tab
// while the review page stayed open. Every grade save, report and
// approve after that failed with "Not authenticated" — 16 requests —
// and nothing told her she had been signed out.

test("a rejected refresh announces the session ended", async () => {
  saveTokens(TOKENS);
  script = { "/auth/me": [{ status: 401 }], "/auth/refresh": [{ status: 401 }] };

  await assert.rejects(() => auth.me());

  assert.equal(sessionEndings, 1);
});

test("tokens wiped elsewhere end the session on the next request", async () => {
  // The prod case: no token is sent, the 401 can't be refreshed.
  script = { "/auth/me": [{ status: 401, body: { detail: "Not authenticated" } }] };

  await assert.rejects(() => auth.me());

  assert.deepEqual(calls, ["GET /auth/me"]); // nothing to refresh with
  assert.equal(sessionEndings, 1);
});

test("a transient refresh failure does not end the session", async () => {
  saveTokens(TOKENS);
  script = { "/auth/me": [{ status: 401 }], "/auth/refresh": [{ status: 503 }] };

  await assert.rejects(() => auth.me());

  assert.equal(sessionEndings, 0);
});

test("a refresh rejected after another tab signed in keeps the newer session", async () => {
  // This tab's refresh token is rejected, but while the request was in
  // flight another tab stored a fresh session. Wiping storage now would
  // sign that tab out too; replay on the newer token instead.
  saveTokens(TOKENS);
  script = {
    "/auth/me": [{ status: 401 }, { status: 200, body: { id: "u1" } }],
    "/auth/refresh": [{
      status: 401,
      during: () =>
        saveTokens({ access_token: "access_other", refresh_token: "refresh_other", token_type: "bearer" }),
    }],
  };

  const me = await auth.me();

  assert.deepEqual(me, { id: "u1" });
  assert.equal(accessToken(), "access_other");
  assert.equal(sessionEndings, 0);
});

test("signing out in another tab ends the session here", () => {
  saveTokens(TOKENS);
  clearTokens(); // what the other tab did; `storage` fires only over here
  storageListener!({ key: "veradic_access_token" });
  assert.equal(sessionEndings, 1);
});

test("another tab rotating the token does not end the session here", () => {
  saveTokens({ access_token: "access_2", refresh_token: "refresh_2", token_type: "bearer" });
  storageListener!({ key: "veradic_access_token" });
  storageListener!({ key: "veradic_refresh_token" });
  assert.equal(sessionEndings, 0);
});

test("a refresh with no token doesn't jam later refreshes in this tab", async () => {
  // The prod root cause. Tokens gone → refresh rejected (correct). The
  // user signs in again in the same tab; 15 minutes later the access
  // token lapses and the refresh MUST reach the server.
  script = { "/auth/me": [{ status: 401 }] };
  await assert.rejects(() => auth.me());

  saveTokens(TOKENS); // signed in again, no page reload
  calls = [];
  script = {
    "/auth/me": [{ status: 401 }, { status: 200, body: { id: "u1" } }],
    "/auth/refresh": [{
      status: 200,
      body: { access_token: "access_2", refresh_token: "refresh_2", token_type: "bearer" },
    }],
  };

  assert.deepEqual(await auth.me(), { id: "u1" });
  assert.deepEqual(calls, ["GET /auth/me", "POST /auth/refresh", "GET /auth/me"]);
  assert.equal(accessToken(), "access_2");
});
