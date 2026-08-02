import { Section } from "./section";
import { HomeworkFlow } from "./homework-flow";

/**
 * Inside the workspace — an animated, click-through tour of the real flow:
 * generate from your own materials → review → refine with the AI chat → publish.
 * Light section so the white demo card reads as a document on warm paper
 * (contrast beat after the dark integrity section above).
 *
 * Third distinct stance on the page, deliberately: the hero is centred, the
 * integrity section is split, this one is left-anchored — heading and demo
 * sharing one left edge.
 *
 * It briefly ran at 880px on the theory that the demo "is a document". That
 * was wrong for half of it: Refine and Publish read better wide, but Review
 * strands each row's difficulty tag hundreds of pixels from its text, and
 * Generate is a form, where an 820px field holding thirty characters is just
 * a large empty box. Back to 600, which all four stages were designed around.
 */
export function HomeWorkspace() {
  return (
    <Section variant="default" id="workspace">
      <div className="max-w-2xl">
        <h2 className="text-display-md text-[color:var(--color-text)]">
          Sunday-night prep takes{" "}
          <span className="font-display-serif italic text-[color:var(--color-primary)]">five minutes.</span>
        </h2>
        <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          Point Veradic at your own chapter. It writes the problems &mdash; with
          full worked solutions &mdash; and you fix anything in plain English.
          Assign it before you leave the building.
        </p>
      </div>

      <div className="mt-12 md:mt-16">
        <HomeworkFlow />
      </div>
    </Section>
  );
}
