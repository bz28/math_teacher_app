type ComplianceItem = {
  label: string;
  /** One paragraph in plain English describing what we do. */
  body: string;
  /** What this means for a procurement director, in one line. */
  implication: string;
  /** Where to read more or ask, when there is one place for it. */
  link?: { label: string; href: string };
};

const mailto = (subject: string) =>
  `mailto:support@veradicai.com?subject=${encodeURIComponent(`Veradic — ${subject}`)}`;

const ITEMS: ComplianceItem[] = [
  {
    label: "FERPA",
    body: "We act as a school official under your district's direction. Student work and records stay under your control; we access them only to provide the service you've contracted for.",
    implication: "No separate parental consent required for FERPA-covered use.",
    link: { label: "Trust & security", href: "/trust#data-handling" },
  },
  {
    label: "COPPA",
    body: "We rely on the school-consent exception that classroom-deployed ed-tech uses for students under 13: your district consents on parents' behalf for educational use.",
    implication: "Standard for K-12 classroom deployments.",
    link: { label: "Privacy policy", href: "/privacy#childrens-privacy" },
  },
  {
    label: "NDPA standard template",
    body: "We sign the National Data Privacy Agreement template most US districts already use. Send us your filled version and we'll countersign.",
    implication: "No bespoke negotiation needed for most districts.",
    link: { label: "Request the DPA", href: mailto("DPA request") },
  },
  {
    label: "State-specific addenda",
    body: "We work through state-specific data-privacy laws on request: NY Education Law §2-d, CA SOPIPA, IL SOPPA, and others.",
    implication: "Send us the addendum your state requires; we'll redline it.",
    link: { label: "Send your addendum", href: mailto("State addendum") },
  },
  {
    label: "Never trained on",
    body: "Student work, conversations with the AI tutor, integrity-check transcripts and grades are never used to train AI models, ours or anyone else's. Period.",
    implication: "Your students' data does not leave your control.",
    link: { label: "Trust & security", href: "/trust#data-handling" },
  },
  {
    label: "School-controlled record",
    body: "All student-generated content is treated as an education record under your district's policies. You can export, audit, or delete it at any time.",
    implication: "Standard FERPA recordkeeping and retention applies.",
  },
];

/**
 * The laws a district lawyer asks about, one ruled row each: the law,
 * what we do and what it means for you, and where to check. Reads like a
 * legal summary on a white sheet, not a strip of marketing badges.
 */
export function ComplianceGrid() {
  return (
    <section id="compliance" className="scroll-mt-20 border-y border-hairline bg-white md:scroll-mt-24">
      <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-8 md:py-24">
        <h2 className="site-h2 max-w-[760px]">Every law your district lawyer asks about, answered.</h2>
        <p className="m-0 mt-5 max-w-[36em] text-lg leading-relaxed text-ink-soft">
          We&rsquo;ve done the paperwork before. Here&rsquo;s what we do and
          what it means for you, in plain English.
        </p>

        <ul className="m-0 mt-11 list-none border-t-2 border-ink p-0">
          {ITEMS.map((item) => (
            <li
              key={item.label}
              className="grid gap-x-8 gap-y-2 border-b border-rule py-5 md:grid-cols-[220px_minmax(0,1fr)_170px]"
            >
              <h3 className="m-0 text-[17px] font-extrabold">{item.label}</h3>
              <div>
                <p className="m-0 text-base leading-[1.55] text-ink-soft">{item.body}</p>
                <p className="m-0 mt-1.5 text-[15px] font-semibold leading-[1.5] text-ink">
                  {item.implication}
                </p>
              </div>
              {item.link && (
                <a
                  href={item.link.href}
                  className="self-start text-[15px] font-bold text-veradic underline underline-offset-2 hover:text-veradic-dark"
                >
                  {item.link.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
