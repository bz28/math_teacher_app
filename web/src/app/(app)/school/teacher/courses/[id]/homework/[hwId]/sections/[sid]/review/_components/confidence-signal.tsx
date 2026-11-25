import { confidenceBand } from "../_lib/grading";

// Always-on AI confidence indicator for a single grade. Reads the
// pipeline's calibrated value — never computes or mutates it. Null
// (historical, pre-confidence rows) renders nothing so those stay
// neutral. Low keeps the loud amber pill it always had; high/medium are
// deliberately quiet (a hairline dot + muted label) so a teacher
// grading 30 papers is only pulled toward the uncertain calls.
export function ConfidenceSignal({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const band = confidenceBand(confidence);
  const pct = Math.round(confidence * 100);

  if (band === "low") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-warning-dark)] dark:bg-[color:var(--color-warning)]/10"
        title={`AI reported low confidence (${pct}%) — review this one carefully`}
      >
        <span aria-hidden>⚠</span>
        Low confidence · {pct}%
      </span>
    );
  }

  const dotClass =
    band === "high"
      ? "bg-[color:var(--color-success)]"
      : "bg-[color:var(--color-warning)]";
  const label = band === "high" ? "High" : "Medium";
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted"
      title={`AI grading confidence: ${label.toLowerCase()} (${pct}%)`}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`}
      />
      AI · {label} {pct}%
    </span>
  );
}
