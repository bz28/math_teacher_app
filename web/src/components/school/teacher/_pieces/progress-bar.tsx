"use client";

/**
 * Labeled horizontal progress bar for the homework Submissions inbox.
 * Renders "label current/total" with a colored fill bar.
 *
 * Distinct from the value-based `ProgressBar` in
 * `components/shared/progress-bar.tsx` — this one takes label + count
 * fractions; the shared one takes a single percent value.
 *
 * Handles edge cases:
 * - 0/0 → hidden (returns null)
 * - current > total → clamps fill to 100%
 */
export function LabeledProgressBar({
  label,
  current,
  total,
  color = "blue",
}: {
  label: string;
  current: number;
  total: number;
  color?: "blue" | "green" | "amber";
}) {
  if (total === 0) return null;

  const pct = Math.min(100, Math.round((current / total) * 100));
  const fillClass =
    color === "green"
      ? "bg-green-500 dark:bg-green-400"
      : color === "amber"
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-blue-500 dark:bg-blue-400";

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] text-text-muted">{label}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border-light">
        <div
          className={`h-full rounded-full transition-all ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-text-secondary">
        {current}/{total}
      </span>
    </div>
  );
}
