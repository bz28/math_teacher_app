import { districtFaqs } from "@/lib/seo";

/**
 * The questions district leaders ask, as native disclosure rows on a white
 * sheet. <details> keeps every answer in the HTML (and in find-in-page)
 * and needs no script; the same set feeds the page's FAQ JSON-LD.
 */
export function DistrictFaq() {
  return (
    <section id="faq" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 py-20 md:scroll-mt-24 md:px-8 md:py-24">
      <h2 className="site-h2">What district leaders ask.</h2>
      <div className="mt-10 max-w-[860px] rounded-[4px] border border-hairline bg-white">
        {districtFaqs.map((faq) => (
          <details key={faq.question} className="group border-b border-rule last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-[17px] font-bold leading-snug sm:px-7 md:text-lg [&::-webkit-details-marker]:hidden">
              {faq.question}
              <span
                aria-hidden="true"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-[1.5px] border-veradic text-veradic transition-transform group-open:rotate-45"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="1" x2="6" y2="11" />
                  <line x1="1" y1="6" x2="11" y2="6" />
                </svg>
              </span>
            </summary>
            <p className="m-0 px-5 pb-6 text-base leading-[1.65] text-ink-soft sm:px-7">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
