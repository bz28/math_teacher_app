import { Section } from "./section";
import { Eyebrow } from "./eyebrow";
import { IntegrityInterview } from "./integrity-interview";

/**
 * Section #3 — the integrity layer. The page's signature choreographed moment:
 * an animated interview where a correct answer gets interrogated and flagged,
 * resolving into the real teacher verdict. The copy leads with the dual purpose
 * (catches both copying AND misunderstanding) — the pedagogical positioning.
 */
export function HomeIntegrity() {
  return (
    <Section variant="alt" id="integrity">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>The integrity layer</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Know if they did the work&nbsp;&mdash; and if they{" "}
          <span className="font-display-serif italic text-[color:var(--color-primary)]">
            understand it.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)] md:text-xl">
          After a submission, Veradic asks the student to explain their own
          steps. Some can&rsquo;t because they copied. Some can&rsquo;t because
          they&rsquo;re lost. You catch both &mdash; before the test.
        </p>
      </div>

      <div className="mt-14 md:mt-20">
        <IntegrityInterview />
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-[color:var(--color-text-muted)]">
        You see the grade, the flag, and the full conversation &mdash; and you
        decide. Veradic drafts; you publish.
      </p>
    </Section>
  );
}
