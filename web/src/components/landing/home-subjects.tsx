import Link from "next/link";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type SubjectCard = {
  slug: "math" | "physics" | "chemistry";
  name: string;
  tagline: string;
  accent: string;
  accentBg: string;
};

const subjects: SubjectCard[] = [
  {
    slug: "math",
    name: "Math",
    tagline: "Middle school math through AP Calculus BC, statistics, word problems, and proofs.",
    accent: "#6C5CE7",
    accentBg: "rgba(108, 92, 231, 0.08)",
  },
  {
    slug: "physics",
    name: "Physics",
    tagline: "Conceptual physics through AP Physics C — mechanics, electricity, magnetism, and beyond.",
    accent: "#0984E3",
    accentBg: "rgba(9, 132, 227, 0.08)",
  },
  {
    slug: "chemistry",
    name: "Chemistry",
    tagline: "Intro chem through AP Chemistry and organic — atoms, bonding, stoichiometry, and reactions.",
    accent: "#00B894",
    accentBg: "rgba(0, 184, 148, 0.08)",
  },
];

export function HomeSubjects() {
  return (
    <Section variant="alt">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <Eyebrow>Subjects we support</Eyebrow>
          <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
            One tutor. Every subject
            <br />
            your students need.
          </h2>
        </div>
        <p className="max-w-lg text-xl font-medium leading-snug text-[color:var(--color-text-secondary)] md:text-2xl">
          Each subject page walks through how Veradic handles the specific
          kinds of problems your students see in class.
        </p>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {subjects.map((s) => (
          <Link
            key={s.slug}
            href={`/subjects/${s.slug}`}
            className="marketing-card group flex flex-col justify-between overflow-hidden rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-8 min-h-[280px]"
          >
            <div>
              <div
                className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest"
                style={{ background: s.accentBg, color: s.accent }}
              >
                {s.name}
              </div>
              <p className="mt-6 text-xl font-bold leading-tight text-[color:var(--color-text)]">
                {s.tagline}
              </p>
            </div>
            <div className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--color-primary)] transition-transform group-hover:translate-x-1">
              Explore {s.name}
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
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-[color:var(--color-text-muted)]">
        Teaching something else?{" "}
        <a
          href="mailto:support@veradicai.com?subject=Subject%20request"
          className="font-semibold text-[color:var(--color-primary)] hover:underline"
        >
          Tell us what you teach →
        </a>
      </p>
    </Section>
  );
}
