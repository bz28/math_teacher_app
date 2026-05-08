import { ReactNode } from "react";

type SectionVariant = "default" | "alt" | "alt2" | "invert" | "accent";

type SectionProps = {
  children: ReactNode;
  variant?: SectionVariant;
  className?: string;
  containerClassName?: string;
  id?: string;
  as?: "section" | "div" | "article";
};

/**
 * Standard marketing page section with background variants for visual rhythm.
 * Alternating default / alt / invert backgrounds give long pages cadence.
 */
export function Section({
  children,
  variant = "default",
  className = "",
  containerClassName = "",
  id,
  as: Tag = "section",
}: SectionProps) {
  const bg: Record<SectionVariant, string> = {
    default: "bg-[color:var(--color-surface)] text-[color:var(--color-text)]",
    alt: "bg-[color:var(--color-surface-alt)] text-[color:var(--color-text)]",
    alt2: "bg-[color:var(--color-surface-alt-2)] text-[color:var(--color-text)]",
    invert: "bg-[color:var(--color-invert)] text-[color:var(--color-invert-text)]",
    accent:
      "bg-gradient-to-br from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] text-white",
  };

  return (
    <Tag
      id={id}
      className={`relative w-full ${bg[variant]} ${className}`}
      data-section-variant={variant}
    >
      {/* Vertical padding bumped from py-14/20 → py-16/24. The
          dense alternation between cream and ink sections needed
          more breathing room — the previous spacing made adjacent
          headings feel pushed-together on a long scroll. */}
      <div
        className={`mx-auto w-full max-w-6xl px-6 py-16 md:px-8 md:py-24 ${containerClassName}`}
      >
        {children}
      </div>
    </Tag>
  );
}
