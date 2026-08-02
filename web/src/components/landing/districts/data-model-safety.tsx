import { Section } from "../section";

type Topic = {
  heading: string;
  bullets: string[];
};

const TOPICS: Topic[] = [
  {
    heading: "Data hosting & retention",
    bullets: [
      "Student and school data is stored in encrypted databases hosted in United States data centers. Backups are encrypted at rest.",
      "Schools can request a full data export or deletion at any time. We don’t hold student records hostage.",
      "On account closure, identifiable data is deleted within 30 days. We retain only the anonymized aggregates we need to keep the service running.",
      "We don’t build advertising profiles. We don’t sell data. Identifiable student data isn’t shared with third parties beyond the infrastructure providers needed to operate the service.",
    ],
  },
  {
    heading: "Model safety & content moderation",
    bullets: [
      "Veradic runs on top of Anthropic’s Claude with a classroom-safety system prompt layered on. The model is instructed to never hand students the final answer directly, refuse off-topic conversations, and decline requests that would help a student cheat.",
      "In school mode, students cannot upload arbitrary photos or chat freely with the AI. They can only work on problems from their teacher’s approved bank.",
      "This closes the common jailbreak vectors you see with consumer chatbots — there’s no general-purpose chat surface for students to misuse.",
    ],
  },
];

/**
 * Detailed operational section between the high-level compliance
 * grid (one-line cells) and the deployment timeline. Procurement
 * legal teams ask about data hosting, retention, and model-level
 * safety in concrete terms; this section answers those without
 * forcing them to email us first.
 *
 * Two cards, side-by-side on desktop, stacked on mobile.
 */
export function DataModelSafety() {
  return (
    <Section variant="alt2" id="data-model-safety">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Where the data lives. How the model behaves.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
          The two questions district counsel asks first, in
          plain&nbsp;English.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2 md:gap-8">
        {TOPICS.map((t) => (
          <article
            key={t.heading}
            className="rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-8"
          >
            <h3 className="text-xl font-bold text-[color:var(--color-text)]">
              {t.heading}
            </h3>
            <ul className="mt-5 space-y-4">
              {t.bullets.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-3 text-base leading-relaxed text-[color:var(--color-text-secondary)]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2.5 inline-block h-1 w-3 shrink-0 rounded-full bg-[color:var(--color-primary-light)]"
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Section>
  );
}
