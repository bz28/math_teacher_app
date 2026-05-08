import { Section } from "../section";
import { Eyebrow } from "../eyebrow";

type Step = { num: string; title: string; desc: string };

const STEPS: Step[] = [
  {
    num: "1",
    title: "We create your school account",
    desc: "We handle the initial setup. You give us your school name and the teachers who'll be invited.",
  },
  {
    num: "2",
    title: "Teachers receive invites",
    desc: "Each teacher gets a single email and a 5-minute setup. They organize their courses and sections.",
  },
  {
    num: "3",
    title: "Students join with a 6-character code",
    desc: "No student emails required. No district SSO integration required. Teachers share a code, students enter it.",
  },
  {
    num: "4",
    title: "First homework set goes live",
    desc: "Most teachers run their first integrity-checked assignment within a week — same day if motivated.",
  },
  {
    num: "5",
    title: "You can pilot a single classroom first",
    desc: "Run with one teacher, one class. See the data, sign the paperwork, then expand on your timeline.",
  },
];

/**
 * Numbered deployment timeline. Visual reuses the StepItem pattern
 * from the demo page (kept inline rather than extracted, since the
 * two pages have meaningfully different copy and don't share many
 * other props).
 */
export function DeploymentTimeline() {
  return (
    <Section variant="default" id="deployment">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <Eyebrow>Deployment</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Live with students in a week. Or a day.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
            No SSO project. No PII spreadsheet. No IT ticket.
          </p>
        </div>

        <ol className="mt-14 space-y-8">
          {STEPS.map((step) => (
            <li key={step.num} className="flex gap-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary-bg)] font-mono text-sm font-bold text-[color:var(--color-primary)]">
                {step.num}
              </div>
              <div className="pt-1">
                <h3 className="text-lg font-bold text-[color:var(--color-text)]">
                  {step.title}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
                  {step.desc}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
