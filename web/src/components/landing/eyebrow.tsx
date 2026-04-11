import { ReactNode } from "react";

type EyebrowProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "invert";
};

/**
 * Small all-caps pill used as a section eyebrow above headlines.
 * Reused across every marketing page for consistent visual rhythm.
 */
export function Eyebrow({
  children,
  className = "",
  variant = "default",
}: EyebrowProps) {
  const base =
    "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]";
  const variants = {
    default:
      "bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary-dark)]",
    invert:
      "bg-white/10 text-[color:var(--color-invert-text)] ring-1 ring-white/15",
  };

  return (
    <span className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
