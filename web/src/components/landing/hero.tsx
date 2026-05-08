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
        className="pointer-events-none absolute -bottom-40 -right-20 select-none text-[color:var(--color-primary)] opacity-[0.06] md:-bottom-52 md:-right-12"
      >
        <svg
          width="640"
          height="640"
          viewBox="0 0 512 512"
          fill="none"
          className="h-[26rem] w-[26rem] md:h-[44rem] md:w-[44rem]"
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
        <Eyebrow>For school districts</Eyebrow>
        {/* Headline uses a tighter clamp than text-display-xl. The
            standard utility caps at 6rem (96px), which is too large
            for a two-phrase headline of this length — at desktop
            widths the upper end forced each phrase to wrap into 2
            lines, giving a 4-line-tall headline. This clamp tops out
            at 4.75rem (76px) so each phrase lands on a single line on
            md+ and balances cleanly via text-wrap on smaller widths.
            text-wrap-balance distributes wraps evenly when phrases
            do need to break (e.g. on phones). */}
        <h1
          className='mt-8 font-bold tracking-[-0.025em] text-[color:var(--color-text)] [font-family:var(--font-fraunces),Georgia,"Times_New_Roman",serif] [font-size:clamp(2.75rem,5.8vw,4.75rem)] [font-variation-settings:"opsz"_120,"SOFT"_0,"WONK"_0] [line-height:0.96] [text-wrap:balance]'
        >
          <span className="block">Your students already have AI.</span>
          <span className="block bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
            Give them one that&rsquo;s on your side.
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Veradic catches who actually did the work, drafts the grading,
          and gives every student more practice than you have time to
          write — so teachers can stop racing the chatbot and get back
          to teaching.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/demo"
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
          >
            Book a 20-min demo
            <svg
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
          <a
            href="#why"
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-8 text-base font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:border-[color:var(--color-primary)]/40 hover:text-[color:var(--color-primary)]"
          >
            See why it matters
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
