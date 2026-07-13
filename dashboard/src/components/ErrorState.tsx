/**
 * Distinct load-failure panel with a Retry action.
 *
 * Used by pages that gate their whole render behind a single fetch
 * (Overview, LLMCalls, Quality) and by pages whose empty state is
 * otherwise indistinguishable from a failed load (Leads). Without
 * this, a 4xx/5xx either freezes on "Loading…" forever or masquerades
 * as an empty result — this makes the failure honest and recoverable
 * without a full page reload.
 *
 * Mirrors the Operator's Console palette: same danger tokens as the
 * inline `.error` text and the same Retry treatment as
 * ServiceStatusBanner.
 */
export default function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: "56px 0",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 20,
          color: "var(--danger)",
        }}
      >
        Couldn't load this view.
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: "var(--muted)",
          maxWidth: 420,
          overflowWrap: "anywhere",
        }}
      >
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--danger)",
          color: "var(--danger)",
          padding: "7px 18px",
          fontFamily: "var(--font-sans)",
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          cursor: "pointer",
          borderRadius: 2,
        }}
      >
        Retry
      </button>
    </div>
  );
}
