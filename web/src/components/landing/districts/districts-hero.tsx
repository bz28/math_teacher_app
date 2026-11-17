import { ButtonLink } from "@/components/site/button-link";

const DPA_MAILTO =
  "mailto:support@veradicai.com?subject=DPA%20%2B%20pilot%20info%20%E2%80%94%20%5BDistrict%20name%5D";

// What a district's privacy reviewer ticks off. Every line is answered
// further down the page (compliance rows, matrix, paperwork).
const CHECKED = [
  "FERPA school official",
  "COPPA school consent",
  "Signs the NDPA template",
  "Student data never trains AI",
];

/**
 * Hero for /for-districts, the page admins land on when forwarded a
 * sales email. The argument on the left; on the right, the vendor privacy
 * checklist a district reviewer works through, ticked in pencil, with the
 * one line every state answers differently left as a question. Veradic's
 * green note answers it.
 */
export function DistrictsHero() {
  return (
    <section className="bg-sun">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-[72px] gap-y-14 px-4 pb-24 pt-12 md:px-8 md:pb-[112px] md:pt-16">
      <div className="min-w-0 flex-[1_1_480px]">
        <p className="m-0 mb-[18px] text-base font-bold text-ink">
          For superintendents and curriculum directors
        </p>
        <h1 className="site-h1">Built for your teachers. Ready for your procurement team.</h1>
        <p className="m-0 mt-7 max-w-[32em] text-lg leading-[1.55] text-ink/85 md:text-xl">
          Veradic helps students understand their math homework, drafts every
          grade by the teacher&rsquo;s rules, and shows teachers who still needs
          them. This page covers the privacy rules, the paperwork, and how a
          pilot works.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <ButtonLink href={DPA_MAILTO} variant="ink">
            Request the DPA and pilot info
          </ButtonLink>
          <ButtonLink href="#compliance" variant="underline">
            See the compliance checklist
          </ButtonLink>
        </div>
      </div>

      <div className="min-w-0 flex-[1_1_440px]">
        <div className="relative max-w-[480px] pb-6 sm:pb-0">
          <figure className="ruled-paper relative m-0 max-w-[450px] rotate-[1deg] rounded-[4px] pb-[22px] pt-[22px] pl-[60px] pr-5 sm:pb-[64px] shadow-[0_30px_60px_-30px_rgba(29,38,51,0.45)] sm:pl-[70px] sm:pr-7">
            <span aria-hidden="true" className="absolute inset-y-0 left-[44px] w-[2px] bg-margin-line sm:left-[52px]" />
            <figcaption className="m-0 text-[15px] font-extrabold leading-[34px]">
              Vendor privacy checklist
            </figcaption>
            <ul className="m-0 list-none p-0">
              {CHECKED.map((item) => (
                <li key={item} className="text-base leading-[34px]">
                  <span aria-hidden="true" className="mr-2.5 font-hand text-[21px] text-pencil">
                    &#10003;
                  </span>
                  <span className="sr-only">Checked: </span>
                  {item}
                </li>
              ))}
              <li className="text-base leading-[34px]">
                <span aria-hidden="true" className="mr-2.5 font-hand text-[21px] text-redpen">
                  ?
                </span>
                <span className="sr-only">Open question: </span>
                Our state addendum{" "}
                <span className="whitespace-nowrap font-hand text-lg text-redpen">&mdash; ask them</span>
              </li>
            </ul>
          </figure>
          <aside
            aria-label="Veradic's answer"
            className="on-dark relative ml-auto mt-[-18px] w-[250px] max-w-full rounded-[10px] border-[6px] border-[#8C6A44] bg-board px-[18px] py-4 text-chalk shadow-[0_18px_40px_-18px_rgba(10,59,44,0.7)] sm:absolute sm:-bottom-[26px] sm:right-0 sm:mt-0"
          >
            <p className="m-0 font-chalk text-[17px] leading-[1.45] text-chalk-yellow">
              Send us your state&rsquo;s addendum. We redline it within 5 business days.
            </p>
          </aside>
        </div>
      </div>
    </div>
    </section>
  );
}
