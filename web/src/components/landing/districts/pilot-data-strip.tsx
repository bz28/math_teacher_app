/**
 * The honesty move: where outcome data will eventually live. Most ed-tech
 * vendors fake this; we'd rather show nothing than show fabricated
 * numbers. When real pilot data lands (hours saved, outcomes), this gets
 * replaced with the data itself.
 *
 * A white sheet laid slightly askew on the graph paper, with the point
 * made in the margin in red pen.
 */
export function PilotDataStrip() {
  return (
    <section id="pilot-data" className="mx-auto max-w-[1200px] px-4 pb-20 md:px-8 md:pb-24">
      <div className="flex -rotate-[0.4deg] flex-wrap items-center gap-x-8 gap-y-5 rounded-[4px] border border-hairline bg-white px-6 py-8 sm:px-10 md:px-12 md:py-11">
        <div className="min-w-0 flex-[1_1_520px]">
          <h2 className="m-0 text-[28px] font-black leading-[1.1] tracking-[-0.03em] text-balance md:text-[32px]">
            Pilot results, published when they&rsquo;re real.
          </h2>
          <p className="m-0 mt-3.5 text-[17px] leading-[1.6] text-ink-soft">
            Teachers are using Veradic with their classes now. Once there&rsquo;s
            enough data to stand behind, we&rsquo;ll publish hours saved and
            student outcomes here, with sources, sample sizes, and the
            districts who let us name them.
          </p>
        </div>
        <p className="m-0 flex-[0_1_260px] font-hand text-2xl leading-[1.3] text-redpen">
          No made-up numbers.
        </p>
      </div>
    </section>
  );
}
