import Link from "next/link";
import { Section } from "../section";

/**
 * Hero for /for-districts — the page admins land on when forwarded a
 * sales email. Tone is "we know how district procurement works" —
 * compliance-forward, restrained, paperwork-aesthetic. Lead with
 * teacher-side value (the audit flagged this page as under-selling
 * the admin-workflow payoff and over-indexing on data compliance);
 * compliance follows immediately below.
 */
export function DistrictsHero() {
  return (
    <Section variant="default">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="mt-8 text-display-xl text-[color:var(--color-text)]">
          Built for your teachers.{" "}
          <span className="font-serif italic font-normal text-[color:var(--color-primary-dark)]">
            Cleared by your procurement team.
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Veradic grades homework, surfaces integrity concerns early,
          and gives every student unlimited guided practice — all
          under teacher control. The compliance, paperwork, and pilot
          path are documented below.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/demo"
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
