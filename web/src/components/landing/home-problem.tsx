import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

// Refocused on the THREAT, not teacher exhaustion (the Outcomes section owns
// the exhaustion-and-relief note). These two set up the integrity demo: a
// correct answer no longer proves understanding.
const SIGNALS = [
  "A clean, correct answer used to mean they understood it. Now it might just mean they had the right app open.",
  "The student who’s quietly lost turns in work that looks identical to the student who gets it — until the test.",
];

export function HomeProblem() {
  return (
    <Section variant="invert" id="why">
      <div className="grid gap-12 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-16">
        <div>
          <Eyebrow variant="invert">The new normal</Eyebrow>
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
            pocket. Most will take the fastest path through it &mdash; and that
            path doesn&rsquo;t end with learning anything. You can&rsquo;t tell
            anymore what a student actually did themselves.
          </p>
          <p className="border-l-2 border-[color:var(--color-primary-light)] pl-6 text-[color:var(--color-invert-text)] font-medium md:text-2xl">
            Schools don&rsquo;t need less AI in the classroom. They need an AI
            that&rsquo;s built to be on their side.
          </p>
        </div>
      </div>

      <div className="mx-auto mt-20 max-w-3xl">
        <div className="text-center">
          <Eyebrow variant="invert">What just broke</Eyebrow>
          <h3 className="mt-5 text-2xl font-bold text-[color:var(--color-invert-text)]">
            A right answer doesn&rsquo;t mean what it used to.
          </h3>
        </div>

        <ul className="mt-10 border-b border-[color:var(--color-invert-border)]">
          {SIGNALS.map((point, i) => (
            <li
              key={point}
              className="flex items-start gap-6 border-t border-[color:var(--color-invert-border)] py-5 first:border-t-0 first:pt-0"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 w-7 shrink-0 text-sm font-bold uppercase tracking-[0.16em] tabular-nums text-[color:var(--color-primary-light)]"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-base leading-relaxed text-[color:var(--color-invert-text-muted)] md:text-lg">
                {point}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
