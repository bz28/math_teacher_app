import Link from "next/link";
import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Pillar = {
  title: string;
  body: string;
  icon: React.ReactNode;
};

const pillars: Pillar[] = [
  {
    title: "Student data privacy",
    body: "We only collect what's needed for learning. Full export and deletion on request.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: "Academic integrity checks",
    body: "Follow-up questions verify every submission was actually done by the student.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    title: "Content moderation",
    body: "Classroom-safe by default. Teachers control what students can see and ask.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h8" />
      </svg>
    ),
  },
  {
    title: "Transparent AI logs",
    body: "Teachers and admins can review every AI interaction at any time.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
];

export function HomeIntegrity() {
  return (
    <Section variant="default">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>Built to be safe in schools</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Every decision we make
          <br />
          starts with &ldquo;is this safe in a classroom?&rdquo;
        </h2>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-4">
        {pillars.map((p) => (
          <div
            key={p.title}
            className="marketing-card rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] p-6"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]">
              <div className="h-5 w-5">{p.icon}</div>
            </div>
            <h3 className="text-base font-bold text-[color:var(--color-text)]">
              {p.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
              {p.body}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-10 text-center">
        <Link
          href="/security"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--color-primary)] hover:underline"
        >
          Read the full security posture
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
    </Section>
  );
}
