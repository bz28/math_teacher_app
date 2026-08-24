/**
 * Client-error reporter.
 *
 * Before this existed, `ErrorBoundary.componentDidCatch` logged to the
 * console in development and DROPPED the error in production — so a crash
 * in a real teacher's browser produced a retry card for her and silence
 * for us. This ships those reports to `POST /v1/client-errors`.
 *
 * It runs inside a page that is already broken, which dictates every
 * design choice here:
 *
 * - **Never throws.** Every path is wrapped. A reporter that breaks while
 *   reporting turns one visible bug into two invisible ones.
 * - **Never recurses.** It uses bare `fetch` (never `apiFetch`) and
 *   swallows its own rejection, so a failed report can't reach
 *   window.onerror or unhandledrejection and report itself. Without both,
 *   wiring `apiFetch` failures to the reporter would loop forever the
 *   moment the API goes down — exactly when it fires. Note there is
 *   deliberately NO in-flight lock: two distinct errors firing at once
 *   must BOTH be reported, and a lock would silently drop the second.
 * - **De-dupes per page load.** A render crash-loop can fire hundreds of
 *   times a second. Each distinct fingerprint is sent once per load; the
 *   server's rate limit is the backstop, not the primary defence.
 * - **Fire and forget.** Nothing awaits it and nothing surfaces to the
 *   user. A failed report is simply lost — the alternative is an error
 *   dialog about the error dialog.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/v1";

// Where the report came from. Mirrors api.models.client_error.VALID_KINDS.
export type ClientErrorKind = "render" | "unhandled" | "promise" | "api";

interface ReportInput {
  kind: ClientErrorKind;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  context?: Record<string, unknown>;
}

// Fingerprints already sent this page load. Cleared by navigation, which
// is the right lifetime: a crash that recurs after a reload is genuinely
// new information ("it's still broken"), while the same crash firing in a
// render loop is not.
const seen = new Set<string>();

// Hard ceiling per page load, in case fingerprinting somehow varies per
// occurrence (a stack containing a timestamp or a random id would defeat
// the Set). Cheap insurance against flooding the table from one browser.
const MAX_PER_LOAD = 25;
let sentCount = 0;

// `keepalive` requests are capped at 64KB of body by the browser, and a
// request that exceeds it fails SILENTLY — which is precisely the failure
// mode this module exists to remove. So truncate client-side rather than
// relying on the server's caps, which only apply once the body arrives.
// These mirror api.models.client_error and leave ample headroom.
const MAX_MESSAGE = 2_000;
const MAX_STACK = 12_000;

function clip(v: string | null | undefined, limit: number): string | null {
  if (!v) return null;
  return v.length <= limit ? v : `${v.slice(0, limit)}\n…[truncated]`;
}

/**
 * Stable-ish id for "the same crash". Message plus the first few stack
 * frames: enough that two different bugs don't collide, few enough frames
 * that the same bug reached by slightly different paths still groups.
 * Not cryptographic — it only has to be consistent within a deployment.
 */
function fingerprint(message: string, stack?: string | null): string {
  const frames = (stack ?? "").split("\n").slice(0, 3).join("\n");
  const basis = `${message}\n${frames}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

/** Read the access token without importing api.ts (which imports this). */
function accessToken(): string | null {
  try {
    return localStorage.getItem("veradic_access_token");
  } catch {
    return null;
  }
}

export function reportClientError(input: ReportInput): void {
  try {
    if (typeof window === "undefined") return; // SSR — nothing to report
    if (sentCount >= MAX_PER_LOAD) return;

    const message = String(input.message ?? "").slice(0, MAX_MESSAGE);
    if (!message) return;

    const fp = fingerprint(message, input.stack);
    if (seen.has(fp)) return;
    seen.add(fp);
    sentCount += 1;

    const token = accessToken();

    // `keepalive` so a report started during a navigation (or an unload
    // triggered BY the crash) still leaves the browser.
    void fetch(`${BASE_URL}/client-errors`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        kind: input.kind,
        message,
        fingerprint: fp,
        stack: clip(input.stack, MAX_STACK),
        component_stack: clip(input.componentStack, MAX_STACK),
        // Path only — the query string can carry ids we don't want in a
        // crash log, and the route is what actually locates the bug.
        route: window.location.pathname,
        context: input.context ?? null,
      }),
    })
      .catch(() => {
        // Deliberately silent, and load-bearing: swallowing here is what
        // makes recursion impossible. A rejected report never reaches
        // window.onerror or unhandledrejection, so it cannot report its
        // own failure. Combined with using bare `fetch` (never apiFetch),
        // there is no path back into this function.
      });
  } catch {
    // Belt and braces: localStorage can throw in private mode, JSON can
    // throw on a circular context. Neither may break the page.
  }
}

/**
 * Install the two global listeners. Called once from the app shell.
 * Returns a teardown so a remount doesn't stack duplicate listeners.
 */
export function installGlobalErrorReporting(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent) => {
    reportClientError({
      kind: "unhandled",
      message: event.message || String(event.error ?? "Unknown error"),
      stack: event.error instanceof Error ? event.error.stack : null,
      context: { source: event.filename, line: event.lineno, col: event.colno },
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportClientError({
      kind: "promise",
      message:
        reason instanceof Error
          ? reason.message
          : String(reason ?? "Unhandled promise rejection"),
      stack: reason instanceof Error ? reason.stack : null,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
