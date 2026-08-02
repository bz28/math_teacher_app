import { Section } from "./section";
import { HomeworkFlow } from "./homework-flow";

/**
 * Inside the workspace — an animated, click-through tour of the real flow:
 * generate from your own materials → review → refine with the AI chat → publish.
 * Light section so the white demo card reads as a document on warm paper
 * (contrast beat after the dark integrity section above).
 *
 * Third distinct stance on the page, deliberately: the hero is centred, the
 * integrity section is split, this one is left-anchored with the demo widened
 * beneath it. The flow demo is a document — a problem sheet with a
 * worked-solution drawer — so it earns width in a way the chat transcript in
 * the section above does not; it runs to 880px rather than the old 600, which
 * is where the step rail and the sheet start to drift apart. Not edge to edge:
 * a document that spans a 1152px section stops reading as a document.
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
