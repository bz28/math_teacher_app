import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

export function HomeProblem() {
  return (
    <Section variant="alt">
      <div className="grid gap-12 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-16">
        <div>
          <Eyebrow>Why schools need a new kind of AI</Eyebrow>
          <h2 className="mt-6 text-display-lg text-[color:var(--color-text)]">
            AI chatbots are already in your classrooms.
            <br />
            <span className="text-[color:var(--color-text-secondary)]">
              They&rsquo;re just giving away the answers.
            </span>
          </h2>
        </div>

        <div className="space-y-6 text-xl leading-relaxed text-[color:var(--color-text-secondary)] md:text-[1.375rem]">
          <p>
            Every student with a phone has a homework-solving AI in their
            pocket. Most of them will take the fastest path through it, and
            that path doesn&rsquo;t end with learning anything.
          </p>
          <p>
            Teachers can&rsquo;t tell anymore what a student actually did
            themselves. Banning the tools doesn&rsquo;t work; kids just use
            them on the ride home. The gap between what&rsquo;s submitted and
            what&rsquo;s understood keeps growing.
          </p>
          <p className="text-[color:var(--color-text)] font-medium">
            Schools don&rsquo;t need less AI in the classroom. They need an AI
            that&rsquo;s built to be on their side.
          </p>
        </div>
      </div>
    </Section>
  );
}
