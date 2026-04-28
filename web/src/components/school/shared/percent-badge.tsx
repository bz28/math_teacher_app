/**
 * Shared percent badge for grade UIs (teacher + student).
 *
 * Color-tone thresholds are centralized here so "what counts as
 * struggling" is one knob to turn.
 *
 * - percent === null  → muted em-dash (roster case: no graded HWs yet)
 * - percent >= STRONG_THRESHOLD     → green
 * - percent >= STRUGGLING_THRESHOLD → neutral
 * - percent < STRUGGLING_THRESHOLD  → red
 */

/** Above this is "strong" (green). */
export const STRONG_THRESHOLD = 85;
/** At or above this is "ok"; below is "struggling" (red). */
export const STRUGGLING_THRESHOLD = 70;

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

/** Tailwind color classes for a percent score. Exported so other
 *  surfaces (Grades tab class summary, distribution chips) match
 *  PercentBadge's tone thresholds without redefining them. */
export function percentTone(percent: number): string {
  if (percent >= STRONG_THRESHOLD) return "text-green-700 dark:text-green-400";
  if (percent >= STRUGGLING_THRESHOLD) return "text-text-primary";
  return "text-red-700 dark:text-red-400";
}
