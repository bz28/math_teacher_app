"use client";

import { cn } from "@/lib/utils";

/**
 * Shared pill-shaped chip used across the teacher portal for unit
 * picking (single- and multi-select), quantity options, and similar
 * "tap to toggle" choices.
 *
 * Variants:
 *   - solid (default): real choice; primary fill when selected.
 *   - dashed: fallback choice ("Uncategorized", "None", etc.);
 *     dashed outline, neutral fill when selected.
 *
 * `hint` renders a compact inline badge inside the chip — used for
 * things like the auto-pick indicator in the Save-to picker. Keep it
 * short (1–2 words).
 */
export function SelectableChip({
  label,
  selected,
  onToggle,
  disabled = false,
  variant = "solid",
  hint,
  className,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  variant?: "solid" | "dashed";
  hint?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-[--radius-pill] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50";

  let tone: string;
  if (variant === "dashed") {
    tone = selected
      ? "border border-dashed border-text-muted bg-bg-subtle text-text-primary"
      : "border border-dashed border-text-muted/40 bg-transparent text-text-muted hover:bg-bg-subtle";
  } else {
    tone = selected
      ? "border border-primary bg-primary text-white"
      : "border border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle";
  }

  // Hint badge tone has to match its background so the tiny label
  // stays readable. Solid+selected sits on a primary fill (white
  // label on a translucent-white badge); dashed+selected sits on a
  // muted fill (primary-colored badge on surface) — same logic as
  // the unselected case for dashed since the background doesn't
  // darken as much.
  const hintTone =
    variant === "solid" && selected
      ? "bg-white/20 text-white"
      : "bg-primary-bg text-primary";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(base, tone, className)}
    >
      {selected && <span aria-hidden>✓</span>}
      <span>{label}</span>
      {hint && (
        <span
          className={cn(
            "ml-0.5 rounded-[--radius-pill] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            hintTone,
          )}
        >
          {hint}
        </span>
      )}
    </button>
  );
}
