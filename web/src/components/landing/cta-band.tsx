import Link from "next/link";

type CtaBandProps = {
  eyebrow?: string;
  headline: string;
  subhead?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
};

/**
 * Final-CTA band on every long marketing page. Warm-ink background
 * (flat, no gradient orbs), serif-italic emphasis phrase optional,
 * paper-on-ink primary CTA + outlined secondary. Editorial restraint:
 * the headline carries the weight; the chrome stays out of the way.
 */
export function CtaBand({
  eyebrow,
  headline,
  subhead,
  primaryLabel = "Book a demo",
  primaryHref = "/demo",
  secondaryLabel = "Email us",
  secondaryHref = "mailto:support@veradicai.com",
}: CtaBandProps) {
  return (
    <section className="relative overflow-hidden bg-[color:var(--color-invert)]">
      {/* Single hairline accent rule top — quieter than the prior
          gradient-orb wash, but still asserts the section break. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color:var(--color-invert-border)]" />

      <div className="relative mx-auto max-w-4xl px-6 py-24 text-center md:px-8 md:py-32">
        {eyebrow && (
          <p className="mb-6 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-invert-text-muted)]">
            {eyebrow}
          </p>
        )}
        <h2 className="text-display-lg text-[color:var(--color-invert-text)]">
          {headline}
        </h2>
        {subhead && (
          <p className="mx-auto mt-6 max-w-2xl font-serif italic text-xl leading-relaxed text-[color:var(--color-invert-text-muted)] md:text-2xl">
            {subhead}
          </p>
        )}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={primaryHref}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] bg-[color:var(--color-invert-text)] px-8 text-[15px] font-semibold tracking-[0.01em] text-[color:var(--color-invert)] transition-colors hover:bg-white"
          >
            {primaryLabel}
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
            href={secondaryHref}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[--radius-pill] border border-[color:var(--color-invert-border)] bg-transparent px-8 text-[15px] font-semibold tracking-[0.01em] text-[color:var(--color-invert-text)] transition-colors hover:border-white hover:bg-white/5"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
