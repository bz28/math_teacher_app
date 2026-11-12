const HANDLED = [
  "Standard NDPA template, signed and countersigned",
  "FERPA Data Processing Agreement on request",
  "COPPA school-consent letters (template provided)",
  "State-specific addenda (NY 2-d, CA SOPIPA, IL SOPPA, etc.)",
  "District-custom riders, redlined and returned within 5 business days",
  "Annual data-handling audit summary on request",
];

/**
 * The paperwork we handle, as a ticked list on a white band. The ask
 * itself (email us your paperwork) is the page's closing ink band, so
 * this section only has to show we've done it before.
 */
export function PaperworkBlock() {
  return (
    <section id="paperwork" className="border-y border-hairline bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-[72px] gap-y-10 px-4 py-20 md:px-8 md:py-24">
        <div className="min-w-0 flex-[1_1_360px]">
          <h2 className="site-h2">We work through your paperwork.</h2>
          <p className="m-0 mt-5 text-lg leading-[1.6] text-ink-soft md:text-[19px]">
            We don&rsquo;t make districts use our paperwork. We work through
            yours.
          </p>
        </div>
        <ul className="m-0 min-w-0 flex-[1_1_520px] list-none border-t-2 border-ink p-0">
          {HANDLED.map((line) => (
            <li key={line} className="flex items-start gap-3.5 border-b border-rule py-3.5 text-[17px] leading-[1.5]">
              {/* A plain check, not handwriting: Kalam is only for the
                  student's pencil and the teacher's red pen. */}
              <svg aria-hidden="true" className="mt-[5px] h-4 w-4 flex-none text-veradic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
