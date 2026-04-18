/**
 * Shared percent badge for grade UIs (teacher + student).
 *
 * Color-tone thresholds are centralized here so "what counts as
 * struggling" is one knob to turn.
 *
 * - percent === null  → muted em-dash (roster case: no graded HWs yet)
 * - percent >= 85     → green
 * - percent >= 70     → neutral
 * - percent < 70      → red
 */
export function PercentBadge({
  percent,
  size = "sm",
  className,
}: {
  percent: number | null;
  /** Visual scale. "sm" for dense tables; "lg" for featured scores. */
  size?: "sm" | "lg";
  className?: string;
}) {
  if (percent === null) {
    return <span className={`text-xs text-text-muted ${className ?? ""}`}>—</span>;
  }
  const rounded = Math.round(percent);
  const tone = percentTone(rounded);
  const sizeCls = size === "lg" ? "text-lg font-bold" : "text-sm font-bold";
  return (
    <span className={`${sizeCls} ${tone} ${className ?? ""}`}>{rounded}%</span>
  );
}

function percentTone(percent: number): string {
  if (percent >= 85) return "text-green-700 dark:text-green-400";
  if (percent >= 70) return "text-text-primary";
  return "text-red-700 dark:text-red-400";
}
