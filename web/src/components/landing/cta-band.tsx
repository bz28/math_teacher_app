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
 * Full-bleed contrast section used as the final call-to-action on every page.
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
      {/* Gradient accent */}
      <div className="pointer-events-none absolute -left-40 top-0 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-[color:var(--color-primary)]/40 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-[color:var(--color-primary-light)]/30 to-transparent blur-3xl" />

      <div className="relative mx-auto max-w-4xl px-6 py-24 text-center md:px-8 md:py-32">
        {eyebrow && (
          <p className="mb-6 inline-block rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-invert-text)] ring-1 ring-white/15">
            {eyebrow}
          </p>
        )}
        <h2 className="text-display-lg text-[color:var(--color-invert-text)]">
          {headline}
        </h2>
        {subhead && (
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-invert-text-muted)]">
            {subhead}
          </p>
        )}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={primaryHref}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-bold text-[color:var(--color-invert)] transition-colors hover:bg-[color:var(--color-primary-bg)]"
          >
            {primaryLabel}
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
          <Link
            href={secondaryHref}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 text-base font-semibold text-white transition-colors hover:bg-white/10"
          >
            {secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
