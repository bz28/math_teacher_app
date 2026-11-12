import { HomeworkFlow } from "./homework-flow";

/**
 * Inside the workspace — an animated, click-through tour of the real flow:
 * generate from your own materials → review → refine with the AI chat → publish.
 * A white band, so the demo reads as the teacher's screen between the
 * graph-paper sections.
 *
 * Split like its neighbours, demo on the right (the grading section above
 * has its demo on the left), so the page alternates sides.
 *
 * It briefly ran at 880px on the theory that the demo "is a document". That
 * was wrong for half of it: Refine and Publish read better wide, but Review
 * strands each row's difficulty tag hundreds of pixels from its text, and
 * Generate is a form, where an 820px field holding thirty characters is just
 * a large empty box. Back to 600, which all four stages were designed around.
 */
export function HomeWorkspace() {
  return (
    <section id="workspace" className="border-y border-hairline bg-white">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 md:px-8 md:py-24">
        {/* Split at xl with the 600px demo on the right (the width all four
            stages were designed around). Stacks below xl. */}
        <div className="grid items-start gap-12 xl:grid-cols-[minmax(0,1fr)_600px] xl:gap-[72px]">
          <div className="max-w-xl xl:pt-8">
            <h2 className="site-h2">Sunday-night prep takes five minutes.</h2>
            <p className="mt-6 text-lg leading-relaxed text-ink-soft md:text-[19px] md:leading-[1.6]">
              Point Veradic at your own chapter. It writes the problems &mdash; with
              full worked solutions &mdash; and you fix anything in plain English.
              Assign it before you leave the building.
            </p>
          </div>

          <div className="min-w-0">
            <HomeworkFlow />
          </div>
        </div>
      </div>
    </section>
  );
}
