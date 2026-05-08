import Link from "next/link";
import { Eyebrow } from "./eyebrow";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      {/* Single ornamental V mark anchored bottom-right, ghosted at ~3%
          opacity. Replaces the generic blurred gradient orbs from the
          previous hero — a brand-anchored mark instead of decorative
          AI-template noise. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-16 select-none text-[color:var(--color-primary)] opacity-[0.035] md:-bottom-40 md:-right-8"
      >
        <svg
          width="640"
          height="640"
          viewBox="0 0 512 512"
          fill="none"
          className="h-[24rem] w-[24rem] md:h-[40rem] md:w-[40rem]"
        >
          <path
            d="M120 100 L256 412 L392 100"
            stroke="currentColor"
            strokeWidth="36"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-6 py-12 text-center md:px-8 md:py-16">
        <Eyebrow>For school districts</Eyebrow>
        {/* Two block-level spans (instead of a forced <br />) so each
            phrase wraps independently on small viewports. At 375px the
            display-xl clamp lands ~56px and "Your students already have
            AI." needs to flow over multiple lines without an explicit
            break splitting the second phrase across the wrap. */}
        <h1 className="mt-8 text-display-xl text-[color:var(--color-text)]">
          <span className="block">Your students already have AI.</span>
          <span className="block bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
            Give them one that&rsquo;s on your side.
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Veradic catches who actually did the work, drafts the grading,
          and gives every student unlimited practice — so teachers can
          stop racing the chatbot and get back to teaching.
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
