import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

const PAIN_POINTS = [
  "Wishing you could give every student 1-on-1 time, but there’s only one of you.",
  "Wondering if your class actually got last week’s lesson, or just nodded along.",
  "Spending Sunday nights building problem sets instead of recharging.",
  "Staring at a pile of papers that won’t grade themselves.",
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
            pocket. Most of them will take the fastest path through it, and
            that path doesn&rsquo;t end with learning anything. Teachers
            can&rsquo;t tell anymore what a student actually did themselves.
          </p>
          {/* Pull quote — the third paragraph, lifted out and given weight.
              Breaks the visual monotony of three same-size paragraphs and
              makes the section's argument unmissable on a quick skim.
              Border uses primary-light rather than primary — the dark
              primary on near-black bg only hits ~2.2:1 contrast, where
              the lighter green lands at ~4.7:1 and actually reads as a
              rule. */}
          <p className="border-l-2 border-[color:var(--color-primary-light)] pl-6 text-[color:var(--color-invert-text)] font-medium md:text-2xl">
            Schools don&rsquo;t need less AI in the classroom. They need an AI
            that&rsquo;s built to be on their side.
          </p>
        </div>
      </div>

      {/* Teacher pain points — rendered as a list with hairline top
          borders per item, instead of pill cards. Reads like the
          contents of a journal article, not a feature grid. The 01-04
          numerals carry the visual weight but are decorative — order
          isn't semantically meaningful, so this is a <ul>, not <ol>. */}
      <div className="mx-auto mt-20 max-w-3xl">
        <div className="text-center">
          <Eyebrow variant="invert">Meanwhile, in your week</Eyebrow>
          <h3 className="mt-5 text-2xl font-bold text-[color:var(--color-invert-text)]">
            You&rsquo;re already doing more than one human can.
          </h3>
        </div>

        <ul className="mt-10 border-b border-[color:var(--color-invert-border)]">
          {PAIN_POINTS.map((point, i) => (
            <li
              key={point}
              className="flex items-start gap-6 border-t border-[color:var(--color-invert-border)] py-5 first:border-t-0 first:pt-0"
            >
              {/* The 01-04 numerals are the visual anchor for the
                  list. Tracked uppercase Inter at sm (was xs) gives
                  them slightly more presence on the dark bg without
                  overpowering the body text. font-mono dropped — no
                  monospace font is loaded. */}
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
