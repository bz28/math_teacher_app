import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

type Pillar = {
  title: string;
  body: string;
  visual: string; // placeholder description
  icon: React.ReactNode;
};

const pillars: Pillar[] = [
  {
    title: "Teaches, doesn't tell.",
    body: "Students don't get a dropped answer. They get guided questions, hints, and step-by-step reasoning that take them to the right answer on their own — so the thinking sticks.",
    visual: "Step decomposition screenshot with a chat bubble on one of the steps",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="M4.93 4.93l2.83 2.83" />
        <path d="M16.24 16.24l2.83 2.83" />
        <path d="M2 12h4" />
        <path d="M18 12h4" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    ),
  },
  {
    title: "Catches work that isn't theirs.",
    body: "Our integrity checker asks students follow-up questions about their own submissions. If they didn't actually do the work, we can tell — and so can you.",
    visual: "Integrity flag UI with follow-up questions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Teacher-controlled content.",
    body: "Teachers upload materials, approve AI-generated questions, and build homework from a locked bank. No open photo uploads. No jailbreaks. No surprises.",
    visual: "Question bank approval view — teacher reviewing AI-generated problems",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M9 7h6" />
        <path d="M9 11h4" />
      </svg>
    ),
  },
];

export function HomePillars() {
  return (
    <Section variant="default" id="how-it-works">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow>How Veradic works</Eyebrow>
        <h2 className="mt-6 text-display-lg text-[color:var(--color-text)]">
          Three things no other AI tutor gets right.
        </h2>
        <p className="mt-6 text-xl font-medium leading-snug text-[color:var(--color-text-secondary)] md:text-2xl">
          Everything else is a feature. These three are the reason Veradic
          belongs in a classroom.
        </p>
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-3 md:gap-8">
        {pillars.map((p, i) => (
          <div
            key={p.title}
            className="marketing-card flex flex-col rounded-2xl border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] p-8"
          >
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--color-primary-bg)] text-[color:var(--color-primary)]">
              <div className="h-6 w-6">{p.icon}</div>
            </div>
            <span className="mb-2 text-xs font-semibold tracking-widest text-[color:var(--color-text-muted)]">
              0{i + 1}
            </span>
            <h3 className="text-2xl font-bold leading-tight text-[color:var(--color-text)]">
              {p.title}
            </h3>
            <p className="mt-4 text-base leading-relaxed text-[color:var(--color-text-secondary)]">
              {p.body}
            </p>
            {/* TODO: replace with real screenshot — {p.visual} */}
            <div className="mt-6 flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface-alt)] text-xs text-[color:var(--color-text-muted)]">
              Screenshot placeholder
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
