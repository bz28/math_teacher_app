import Link from "next/link";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Stat = { value: string; label: string };

// TODO: replace with real pilot data once available
const stats: Stat[] = [
  { value: "6hrs", label: "saved per week on grading" },
  { value: "100%", label: "of students get 1-on-1 tutoring" },
  { value: "15min", label: "to assemble a week of homework" },
  { value: "0", label: "unsupervised AI chat with students" },
];

export function HomeTeachers() {
  return (
    <Section variant="default">
      <div className="grid gap-14 md:grid-cols-[1.1fr_1fr] md:gap-20">
        <div>
          <Eyebrow>For teachers</Eyebrow>
          <h2 className="mt-6 text-display-lg text-[color:var(--color-text)]">
            Reclaim your evenings.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[color:var(--color-text-secondary)]">
            You became a teacher to teach — not to photocopy worksheets at
            9pm or grade the same multiple-choice quiz 140 times. Veradic
            takes the repetitive work off your plate so you can focus on the
            parts of your job only a human can do.
          </p>
          <ul className="mt-8 space-y-4 text-base text-[color:var(--color-text-secondary)]">
            {[
              "Upload your unit materials. Veradic builds a question bank from what you already teach.",
              "Approve the questions you like. Ignore the ones you don't. You're always in control.",
              "Assign homework in one click. Every student gets a patient tutor, at their own pace.",
              "See exactly who struggled — and on what — before class Monday morning.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <svg
                  className="mt-1 h-5 w-5 flex-shrink-0 text-[color:var(--color-primary)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/teachers"
            className="mt-10 inline-flex items-center gap-2 text-base font-semibold text-[color:var(--color-primary)] hover:underline"
          >
            See everything built for teachers
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 self-center">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-6"
            >
              {/* TODO: replace placeholder stats with real pilot numbers */}
              <div className="text-5xl font-bold tracking-tight text-[color:var(--color-primary)]">
                {s.value}
              </div>
              <div className="mt-2 text-sm leading-snug text-[color:var(--color-text-secondary)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
