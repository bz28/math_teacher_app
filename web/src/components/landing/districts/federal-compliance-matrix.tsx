import { Section } from "../section";

type EvidenceLink = {
  /** Display text shown in the evidence column. */
  label: string;
  /** Where the link points. Internal anchors or mailto: are both fine. */
  href: string;
  /** External evidence (mailto, off-site) gets a small visual hint. */
  external?: boolean;
};

type ComplianceRow = {
  /** Federal law, standard, or control name. */
  requirement: string;
  /** Plain-English description of how Veradic complies. */
  how: string;
  /** Where a procurement officer can verify the claim. */
  evidence: EvidenceLink;
};

const SUPPORT_EMAIL = "support@veradicai.com";

const mailto = (subject: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Veradic — ${subject}`)}`;

const ROWS: ComplianceRow[] = [
  {
    requirement: "FERPA",
    how: "Veradic acts as a school official under district direction. Student education records stay under district control and are used only to provide the contracted service.",
    evidence: {
      label: "Privacy Policy",
      href: "/privacy#how-we-use-information",
    },
  },
  {
    requirement: "COPPA",
    how: "For students under 13, Veradic relies on the school-consent exception standard for classroom-deployed ed-tech.",
    evidence: {
      label: "Privacy Policy",
      href: "/privacy#childrens-privacy",
    },
  },
  {
    requirement: "CIPA",
    how: "Internet filtering and minor-protection controls are a district-side responsibility under CIPA. Veradic does not bypass or interfere with district filtering.",
    evidence: {
      label: "District-side responsibility",
      href: "/trust#overview",
    },
  },
  {
    requirement: "ADA / WCAG 2.1 AA",
    how: "Veradic is built on standard accessible web technology — semantic HTML, keyboard navigation, screen-reader compatibility, and accessible color contrast.",
    evidence: {
      label: "Accessibility statement — request",
      href: mailto("Accessibility statement request"),
      external: true,
    },
  },
  {
    requirement: "IDEA",
    how: "Veradic does not interfere with assistive technology or block standard accommodations under student IEPs or 504 plans.",
    evidence: {
      label: "Accessibility statement — request",
      href: mailto("Accessibility statement request"),
      external: true,
    },
  },
  {
    requirement: "Encryption at rest",
    how: "All stored data is encrypted at rest using industry-standard encryption provided by our cloud infrastructure.",
    evidence: { label: "Trust & Security", href: "/trust#encryption" },
  },
  {
    requirement: "Encryption in transit",
    how: "All traffic between Veradic and user devices is encrypted in transit using current TLS standards. HTTPS is enforced platform-wide.",
    evidence: { label: "Trust & Security", href: "/trust#encryption" },
  },
  {
    requirement: "Role-based access control",
    how: "Students, teachers, and administrators have scoped access. Cross-account access is prevented at the data layer.",
    evidence: { label: "Trust & Security", href: "/trust#access-control" },
  },
  {
    requirement: "Breach notification",
    how: "Veradic notifies affected districts within 72 hours of a confirmed data security incident, with a written summary of impact and remediation.",
    evidence: { label: "Trust & Security", href: "/trust#incident-response" },
  },
  {
    requirement: "Data Privacy Agreement",
    how: "Veradic signs the NDPA standard template most US districts use. Send your filled version and we countersign; state-specific addenda available on request.",
    evidence: {
      label: "DPA — request",
      href: mailto("DPA request"),
      external: true,
    },
  },
];

/**
 * Federal & cross-state compliance matrix. Sits between the high-level
 * ComplianceGrid (FERPA/COPPA/NDPA "yes, we do paperwork" cards) and the
 * DataModelSafety section. The matrix is the thing a procurement director
 * actually screenshots and forwards — one row per checklist item, plain
 * how-we-comply prose, and an evidence column that points to something
 * real (Privacy Policy section, Trust page anchor, or mailto for docs
 * available on request).
 *
 * On desktop: 3-column table. On mobile: stacked cards (each row becomes
 * a card with requirement → how → evidence rows).
 *
 * State-level laws are explicitly NOT enumerated here — there's a single
 * note below the table directing districts to contact us. We cover every
 * state on request rather than maintaining an out-of-date list.
 */
export function FederalComplianceMatrix() {
  return (
    <Section variant="default" id="federal-compliance">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          The checklist your procurement team runs.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
          Every federal requirement Veradic is asked about in district
          procurement, with how we comply and where to verify it.
        </p>
      </div>

      <div className="mx-auto mt-14 max-w-5xl">
        {/* Desktop: table layout */}
        <div className="hidden overflow-hidden rounded-[--radius-lg] border border-[color:var(--color-border-light)] md:block">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[color:var(--color-surface-alt)]">
                <th
                  scope="col"
                  className="border-b border-[color:var(--color-border-light)] px-6 py-4 text-left text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--color-text-muted)]"
                >
                  Requirement
                </th>
                <th
                  scope="col"
                  className="border-b border-[color:var(--color-border-light)] px-6 py-4 text-left text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--color-text-muted)]"
                >
                  How Veradic complies
                </th>
                <th
                  scope="col"
                  className="border-b border-[color:var(--color-border-light)] px-6 py-4 text-left text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--color-text-muted)]"
                >
                  Evidence
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row.requirement}
                  className={
                    i % 2 === 0
                      ? "bg-[color:var(--color-surface)]"
                      : "bg-[color:var(--color-surface-alt)]"
                  }
                >
                  <td className="border-t border-[color:var(--color-border-light)] px-6 py-5 align-top text-sm font-semibold text-[color:var(--color-text)]">
                    {row.requirement}
                  </td>
                  <td className="border-t border-[color:var(--color-border-light)] px-6 py-5 align-top text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
                    {row.how}
                  </td>
                  <td className="border-t border-[color:var(--color-border-light)] px-6 py-5 align-top text-sm">
                    <a
                      href={row.evidence.href}
                      className="font-medium text-[color:var(--color-primary)] hover:underline"
                    >
                      {row.evidence.label}
                      {row.evidence.external && (
                        <span aria-hidden className="ml-1">
                          ↗
                        </span>
                      )}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards */}
        <div className="space-y-4 md:hidden">
          {ROWS.map((row) => (
            <article
              key={row.requirement}
              className="rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-6"
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-primary)]">
                {row.requirement}
              </div>
              <p className="mt-3 text-base leading-relaxed text-[color:var(--color-text)]">
                {row.how}
              </p>
              <a
                href={row.evidence.href}
                className="mt-4 inline-flex items-center text-sm font-medium text-[color:var(--color-primary)] hover:underline"
              >
                {row.evidence.label}
                {row.evidence.external && (
                  <span aria-hidden className="ml-1">
                    ↗
                  </span>
                )}
              </a>
            </article>
          ))}
        </div>

        {/* State-level note. Single bullet, not a list — we don't want to
            commit to enumerating each state's law and have it drift. */}
        <p className="mx-auto mt-8 max-w-3xl rounded-[--radius-md] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-6 py-5 text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
          <strong className="font-semibold text-[color:var(--color-text)]">
            State-specific privacy laws
          </strong>{" "}
          — New York Education Law §2-d, California SOPIPA, Illinois SOPPA,
          and others. We work through each on request. Send us your
          state&rsquo;s addendum and we&rsquo;ll redline within 5 business
          days. Contact{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-[color:var(--color-primary)] hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </Section>
  );
}
