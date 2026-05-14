import Link from "next/link";
import { Eyebrow } from "./eyebrow";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      {/* Single ornamental V-mark anchored bottom-right. Brand
          ornament instead of generic blurred gradient orbs. Sits at
          ~6% opacity so it's perceptibly present without competing
          with the headline; the stroke is thinner than a wordmark V
          to read as a typographic flourish, not a logo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-16 select-none text-[color:var(--color-primary)] opacity-[0.06] md:-bottom-52 md:-right-12"
      >
        <svg
          width="640"
          height="640"
          viewBox="0 0 512 512"
          fill="none"
          className="h-[18rem] w-[18rem] md:h-[44rem] md:w-[44rem]"
        >
          <path
            d="M120 100 L256 412 L392 100"
            stroke="currentColor"
            strokeWidth="28"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-6 py-12 text-center md:px-8 md:py-16">
        <Eyebrow>For teachers</Eyebrow>
        {/* Headline uses a tighter clamp than text-display-xl. The
            standard utility caps at 6rem (96px), which is too large
            for a two-phrase headline of this length — at desktop
            widths the upper end forced each phrase to wrap into 2
            lines, giving a 4-line-tall headline. This clamp tops out
            at 4.75rem (76px) so each phrase lands on a single line on
            md+ and balances cleanly via text-wrap on smaller widths.
            text-wrap-balance distributes wraps evenly when phrases
            do need to break (e.g. on phones). */}
        {/* line-height 1.15 leaves room for descenders. bg-clip-text
            spans clip text glyphs at the line-box, so each span also
            gets its own pb-2 — without it the "y" tail on "your
            side." gets cropped against the span's bg-clip bounds. */}
        <h1
          className="mt-8 font-bold tracking-[-0.025em] text-[color:var(--color-text)] [font-size:clamp(2.75rem,5.8vw,4.75rem)] [line-height:1.15] [text-wrap:balance]"
        >
          <span className="block pb-2">Your students already have AI.</span>
          <span className="block pb-2 bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
            Give them one that&rsquo;s on your side.
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Veradic measures what students actually understand, drafts the
          grading, and writes the homework you don&rsquo;t have time to
          make.
        </p>

        {/* CTA hierarchy: primary green pill for self-serve, secondary
            text link for schools. Solo teachers are the wider funnel;
            the school-buyer motion gets a deliberate, low-friction
            secondary path. Microcopy beneath the primary reassures
            visitors that 'free' is genuine. */}
        <div className="mt-10 flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:justify-center sm:gap-8">
          <div className="flex flex-col items-center gap-2">
            <Link
              href="/register?role=teacher"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white shadow-[0_8px_24px_-8px_rgba(14,82,56,0.32)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[color:var(--color-primary-dark)] hover:shadow-[0_12px_28px_-8px_rgba(14,82,56,0.38)]"
            >
              Start free
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <p className="text-xs font-medium text-[color:var(--color-text-muted)]">
              No credit card &middot; Cancel anytime
            </p>
          </div>
          {/* sm:mt-4 aligns the secondary link's text-row with the
              vertical center of the h-14 primary button (button top=0,
              center=28px; link line-height ~24px → top at 16px = mt-4).
              Parent uses sm:items-start so primary's microcopy doesn't
              drag the cross-axis alignment baseline downward. */}
          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 text-base font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-primary)] sm:mt-4"
          >
            or book a 20-min demo
            <svg
              aria-hidden="true"
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
