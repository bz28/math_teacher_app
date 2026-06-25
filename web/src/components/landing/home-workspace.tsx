import { Section } from "./section";
import { Eyebrow } from "./eyebrow";
import { HomeworkFlow } from "./homework-flow";

/**
 * Section #4 — inside the teacher workspace. An animated, click-through tour of
 * the real flow: generate from your own materials → review → refine with the AI
 * chat → publish. Replaces the old static UI mocks; the math + worked solution
 * are the product's real output. Light demo panel on the dark section for
 * contrast (mirrors the dark integrity demo on the light section above).
 */
export function HomeWorkspace() {
  return (
    <Section variant="invert" id="workspace">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow variant="invert">Inside the workspace</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-invert-text)]">
          Sunday-night prep takes{" "}
          <span className="font-display-serif italic">five minutes.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-invert-text-muted)] md:text-xl">
          Point Veradic at your own chapter. It writes the problems &mdash; with
          full worked solutions &mdash; and you fix anything in plain English.
          Assign it before you leave the building.
        </p>
      </div>

      <div className="mt-14 md:mt-20">
        <HomeworkFlow />
      </div>
    </Section>
  );
}
