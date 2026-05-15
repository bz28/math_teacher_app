import Link from "next/link";
import { Eyebrow } from "./eyebrow";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      {/* Hairline V-mark bottom-right. Quieted from the prior 44rem
          decorative wash to a 22rem outline at 5% opacity — present
          enough to anchor the corner, restrained enough to defer to
          the editorial headline above. Stroke width thinned so it
          reads as a typographic flourish, not a logo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-12 -right-8 select-none text-[color:var(--color-primary)] opacity-[0.05] md:-bottom-24 md:-right-4"
      >
        <svg
          width="640"
          height="640"
          viewBox="0 0 512 512"
          fill="none"
          className="h-[12rem] w-[12rem] md:h-[22rem] md:w-[22rem]"
        >
          <path
            d="M120 100 L256 412 L392 100"
            stroke="currentColor"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-6 py-12 text-center md:px-8 md:py-16">
        <Eyebrow>For teachers</Eyebrow>
        {/* Two-phrase editorial headline. First phrase solid ink in
            Inter (sans, bold, tight). Second phrase in Instrument
            Serif italic — the dashboard's signature emphasis move,
            same rhythm as its serif-italic subtitles. No gradient
            text: the contrast comes from typeface, not color.
            clamp tops out at 4.75rem so each phrase fits a single
            line at md+; text-wrap-balance handles smaller widths. */}
        <h1
          className="mt-7 tracking-[-0.025em] text-[color:var(--color-text)] [font-size:clamp(2.75rem,5.8vw,4.75rem)] [line-height:1.1] [text-wrap:balance]"
        >
          <span className="block font-bold pb-1">
            Your students already have AI.
          </span>
          <span
            className="block font-serif italic font-normal pb-1 text-[color:var(--color-primary-dark)] [font-size:1.05em]"
          >
            Give them one that&rsquo;s on your side.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Veradic measures what students actually understand, drafts the
          grading, and writes the homework you don&rsquo;t have time to
          make.
        </p>

        {/* CTA pair: filled ink-primary for the self-serve path,
            hairline-outlined for the book-a-demo path. No drop
            shadow on either — the dashboard family. Pill radius
            kept on these two because the editorial wordmark
            framework still prefers a round endpoint on hero CTAs;
            in-product buttons keep their sharp --radius-sm.  */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link
              href="/register?role=teacher"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] bg-[color:var(--color-primary)] px-8 text-[15px] font-semibold tracking-[0.01em] text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
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
            <Link
              href="/demo"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] border border-[color:var(--color-border)] bg-transparent px-8 text-[15px] font-semibold tracking-[0.01em] text-[color:var(--color-text)] transition-colors hover:border-[color:var(--color-text)]"
            >
              Book a 20-min demo
            </Link>
          </div>
          <p className="text-xs font-medium text-[color:var(--color-text-muted)]">
            No credit card &middot; Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
}
