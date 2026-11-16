import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "ink" | "underline";

// Pill, bold, no arrow glyphs: the label says what happens. Same shape as
// the homepage buttons.
const BASE =
  "inline-flex items-center justify-center rounded-full font-bold transition-[transform,background-color] hover:-translate-y-px";

const VARIANTS: Record<Variant, string> = {
  // Veradic green: the page's main action.
  primary: `${BASE} bg-veradic px-6 py-4 text-base text-white hover:bg-veradic-dark`,
  // Ink with yellow chalk text: the main action on a yellow band.
  ink: `${BASE} bg-ink px-6 py-4 text-base text-chalk-yellow hover:bg-pencil`,
  // A second action that reads as a link: text with a heavy underline.
  underline:
    "inline-flex items-center border-b-2 border-ink px-2 py-4 text-base font-bold text-ink transition-colors hover:border-veradic",
};

export function ButtonLink({
  href,
  variant = "primary",
  children,
  className = "",
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}
