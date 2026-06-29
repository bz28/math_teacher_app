"use client";

/**
 * Reusable horizontal progress bar for homework cards.
 * Shows "label current/total" with a colored fill bar.
 *
 * Handles edge cases:
 * - 0/0 → hidden (returns null)
 * - current > total → clamps fill to 100%
 */
export function ProgressBar({
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
  // Route fills through semantic design tokens so the bar tracks the
  // warm-paper palette and the [data-theme="dark"] overrides — the old
  // bg-green-500/bg-blue-500 + `dark:` classes were orphaned from both.
  const fillClass =
    color === "green"
      ? "bg-[color:var(--color-success)]"
      : color === "amber"
        ? "bg-[color:var(--color-warning)]"
        : "bg-[color:var(--color-info)]";

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
