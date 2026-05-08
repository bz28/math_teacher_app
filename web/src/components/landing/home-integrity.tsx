import { Section } from "./section";
import { Eyebrow } from "./eyebrow";
import { IntegrityReviewCard } from "./integrity-review-card";

/**
 * Section #3 of the homepage — the integrity layer. The page's only
 * choreographed visual moment, by design: every other section is
 * type-led or static product proof, and this one is what a teacher
 * has never seen before, so it earns the attention budget.
 *
 * The framing copy reflects the dual purpose of the integrity check:
 * it surfaces both students who didn't do the work AND students who
 * did the work but don't understand it. That dual-meaning is the
 * pedagogical positioning — not a surveillance tool, an evaluation
 * tool that catches cheating as a side effect.
 */
export function HomeIntegrity() {
  return (
    <Section variant="alt" id="integrity">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>The integrity layer</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Know what each student actually understands.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          After every submission, Veradic asks the student about specific
          steps in their own work. Some can&rsquo;t explain because they
          didn&rsquo;t do it. Some can&rsquo;t explain because they
          don&rsquo;t understand it. Either way, you find out before the
          unit test.
        </p>
      </div>

      <div className="mt-14 md:mt-20">
        <IntegrityReviewCard
          studentName="Maya Chen"
          className="Algebra II · Period 3"
          assignmentTitle="Problem set 4 — Trig identities"
          submittedAgo="2 hours ago"
          score={32}
          verdict="FLAGGED"
          headline="Used the double-angle identity correctly but couldn't explain why it applied."
          evidenceBullets={[
            "Couldn't recall what step 3 represented when asked.",
            "Said “I think I copied that part” about the substitution.",
          ]}
        />
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        You see the score, the headline, the conversation, and you decide.
        Veradic drafts; you publish.
      </p>
    </Section>
  );
}
