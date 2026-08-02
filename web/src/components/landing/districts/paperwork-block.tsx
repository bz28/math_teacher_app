import Link from "next/link";
import { Section } from "../section";

const HANDLED = [
  "Standard NDPA template, signed and countersigned",
  "FERPA Data Processing Agreement on request",
  "COPPA school-consent letters (template provided)",
  "State-specific addenda (NY 2-d, CA SOPIPA, IL SOPPA, etc.)",
  "District-custom riders, redlined and returned within 5 business days",
  "Annual data-handling audit summary on request",
];

/**
 * Two-column paperwork section. Left: bulleted list of paperwork we
 * handle. Right: single "email us your paperwork" CTA card with
 * prefilled mailto. The visual goal is "we have done this before"
 * rather than feature-marketing.
 */
export function PaperworkBlock() {
  return (
    <Section variant="default" id="paperwork">
      <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-[1.2fr_1fr] md:items-start md:gap-16">
        <div>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Send us what your district uses. We&rsquo;ve seen it.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
            We don&rsquo;t make districts use our paperwork. We work
            through yours.
          </p>
          <ul className="mt-8 space-y-3">
            {HANDLED.map((line) => (
              <li
                key={line}
                className="flex items-start gap-3 text-base leading-relaxed text-[color:var(--color-text)]"
              >
                <svg
                  className="mt-1.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-8">
          <h3 className="text-lg font-bold text-[color:var(--color-text)]">
            Email us your district&rsquo;s paperwork
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
            We&rsquo;ll read it and reply within 5 business days. Most
            districts get a fully countersigned package in under two
            weeks.
          </p>
          <Link
            href="mailto:support@veradicai.com?subject=District%20paperwork%20%E2%80%94%20%5BDistrict%20name%5D"
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[color:var(--color-primary)] px-6 text-sm font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
          >
            support@veradicai.com
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
        </div>
      </div>
    </Section>
  );
}
