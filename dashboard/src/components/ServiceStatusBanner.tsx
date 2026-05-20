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

const getSnapshot = () => apiHealth.isDown();

export default function ServiceStatusBanner() {
  const down = useSyncExternalStore(apiHealth.subscribe, getSnapshot);
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
            <strong style={{ fontWeight: 600 }}>Can't reach the backend.</strong>{" "}
            <span style={{ color: "var(--ink-soft)" }}>
              Either Railway is down or the service is restarting — check{" "}
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
