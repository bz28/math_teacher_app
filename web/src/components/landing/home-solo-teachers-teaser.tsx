import Link from "next/link";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Feature = {
  label: string;
  description: string;
};

/**
 * Section #7a — solo-teachers teaser. Sits directly above the
 * districts teaser so the page reads "two distinct audiences,
 * here's what each gets." Mirrors the districts-teaser column
 * shape (left = copy + CTA, right = hairline-divided value list)
 * so the back-to-back rhythm feels intentional rather than bolted on.
 *
 * The right-hand list is what's included in the free tier — Pro
 * details (unlimited generation, $19/mo) live on /pricing. Here we
 * just need to get a teacher to click "Start free" without making
 * them parse a pricing table first.
 */
const FEATURES: Feature[] = [
  {
    label: "10 AI problems / day",
    description: "Generate practice and homework from a topic or worksheet.",
  },
  {
    label: "AI grading drafts",
    description: "Every submission scored, with feedback you can edit.",
  },
  {
    label: "Unlimited classes",
    description: "Add as many sections and students as you teach.",
  },
  {
    label: "Always free",
    description: "Upgrade to $19/mo for unlimited generation when ready.",
  },
];

export function HomeSoloTeachersTeaser() {
  return (
    <Section variant="alt" id="solo-teachers-teaser">
      <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-16">
        <div>
          <Eyebrow>For solo teachers</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            Try Veradic without a sales call.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
            Sign up in 30 seconds, generate your first 10 practice
            problems today. No credit card. No demo to schedule.
            Bring your own students, or build a class from scratch.
          </p>
          <Link
            href="/register?role=teacher"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[color:var(--color-primary)] px-6 py-3 text-base font-bold text-white transition-colors hover:bg-[color:var(--color-primary-dark)]"
          >
            Start free
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* Feature stack — hairline-divided rows mirror the districts
            teaser's compliance chip pattern. Same visual restraint;
            label is the feature, follow line gives one-sentence
            depth without forcing a click to /pricing. */}
        <ul className="rounded-[--radius-lg] border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-border-light)]">
          {FEATURES.map((f) => (
            <li key={f.label} className="px-6 py-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                {f.label}
              </div>
              <div className="mt-1 text-sm font-medium leading-relaxed text-[color:var(--color-text)]">
                {f.description}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
