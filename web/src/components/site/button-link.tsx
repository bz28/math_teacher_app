import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "ink" | "paper" | "underline" | "underline-on-dark";

// 6px radius, bold, no arrow glyphs: the label says what happens.
const BASE =
  "inline-flex items-center justify-center rounded-[6px] font-bold transition-colors";

const VARIANTS: Record<Variant, string> = {
  // Veradic green: the page's main action.
  primary: `${BASE} bg-veradic px-6 py-4 text-base text-white hover:bg-veradic-dark`,
  // Ink: the navbar's action, quieter than the hero's green.
  ink: `${BASE} bg-ink px-4 py-2.5 text-[15px] text-paper hover:bg-pencil md:px-5 md:py-[13px]`,
  // Paper on the dark band.
  paper: `${BASE} bg-paper px-6 py-4 text-base font-extrabold text-ink hover:bg-white`,
  // A second action that reads as a link: text with a heavy underline.
  underline:
    "inline-flex items-center border-b-2 border-ink px-2 py-4 text-base font-bold text-ink transition-colors hover:border-veradic hover:text-veradic",
  "underline-on-dark":
    "inline-flex items-center border-b-2 border-paper/70 px-2 py-4 text-base font-bold text-paper transition-colors hover:border-paper",
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
