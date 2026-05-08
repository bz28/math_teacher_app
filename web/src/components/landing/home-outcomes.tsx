import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Vignette = {
  /** Day-tag eyebrow that visually anchors the card. */
  when: string;
  /** Bold one-line outcome the teacher experiences. */
  headline: string;
  /** 2-3 sentence vignette describing the moment in concrete terms. */
  scene: string;
};

/**
 * Section #5 — "what you get back". Four vignettes anchored by
 * day-tags (MONDAY 8:14am, WEDNESDAY, FRIDAY 4pm, SUNDAY NIGHT) so
 * the section reads as moments in a real teacher's week, not a
 * feature recap. No icons, no fake numbers — the day-tag is the
 * visual anchor and the bold outcome line does the headline work.
 */
const VIGNETTES: Vignette[] = [
  {
    when: "MONDAY · 8:14 am",
    headline: "You see who's silently confused — not just who skipped.",
    scene:
      "You open your dashboard with coffee. Three students completed Friday's set with low integrity scores. Two of them did the work — they just couldn't explain step three. You pull them aside before first period.",
  },
  {
    when: "WEDNESDAY",
    headline: "Differentiation that doesn't take your evening.",
    scene:
      "You pick a topic. Veradic generates a fresh problem set from your textbook with per-student variants. You skim, approve, assign. The students who needed reps get more; the ones who didn't move on.",
  },
  {
    when: "FRIDAY · 4:00 pm",
    headline: "140 quizzes graded before you leave the building.",
    scene:
      "Instead of carrying papers home, you open the grading queue. Veradic has drafted scores for every submission with a step-by-step rubric. You skim, override the eight that look off, and publish. Done.",
  },
  {
    when: "SUNDAY NIGHT",
    headline: "You're not building problem sets anymore.",
    scene:
      "The next week's homework was generated, reviewed, and queued by Wednesday. Sunday is yours again. You answer one Slack message and close the laptop.",
  },
];

export function HomeOutcomes() {
  return (
    <Section variant="default">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>What you get back</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          A week that ends on Friday.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
          You became a teacher to teach, not to grade quizzes at 9pm or
          build practice sets every Sunday. Veradic handles the
          repetitive work; here&rsquo;s what your week feels like.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2 md:gap-8">
        {VIGNETTES.map((v) => (
          <article
            key={v.when}
            className="marketing-card relative overflow-hidden rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-8 pt-9"
          >
            {/* Thin colored top edge — gives each card a journal-entry
                feel (like a tabbed file in a folder) rather than a
                generic feature card. Width and color are deliberately
                short and brand-anchored, not a full-width band. */}
            <span
              aria-hidden="true"
              className="absolute left-8 top-0 h-1 w-12 rounded-b-full bg-[color:var(--color-primary)]"
            />
            {/* Tracked uppercase Inter rather than font-mono — no
                monospace font is loaded via next/font, so font-mono
                would fall through to a system stack that varies by
                OS and breaks visual consistency. */}
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[color:var(--color-primary)]">
              {v.when}
            </div>
            <h3 className="mt-5 text-xl font-bold leading-snug text-[color:var(--color-text)] md:text-2xl">
              {v.headline}
            </h3>
            <p className="mt-4 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
              {v.scene}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}
