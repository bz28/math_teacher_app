import Link from "next/link";
import { Eyebrow } from "./eyebrow";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100dvh_-_4rem)] items-center overflow-hidden bg-[color:var(--color-surface)] md:min-h-[calc(100dvh_-_5rem)]">
      <div className="pointer-events-none absolute right-0 top-1/4 hidden h-[600px] w-[600px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/10 to-transparent blur-3xl md:block" />
      <div className="pointer-events-none absolute -left-32 top-40 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-[color:var(--color-primary-light)]/10 to-transparent blur-3xl" />

      <div className="relative mx-auto w-full max-w-4xl px-6 py-12 text-center md:px-8 md:py-16">
        <Eyebrow>For Teachers</Eyebrow>
        <h1 className="mt-8 text-display-xl text-[color:var(--color-text)]">
          Built for your{" "}
          <span className="bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
            classroom.
          </span>
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Your students are already using AI to do their homework. The
          question isn&rsquo;t whether to bring AI into the classroom.
          It&rsquo;s whether to bring the right one.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/demo"
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
          >
            Book a demo
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
          </a>
        </div>
      </div>
    </section>
  );
}
