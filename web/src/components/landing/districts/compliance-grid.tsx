import { Section } from "../section";

type ComplianceItem = {
  label: string;
  /** One paragraph in plain English describing what we do. */
  body: string;
  /** "What this means for you" line — the operational implication
   *  for a procurement director. */
  implication: string;
};

const ITEMS: ComplianceItem[] = [
  {
    label: "FERPA",
    body: "We act as a school official under your district's direction. Student work and records stay under your control; we access them only to provide the service you've contracted for.",
    implication:
      "No separate parental consent required for FERPA-covered use.",
  },
  {
    label: "COPPA",
    body: "We rely on the school-consent exception that all classroom-deployed ed-tech uses for students under 13 — your district consents on parents' behalf for educational use.",
    implication: "Standard for K-12 classroom deployments.",
  },
  {
    label: "NDPA standard template",
    body: "We sign the National Data Privacy Agreement template most US districts already use. Send us your filled version and we'll countersign.",
    implication: "No bespoke negotiation needed for most districts.",
  },
  {
    label: "State-specific addenda",
    body: "We work through state-specific data-privacy laws on request: NY Education Law §2-d, CA SOPIPA, IL SOPPA, and others.",
    implication:
      "Send us the addendum your state requires; we'll redline it.",
  },
  {
    label: "Never trained on",
    body: "Student work, conversations with the AI tutor, integrity-check transcripts, and grades are never used to train AI models — ours or anyone else's. Period.",
    implication: "Your students' data does not leave your control.",
  },
  {
    label: "School-controlled record",
    body: "All student-generated content is treated as an education record under your district's policies. You can export, audit, or delete it at any time.",
    implication: "Standard FERPA recordkeeping and retention applies.",
  },
];

/**
 * Six-cell compliance grid. Visual is intentionally paperwork-aesthetic:
 * white cards on cream bg, hairline borders, no badges or pills. Looks
 * like a district legal summary, not a marketing chip strip.
 */
export function ComplianceGrid() {
  return (
    <Section variant="alt" id="compliance">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Every law your district lawyer asks about — answered.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
          We&rsquo;ve done the paperwork before. Here&rsquo;s what we do
          and what it means for you, in plain English.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {ITEMS.map((item) => (
          <article
            key={item.label}
            className="rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-7"
          >
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-primary)]">
              {item.label}
            </div>
            <p className="mt-4 text-base leading-relaxed text-[color:var(--color-text)]">
              {item.body}
            </p>
            <p className="mt-4 border-t border-[color:var(--color-border-light)] pt-4 text-sm italic leading-relaxed text-[color:var(--color-text-secondary)]">
              {item.implication}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}
