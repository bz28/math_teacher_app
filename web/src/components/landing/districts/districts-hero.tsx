import Link from "next/link";
import { Section } from "../section";
import { Eyebrow } from "../eyebrow";

/**
 * Hero for /for-districts — the page admins land on when forwarded a
 * sales email. Tone is "we know how district procurement works" —
 * compliance-forward, restrained, paperwork-aesthetic.
 */
export function DistrictsHero() {
  return (
    <Section variant="default">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>For superintendents and curriculum directors</Eyebrow>
        <h1 className="mt-8 text-display-xl text-[color:var(--color-text)]">
          District-ready{" "}
          <span className="bg-gradient-to-r from-[color:var(--color-primary)] to-[color:var(--color-primary-light)] bg-clip-text text-transparent">
            from day one.
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Veradic is built to clear procurement before it clears the
          classroom. Compliance, paperwork, and a pilot path — all
          documented here.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="mailto:support@veradicai.com?subject=DPA%20%2B%20pilot%20info%20%E2%80%94%20%5BDistrict%20name%5D"
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-8 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
          >
            Request DPA + pilot info
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
          {/* Anchor scroll to the in-page compliance grid — this
              page IS the compliance surface for districts (the
              former /safety page has been merged in here). */}
          <a
            href="#compliance"
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-8 text-base font-semibold text-[color:var(--color-text-secondary)] transition-colors hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
          >
            Jump to compliance
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </a>
        </div>
      </div>
    </Section>
  );
}
