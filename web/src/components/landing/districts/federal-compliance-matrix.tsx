type EvidenceLink = {
  /** Display text shown in the evidence column. */
  label: string;
  /** Where the link points. Internal anchors or mailto: are both fine. */
  href: string;
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
      label: "Request the accessibility statement",
      href: mailto("Accessibility statement request"),
    },
  },
  {
    requirement: "IDEA",
    how: "Veradic does not interfere with assistive technology or block standard accommodations under student IEPs or 504 plans.",
    evidence: {
      label: "Request the accessibility statement",
      href: mailto("Accessibility statement request"),
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
      label: "Request the DPA",
      href: mailto("DPA request"),
    },
  },
];

/**
 * Federal & cross-state compliance matrix: the thing a procurement
 * director screenshots and forwards. One row per checklist item, plain
 * how-we-comply prose, and an evidence column that points to something
 * real (a Privacy Policy section, a Trust page anchor, or an email for
 * documents available on request).
 *
 * A ruled table on a white sheet from md up; on phones each row becomes a
 * block of requirement, how, evidence, divided by rule lines.
 *
 * State laws are not enumerated in the table: one note below it points
 * districts to us, rather than keeping a list that drifts.
 */
export function FederalComplianceMatrix() {
  return (
    <section id="federal-compliance" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 py-20 md:scroll-mt-24 md:px-8 md:py-24">
      <h2 className="site-h2 max-w-[760px]">The checklist your procurement team runs.</h2>
      <p className="m-0 mt-5 max-w-[36em] text-lg leading-relaxed text-ink-soft">
        Every federal requirement Veradic is asked about in district
        procurement, with how we comply and where to verify it.
      </p>

      <div className="mt-11 rounded-[4px] border border-hairline bg-white">
        {/* md and up: a table. */}
        <table className="hidden w-full border-collapse text-left md:table">
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="w-[24%] px-6 py-4 text-[15px] font-extrabold">Requirement</th>
              <th scope="col" className="px-6 py-4 text-[15px] font-extrabold">How Veradic complies</th>
              <th scope="col" className="w-[24%] px-6 py-4 text-[15px] font-extrabold">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.requirement} className="border-b border-rule last:border-b-0">
                <th scope="row" className="px-6 py-5 align-top text-base font-bold">
                  {row.requirement}
                </th>
                <td className="px-6 py-5 align-top text-[15.5px] leading-[1.55] text-ink-soft">{row.how}</td>
                <td className="px-6 py-5 align-top text-[15px]">
                  <a href={row.evidence.href} className="font-bold text-veradic underline underline-offset-2 hover:text-veradic-dark">
                    {row.evidence.label}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Phones: one block per row. */}
        <ul className="m-0 list-none p-0 md:hidden">
          {ROWS.map((row) => (
            <li key={row.requirement} className="border-b border-rule px-5 py-5 last:border-b-0">
              <h3 className="m-0 text-base font-extrabold">{row.requirement}</h3>
              <p className="m-0 mt-2 text-[15.5px] leading-[1.55] text-ink-soft">{row.how}</p>
              <a
                href={row.evidence.href}
                className="mt-2.5 inline-block text-[15px] font-bold text-veradic underline underline-offset-2 hover:text-veradic-dark"
              >
                {row.evidence.label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* State-level note. One line, not a list: we don't want to commit
          to enumerating each state's law and have it drift. */}
      <p className="m-0 mt-6 max-w-[760px] border-l-[3px] border-veradic py-1 pl-[18px] text-base leading-[1.6] text-ink-soft">
        <strong className="font-bold text-ink">State-specific privacy laws:</strong>{" "}
        New York Education Law §2-d, California SOPIPA, Illinois SOPPA, and
        others. We work through each on request. Send us your state&rsquo;s
        addendum and we&rsquo;ll redline within 5 business days. Contact{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-bold text-veradic underline underline-offset-2 hover:text-veradic-dark"
        >
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}
