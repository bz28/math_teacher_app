import { Section } from "./section";
import { Eyebrow } from "./eyebrow";
import { HomeworkFlow } from "./homework-flow";

/**
 * Inside the workspace — an animated, click-through tour of the real flow:
 * generate from your own materials → review → refine with the AI chat → publish.
 * Light section so the white demo card reads as a document on warm paper
 * (contrast beat after the dark integrity section above).
 */
export function HomeWorkspace() {
  return (
    <Section variant="default" id="workspace">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>Inside the workspace</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Sunday-night prep takes{" "}
          <span className="font-display-serif italic text-[color:var(--color-primary)]">five minutes.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
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
