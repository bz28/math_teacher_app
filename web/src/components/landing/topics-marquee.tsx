import { Eyebrow } from "./eyebrow";

type SubjectKey = "math" | "physics" | "chemistry";

type Topic = {
  label: string;
  subject: SubjectKey;
};

const SUBJECT_META: Record<
  SubjectKey,
  { name: string; accent: string; accentBg: string }
> = {
  math: {
    name: "Math",
    accent: "#6C5CE7",
    accentBg: "rgba(108, 92, 231, 0.10)",
  },
  physics: {
    name: "Physics",
    accent: "#0984E3",
    accentBg: "rgba(9, 132, 227, 0.10)",
  },
  chemistry: {
    name: "Chemistry",
    accent: "#00B894",
    accentBg: "rgba(0, 184, 148, 0.10)",
  },
};

const topics: Topic[] = [
  // Math
  { label: "Pre-Algebra", subject: "math" },
  { label: "Algebra I", subject: "math" },
  { label: "Algebra II", subject: "math" },
  { label: "Geometry", subject: "math" },
  { label: "Trigonometry", subject: "math" },
  { label: "Pre-Calculus", subject: "math" },
  { label: "Calculus AB", subject: "math" },
  { label: "Calculus BC", subject: "math" },
  { label: "Statistics", subject: "math" },
  { label: "Word Problems", subject: "math" },
  { label: "Proofs", subject: "math" },
  { label: "Linear Algebra", subject: "math" },
  // Physics
  { label: "Kinematics", subject: "physics" },
  { label: "Forces & Newton's Laws", subject: "physics" },
  { label: "Energy & Work", subject: "physics" },
  { label: "Momentum", subject: "physics" },
  { label: "Circular Motion", subject: "physics" },
  { label: "Gravity", subject: "physics" },
  { label: "Waves", subject: "physics" },
  { label: "Sound", subject: "physics" },
  { label: "Optics", subject: "physics" },
  { label: "Electricity", subject: "physics" },
  { label: "Magnetism", subject: "physics" },
  { label: "Thermodynamics", subject: "physics" },
  { label: "Modern Physics", subject: "physics" },
  // Chemistry
  { label: "Atoms & Elements", subject: "chemistry" },
  { label: "Periodic Trends", subject: "chemistry" },
  { label: "Chemical Bonding", subject: "chemistry" },
  { label: "Naming Compounds", subject: "chemistry" },
  { label: "Balancing Equations", subject: "chemistry" },
  { label: "Stoichiometry", subject: "chemistry" },
  { label: "Gas Laws", subject: "chemistry" },
  { label: "Solutions & Molarity", subject: "chemistry" },
  { label: "Thermochemistry", subject: "chemistry" },
  { label: "Equilibrium", subject: "chemistry" },
  { label: "Acids & Bases", subject: "chemistry" },
  { label: "Redox & Electrochemistry", subject: "chemistry" },
  { label: "Kinetics", subject: "chemistry" },
  { label: "Organic Chemistry", subject: "chemistry" },
];

// Shuffle topics so subjects interleave instead of clustering
function interleave(items: Topic[]): Topic[] {
  const byKey: Record<SubjectKey, Topic[]> = { math: [], physics: [], chemistry: [] };
  items.forEach((t) => byKey[t.subject].push(t));
  const order: SubjectKey[] = ["math", "physics", "chemistry"];
  const out: Topic[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const k of order) {
      const next = byKey[k].shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}

const interleaved = interleave(topics);
const row1 = interleaved.filter((_, i) => i % 2 === 0);
const row2 = interleaved.filter((_, i) => i % 2 === 1);

function TopicChip({ t }: { t: Topic }) {
  const meta = SUBJECT_META[t.subject];
  return (
    <div
      className="mx-2 flex flex-shrink-0 items-center gap-3 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-surface)] py-3 pl-3 pr-5 shadow-sm"
      style={{ borderColor: `${meta.accent}26` }}
    >
      <span
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: meta.accentBg }}
      >
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: meta.accent }}
        />
      </span>
      <div className="flex flex-col leading-tight">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: meta.accent }}
        >
          {meta.name}
        </span>
        <span className="text-sm font-semibold text-[color:var(--color-text)]">
          {t.label}
        </span>
      </div>
    </div>
  );
}

function MarqueeRow({
  items,
  direction,
}: {
  items: Topic[];
  direction: "left" | "right";
}) {
  const duped = [...items, ...items];
  const animClass =
    direction === "left" ? "animate-marquee-left" : "animate-marquee-right";
  return (
    <div className="overflow-x-hidden py-2">
      <div className={`flex w-max ${animClass}`}>
        {duped.map((t, i) => (
          <TopicChip key={`${t.subject}-${t.label}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

type TopicsMarqueeProps = {
  /** Background variant — default (surface) or alt (warm off-white). */
  variant?: "default" | "alt";
};

export function TopicsMarquee({ variant = "default" }: TopicsMarqueeProps) {
  const bg =
    variant === "alt"
      ? "bg-[color:var(--color-surface-alt)]"
      : "bg-[color:var(--color-surface)]";
  return (
    <section className={`w-full py-20 md:py-28 ${bg}`}>
      <div className="mx-auto mb-14 max-w-3xl px-6 text-center md:px-8">
        <Eyebrow>Topics we cover</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-text)]">
          Every topic your classroom touches.
        </h2>
        <p className="mt-4 text-xl font-medium leading-snug text-[color:var(--color-text-secondary)] md:text-2xl">
          From pre-algebra to organic chemistry — Veradic walks students
          through all of it.
        </p>
      </div>

      <div className="marquee-pause space-y-5">
        <MarqueeRow items={row1} direction="left" />
        <MarqueeRow items={row2} direction="right" />
      </div>
    </section>
  );
}
