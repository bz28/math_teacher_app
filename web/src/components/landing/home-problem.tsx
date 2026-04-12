import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

const PAIN_POINTS = [
  "Wishing you could give every student 1-on-1 time, but there's only one of you.",
  "Wondering if your class actually got last week's lesson, or just nodded along.",
  "Spending Sunday nights building problem sets instead of recharging.",
  "Staring at a pile of papers that won't grade themselves.",
];

export function HomeProblem() {
  return (
    <Section variant="invert" id="why">
      <div className="grid gap-12 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-16">
        <div>
          <Eyebrow variant="invert">Why schools need a new kind of AI</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-invert-text)]">
            AI chatbots are already in your classrooms.
            <br />
            <span className="text-[color:var(--color-invert-text-muted)]">
              They&rsquo;re just giving away the answers.
            </span>
          </h2>
        </div>

        <div className="space-y-6 text-xl leading-relaxed text-[color:var(--color-invert-text-muted)] md:text-[1.375rem]">
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
          <p className="text-[color:var(--color-invert-text)] font-medium">
            Schools don&rsquo;t need less AI in the classroom. They need an AI
            that&rsquo;s built to be on their side.
          </p>
        </div>
      </div>

      {/* ── Teacher pain points — the other half of "why schools need this" ── */}
      <div className="mx-auto mt-20 max-w-3xl">
        <div className="text-center">
          <Eyebrow variant="invert">Meanwhile, in your week</Eyebrow>
          <h3 className="mt-5 text-2xl font-bold text-[color:var(--color-invert-text)]">
            You&rsquo;re already doing more than one human can.
          </h3>
        </div>

        <ul className="mt-8 space-y-3">
          {PAIN_POINTS.map((point) => (
            <li
              key={point}
              className="rounded-2xl border border-[color:var(--color-invert-border)] bg-[color:var(--color-invert-alt)] px-6 py-4 text-base leading-relaxed text-[color:var(--color-invert-text-muted)]"
            >
              {point}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
