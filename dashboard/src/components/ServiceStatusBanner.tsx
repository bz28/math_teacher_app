import { useSyncExternalStore } from "react";
import { apiHealth } from "../lib/api";

// Fixed-position banner shown at the top of the admin portal whenever
// the API client has hit a NetworkError (backend unreachable, CORS
// preflight against a dead container, DNS, timeout). Mounted once at
// the App root so it surfaces on both the login page and inside the
// authenticated shell. Cleared automatically when any request comes
// back from the server — even a 5xx counts as "reachable."
//
// useSyncExternalStore keeps React subscribed to the apiHealth flag
// without the setState-in-effect cascading-render footgun.
//
// ── On not naming a cause we can't observe ──
//
// This banner used to read "Either Railway is down or the service is
// restarting — check Railway status." The client cannot know that. All
// it observed was a `fetch` that never got a response, which is equally
// consistent with the operator's wifi dropping, DNS, a VPN, a captive
// portal, or a bad API base URL. Naming Railway sent an operator to a
// status page that was green and cost them the actual diagnosis.
//
// So the copy now states the observation ("no response") and offers
// both branches, with the one thing the browser genuinely does know
// promoted to its own case: `navigator.onLine === false` is reliable
// in the negative direction — if the browser says it has no network,
// it doesn't. (The reverse is not true, which is why "online" still
// gets the ambiguous message rather than a confident "it's the server".)

const getSnapshot = () => apiHealth.isDown();

// Browser connectivity, as an external store so the banner re-renders
// the moment the machine goes offline or comes back.
const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};
const getOnlineSnapshot = () => navigator.onLine;

export default function ServiceStatusBanner() {
  const down = useSyncExternalStore(apiHealth.subscribe, getSnapshot);
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot);
  if (!down) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: "var(--accent-soft)",
        borderBottom: "1px solid var(--accent)",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              flex: "none",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--accent)",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {online ? (
              <>
                <strong style={{ fontWeight: 600 }}>No response from the backend.</strong>{" "}
                <span style={{ color: "var(--ink-soft)" }}>
                  This is either your connection or the service itself — if
                  other sites load, check{" "}
                  <a
                    href="https://status.railway.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)", textDecoration: "underline" }}
                  >
                    Railway status
                  </a>
                  .
                </span>
              </>
            ) : (
              <>
                <strong style={{ fontWeight: 600 }}>You're offline.</strong>{" "}
                <span style={{ color: "var(--ink-soft)" }}>
                  Reconnect and the console will pick up where it left off.
                </span>
              </>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            flex: "none",
            background: "var(--surface)",
            border: "1px solid var(--accent)",
            color: "var(--accent)",
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            cursor: "pointer",
            borderRadius: 2,
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
