import { Section } from "./section";
import { Eyebrow } from "./eyebrow";

/**
 * Section #4 — inside the teacher workspace. Three composed UI
 * mocks shown as a horizontal daily-workflow flow on desktop, a
 * vertical stack on mobile. The mocks are intentionally stylized
 * miniatures of the real dashboard surfaces, not raw screenshots:
 * polished, in-workflow objects that read as designed artifacts
 * rather than UI dumps.
 *
 * The three surfaces are ordered by the recurring daily workflow,
 * not the one-time setup chore: (1) the question bank you assign
 * from, (2) the submissions queue with integrity scores rolling in,
 * (3) the grading override view. Setup (textbook upload) is the
 * friction we hide; daily workflow is the value.
 */
export function HomeWorkspace() {
  return (
    <Section variant="invert" id="workspace">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow variant="invert">Inside the workspace</Eyebrow>
        <h2 className="mt-6 text-display-md text-[color:var(--color-invert-text)]">
          Sunday-night prep, done in five minutes.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--color-invert-text-muted)] md:text-xl">
          Build a question bank in five minutes. Assign it. Watch the
          integrity scores roll in. Grade with one finger.
        </p>
      </div>

      {/* Workflow trio — three framed UI mocks, captioned. Frames and
          captions render in two separate aligned grids on desktop so
          the row of captions stays on a single horizontal baseline,
          regardless of frame intrinsic heights. On mobile, frames
          stack with their captions immediately below. */}
      <div className="mt-16 md:mt-20">
        {/* Desktop: split frame grid + caption grid. */}
        <div className="hidden md:grid md:grid-cols-[1fr_1.15fr_1fr] md:items-end md:gap-6">
          <FrameCard><QuestionBankMock /></FrameCard>
          <FrameCard emphasized><SubmissionsQueueMock /></FrameCard>
          <FrameCard><GradingMock /></FrameCard>
        </div>
        <div className="mt-6 hidden md:grid md:grid-cols-[1fr_1.15fr_1fr] md:gap-6">
          <FrameCaption>The asset you build once.</FrameCaption>
          <FrameCaption>A verdict per student, in plain English.</FrameCaption>
          <FrameCaption>Glance, override, publish.</FrameCaption>
        </div>

        {/* Mobile: vertical stack, captions attached to their frames. */}
        <div className="grid gap-10 md:hidden">
          <div>
            <FrameCard><QuestionBankMock /></FrameCard>
            <div className="mt-4">
              <FrameCaption>The asset you build once.</FrameCaption>
            </div>
          </div>
          <div>
            <FrameCard emphasized><SubmissionsQueueMock /></FrameCard>
            <div className="mt-4">
              <FrameCaption>A verdict per student, in plain English.</FrameCaption>
            </div>
          </div>
          <div>
            <FrameCard><GradingMock /></FrameCard>
            <div className="mt-4">
              <FrameCaption>Glance, override, publish.</FrameCaption>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function FrameCard({
  children,
  emphasized,
}: {
  children: React.ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div className={emphasized ? "md:scale-[1.04]" : ""}>
      {/* Frame floats over the dark inverted bg via a soft warm-ink
          shadow + hairline-light border on the cream surface. The
          emphasized frame gets a slightly deeper shadow; the green
          tint that used to glow under each frame was the chief
          "AI startup" tell on this section. Scale stays modest (1.04). */}
      <div
        className={`overflow-hidden rounded-[--radius-lg] border border-[color:var(--color-invert-border)] bg-[color:var(--color-surface)] ${
          emphasized
            ? "shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]"
            : "shadow-[0_16px_40px_-20px_rgba(0,0,0,0.28)]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function FrameCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-sm leading-relaxed text-[color:var(--color-invert-text-muted)]">
      {children}
    </p>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Mock 1 — Question bank. Stylized miniature of the HW tab's question
   list. Rows show a topic chip + a snippet of the problem stem.
   ────────────────────────────────────────────────────────────────── */
function QuestionBankMock() {
  const questions = [
    { chip: "Identities", body: "Verify sin(2x) = 2 sin(x) cos(x)…" },
    { chip: "Identities", body: "Simplify 1 − cos²(θ) using a Pythag…" },
    { chip: "Equations", body: "Solve 2 sin²(x) − 1 = 0 on [0, 2π]…" },
    { chip: "Identities", body: "Prove tan(x) + cot(x) = sec(x)csc(x)…" },
  ];
  return (
    <div>
      <MockHeader breadcrumb="Algebra II · HW" title="Trig identities" />
      <div className="divide-y divide-[color:var(--color-border-light)]">
        {questions.map((q, i) => (
          <div key={i} className="flex min-w-0 items-start gap-3 px-4 py-3">
            <span className="mt-0.5 inline-flex shrink-0 rounded-full bg-[color:var(--color-primary-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-primary)]">
              {q.chip}
            </span>
            {/* min-w-0 + flex-1 lets truncate actually take effect on
                a flex child — without it the span keeps its intrinsic
                width and overflows the row. */}
            <span className="min-w-0 flex-1 truncate text-xs leading-relaxed text-[color:var(--color-text-secondary)]">
              {q.body}
            </span>
          </div>
        ))}
      </div>
      {/* Static caption-style row — was reading as a clickable
          affordance because of the bg + accent color. Demoted to a
          tracked uppercase footer label so it conveys the capability
          without inviting a dead click. */}
      <div className="border-t border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-text-muted)]">
        Generate 5 more like these →
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Mock 2 — Submissions queue (centerpiece). Roster rows with
   completion + integrity score. One flagged row in error color is
   the quietly meaningful detail of the whole composition.
   ────────────────────────────────────────────────────────────────── */
function SubmissionsQueueMock() {
  // Verdict labels + colors mirror the disposition vocabulary in the
  // real Submission Review screen — `flag_for_review` (red ⚑),
  // `tutor_pivot` (amber ?), `pass` (green ✓), `needs_practice`
  // (blue ↻). Keeping the marketing mock honest: a teacher who
  // signs up sees this exact icon + label set in the product, not a
  // marketing-only "Integrity score 88%" abstraction.
  const rows: {
    name: string;
    done: boolean;
    verdict: "flag" | "tutor" | "pass" | "needs_practice" | null;
  }[] = [
    { name: "Maya Chen", done: true, verdict: "flag" },
    { name: "Jordan Patel", done: true, verdict: "pass" },
    { name: "Sam Rivera", done: true, verdict: "pass" },
    { name: "Avery Kim", done: false, verdict: null },
    { name: "Devin Brooks", done: true, verdict: "needs_practice" },
  ];
  return (
    <div>
      <MockHeader breadcrumb="Algebra II · Period 3" title="Problem set 4 · Submissions" />
      {/* Column header strip */}
      <div className="grid grid-cols-[1.6fr_auto_auto] items-center gap-3 border-b border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
        <span>Student</span>
        <span>Status</span>
        <span className="w-20 text-right">Verdict</span>
      </div>
      <div className="divide-y divide-[color:var(--color-border-light)]">
        {rows.map((r) => (
          <div
            key={r.name}
            className="grid grid-cols-[1.6fr_auto_auto] items-center gap-3 px-4 py-2.5"
          >
            <span className="min-w-0 truncate text-xs font-medium text-[color:var(--color-text)]">
              {r.name}
            </span>
            <span className="shrink-0">
              {r.done ? (
                <CheckIcon />
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-muted)]">
                  Pending
                </span>
              )}
            </span>
            <span className="w-20 text-right">
              <VerdictPill verdict={r.verdict} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact disposition pill — same icon + tone family as the
 *  platform's IntegrityBanner, just shrunk for the marketing roster. */
function VerdictPill({
  verdict,
}: {
  verdict: "flag" | "tutor" | "pass" | "needs_practice" | null;
}) {
  if (verdict === null) {
    return <span className="text-[10px] text-[color:var(--color-text-muted)]">—</span>;
  }
  const styles: Record<
    "flag" | "tutor" | "pass" | "needs_practice",
    { bg: string; fg: string; icon: string; label: string }
  > = {
    flag: {
      bg: "var(--color-error-light)",
      fg: "var(--color-error)",
      icon: "⚑",
      // "Review" matches the actual platform label for the
      // `flag_for_review` disposition. The earlier "Flag" looked
      // punchier in the marketing mock but didn't match what teachers
      // see in the product, so we'd be teaching them the wrong word.
      label: "Review",
    },
    tutor: {
      bg: "var(--color-warning-bg)",
      fg: "var(--color-warning-dark)",
      icon: "?",
      label: "Tutored",
    },
    pass: {
      bg: "var(--color-success-light)",
      fg: "var(--color-success)",
      icon: "✓",
      label: "Pass",
    },
    needs_practice: {
      // Hardcoded blue tokens to match the platform's IntegrityBanner
      // — `--color-primary` is brand-green in this theme, so reusing
      // `--color-primary-bg` painted the marketing pill green while
      // the live UI shows blue. Mock now matches the product.
      bg: "rgb(239 246 255)",
      fg: "rgb(29 78 216)",
      icon: "↻",
      label: "Practice",
    },
  };
  const s = styles[verdict];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Mock 3 — Grading override. AI's draft score with rubric, teacher
   override input, publish button.
   ────────────────────────────────────────────────────────────────── */
function GradingMock() {
  return (
    <div>
      <MockHeader breadcrumb="Grading" title="Maya Chen · PS 4" />
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-muted)]">
            AI draft
          </span>
          <span className="text-base font-bold text-[color:var(--color-text)]">
            14<span className="text-xs text-[color:var(--color-text-muted)]"> / 20</span>
          </span>
        </div>
        <div className="space-y-1.5">
          <RubricRow label="Setup" got={4} of={4} />
          <RubricRow label="Method" got={5} of={6} />
          <RubricRow label="Reasoning" got={2} of={6} dim />
          <RubricRow label="Final" got={3} of={4} />
        </div>
      </div>
      <div className="border-t border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-muted)]">
            Override
          </span>
          <span className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-1 text-xs font-semibold text-[color:var(--color-text)]">
            14
          </span>
        </div>
        <div className="mt-2 rounded-md bg-[color:var(--color-primary)] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-white">
          Publish
        </div>
      </div>
    </div>
  );
}

function RubricRow({
  label,
  got,
  of,
  dim,
}: {
  label: string;
  got: number;
  of: number;
  dim?: boolean;
}) {
  const pct = (got / of) * 100;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 shrink-0 text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-border-light)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: dim
              ? "var(--color-warning-dark)"
              : "var(--color-primary)",
          }}
        />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-[color:var(--color-text-muted)]">
        {got}/{of}
      </span>
    </div>
  );
}

function MockHeader({
  breadcrumb,
  title,
}: {
  breadcrumb: string;
  title: string;
}) {
  return (
    <div className="border-b border-[color:var(--color-border-light)] bg-[color:var(--color-surface-alt)] px-4 py-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-text-muted)]">
        {breadcrumb}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold text-[color:var(--color-text)]">
        {title}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-[color:var(--color-success)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

