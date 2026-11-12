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
      "Veradic runs on top of Anthropic’s Claude with a classroom-safety system prompt layered on. The model is instructed not to do students’ homework for them, to refuse off-topic conversations, and to decline requests that would help a student cheat.",
      "In school mode, students only work on what their teacher assigned: they photograph their own homework for grading, and practice on problems their teacher approved. They can ask about a step of a practice problem, but they can’t chat freely with the AI.",
      "This closes the common jailbreak vectors you see with consumer chatbots — there’s no general-purpose chat surface for students to misuse.",
    ],
  },
];

/**
 * The two questions district counsel asks first, answered concretely:
 * where the data lives, and how the model behaves. Two ruled columns on a
 * white band, side by side from md up.
 */
export function DataModelSafety() {
  return (
    <section id="data-model-safety" className="border-y border-hairline bg-white">
      <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-8 md:py-24">
        <h2 className="site-h2 max-w-[760px]">Where the data lives. How the model behaves.</h2>
        <p className="m-0 mt-5 max-w-[36em] text-lg leading-relaxed text-ink-soft">
          The two questions district counsel asks first, in plain&nbsp;English.
        </p>

        <div className="mt-11 grid gap-12 md:grid-cols-2 md:gap-14">
          {TOPICS.map((t) => (
            <div key={t.heading} className="border-t-2 border-ink pt-5">
              <h3 className="m-0 text-[22px] font-black tracking-[-0.02em]">{t.heading}</h3>
              <ul className="m-0 mt-4 list-none p-0">
                {t.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex gap-3 border-b border-rule py-3.5 text-base leading-[1.6] text-ink-soft last:border-b-0"
                  >
                    <span aria-hidden="true" className="mt-[11px] h-[2px] w-3 shrink-0 bg-veradic" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
