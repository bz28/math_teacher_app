import Link from "next/link";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Chip = {
  label: string;
  description: string;
};

/**
 * Section #7 — small district-leader teaser. Two columns: short
 * positioning copy on the left, a stack of compliance chips on the
 * right. Visually intentional as a paperwork-aesthetic — looks
 * like a redacted compliance summary, not pill badges. Sells trust
 * through visual restraint.
 *
 * The chips don't duplicate the full /for-districts content; they
 * exist to communicate "we've thought about this" before an admin
 * has to commit a click. The actual depth lives on the dedicated
 * page.
 */
const CHIPS: Chip[] = [
  {
    label: "FERPA",
    description: "School official acting under district direction.",
  },
  {
    label: "COPPA",
    description: "School consent exception used by classroom ed-tech.",
  },
  {
    label: "NDPA",
    description: "Standard template with state addenda available.",
  },
  {
    label: "Never trained on",
    description: "Student work, conversations, or grades.",
  },
];

export function HomeDistrictsTeaser() {
  return (
    <Section variant="default" id="districts-teaser">
      <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-16">
        <div>
          <Eyebrow>For district leaders</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Built for the way your district buys software.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
            FERPA + COPPA from day one. NDPA-ready paperwork. Student
            work never trains AI models. Pilot one classroom before
            any commitment.
          </p>
          <Link
            href="/for-districts"
            className="mt-8 inline-flex items-center gap-2 text-base font-semibold text-[color:var(--color-primary)] transition-colors hover:text-[color:var(--color-primary-dark)]"
          >
            See the full district overview
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

        {/* Compliance chip stack — vertical, hairline-divided. Each
            row is a labeled rule with a short plain-English follow.
            The visual restraint is the design point. */}
        <ul className="rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] divide-y divide-[color:var(--color-border-light)]">
          {CHIPS.map((c) => (
            <li key={c.label} className="px-6 py-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
                {c.label}
              </div>
              <div className="mt-1 text-sm font-medium leading-relaxed text-[color:var(--color-text)]">
                {c.description}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
