import Link from "next/link";
import { LogoMark } from "@/components/landing/board/logo-mark";

/**
 * The marketing-site logo: the Balanced mark (ink over green), then the
 * wordmark. Colours are fixed (not the app's `primary` token, which
 * subject pages reassign), so the mark is the same everywhere.
 *
 * `href` makes it a home link (the navbar); without it, it is just the mark
 * (the footer, where a second home link would be noise).
 */
export function Logo({ href }: { href?: string }) {
  const mark = (
    <>
      <span className="flex text-ink">
        <LogoMark />
      </span>
      <span className="text-xl font-extrabold tracking-[-0.02em] text-ink">Veradic</span>
    </>
  );
  if (!href) return <span className="flex items-center gap-2.5">{mark}</span>;
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Veradic home">
      {mark}
    </Link>
  );
}
