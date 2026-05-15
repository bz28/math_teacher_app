import { ReactNode } from "react";

type EyebrowProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "invert";
};

/**
 * Small-caps eyebrow above headlines. Dashboard-parity: 11px / 600 /
 * 0.18em tracking / uppercase, in --color-text-secondary so it passes
 * WCAG AA contrast at the small size. No pill chrome — the editorial
 * voice is in the letterforms, not in a tinted background.
 *
 * `invert` variant for dark sections — switches to muted-cream against
 * the warm-ink background.
 */
export function Eyebrow({
  children,
  className = "",
  variant = "default",
}: EyebrowProps) {
  const base =
    "inline-block font-sans text-[11px] font-semibold uppercase tracking-[0.18em]";
  const variants = {
    default: "text-[color:var(--color-text-secondary)]",
    invert: "text-[color:var(--color-invert-text-muted)]",
  };

  return (
    <span className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
