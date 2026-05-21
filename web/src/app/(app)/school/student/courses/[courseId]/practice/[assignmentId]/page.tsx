"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  schoolStudent,
  type MasteryState,
  type PracticeProblemOverview,
  type PracticeSetOverview,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

/**
 * Practice set Overview — the entry surface for the Mastery Loop.
 *
 * Replaces the previous flat list of per-problem "Answer / Learn it"
 * cards with a journey-shaped view: mastery aggregates at top, a
 * single smart-resume CTA, a dot map of every problem so the student
 * can jump anywhere, and a "Worth a second look" panel surfacing the
 * problems they previously missed.
 *
 * The page deliberately ships ZERO answer-revealing data via the
 * overview endpoint — `final_answer`, `distractors`, and
 * `solution_steps` are not on the response. The dot map renders from
 * the mastery state alone, so a student can't read answers off it.
 * Solution steps enter view only via the walkthrough endpoint inside
 * the session page.
 */
export default function PracticeSetPage() {
  const { courseId, assignmentId } = useParams<{
    courseId: string;
    assignmentId: string;
  }>();
  const router = useRouter();
  const [overview, setOverview] = useState<PracticeSetOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startingResume, setStartingResume] = useState(false);

  useEffect(() => {
    if (!assignmentId) return;
    schoolStudent
      .practiceSetOverview(assignmentId)
      .then(setOverview)
      .catch(() => setError("Couldn't load this practice set. Please try again."));
  }, [assignmentId]);

  const handleResume = useCallback(async () => {
    if (!assignmentId || startingResume) return;
    setStartingResume(true);
    try {
      const next = await schoolStudent.practiceNextProblem(assignmentId);
      if (next.status === "complete") {
        // Set fully mastered — pick the most-attempted problem to
        // re-attempt cold rather than dumping the student into an
        // empty session.
        const reattemptTarget = (overview?.problems ?? [])
          .filter((p) => p.attempts > 0)
          .sort((a, b) => b.attempts - a.attempts)[0];
        if (reattemptTarget) {
          router.push(
            `/school/student/courses/${courseId}/practice/${assignmentId}/session?start=${reattemptTarget.bank_item_id}`,
          );
        } else {
          // Nothing to re-attempt either — empty set. Stay on
          // overview; the empty-state UI below handles it.
          setStartingResume(false);
        }
        return;
      }
      router.push(
        `/school/student/courses/${courseId}/practice/${assignmentId}/session?start=${next.problem.bank_item_id}`,
      );
    } catch {
      setError("Couldn't resume the session. Try again.");
      setStartingResume(false);
    }
  }, [assignmentId, courseId, overview, router, startingResume]);

  if (error) {
    return <p className="mx-auto max-w-2xl py-12 text-center text-error">{error}</p>;
  }
  if (overview === null) {
    return (
      <p className="mx-auto max-w-2xl py-12 text-center text-text-muted">Loading…</p>
    );
  }

  const total = overview.problems.length;
  const allMastered = total > 0 && overview.mastered_count === total;
  const reviewProblems = overview.problems
    .filter((p) => p.mastery_state === "missed" || p.mastery_state === "attempted" || p.mastery_state === "walked_through")
    .sort((a, b) => {
      const ta = a.last_attempt_at ? new Date(a.last_attempt_at).getTime() : 0;
      const tb = b.last_attempt_at ? new Date(b.last_attempt_at).getTime() : 0;
      return tb - ta;
    });

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/school/student/courses/${courseId}?tab=practice`}
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
      >
        ← Back to practice
      </Link>

      {/* ── Header ── */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4 border-b border-border-light pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">
            {overview.title}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {total} {total === 1 ? "problem" : "problems"} · Ungraded
            {overview.source_homework_title && (
              <>
                {" · Cloned from "}
                <span className="font-medium">{overview.source_homework_title}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-baseline gap-6 text-right">
          <CountStat n={overview.mastered_count} label="Mastered" />
          <CountStat n={overview.in_progress_count} label="In progress" />
          <CountStat n={overview.not_started_count} label="Not started" />
        </div>
      </div>

      {/* ── Hero + CTA ── */}
      {total > 0 && (
        <section className="mt-6 grid gap-5 md:grid-cols-[1.4fr_1fr]">
          <HeroCard
            mastered={overview.mastered_count}
            total={total}
            allMastered={allMastered}
          />
          <CTACard
            allMastered={allMastered}
            starting={startingResume}
            onStart={handleResume}
          />
        </section>
      )}

      {/* ── Dot map ── */}
      <section className="mt-10">
        <SectionTitle
          title="The whole set, at a glance"
          subtitle="tap any problem to jump in"
        />
        {total === 0 ? (
          <div className="mt-4 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center">
            <p className="text-sm font-semibold text-text-primary">
              Still being prepared
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Your teacher is generating the problems for this set. Check back
              in a minute.
            </p>
          </div>
        ) : (
          <DotMap
            problems={overview.problems}
            courseId={courseId}
            assignmentId={assignmentId}
          />
        )}
      </section>

      {/* ── Worth a second look ── */}
      {reviewProblems.length > 0 && (
        <section className="mt-10">
          <SectionTitle
            title="Worth a second look"
            subtitle="problems you got wrong or had to walk through"
          />
          <ReviewList
            problems={reviewProblems}
            courseId={courseId}
            assignmentId={assignmentId}
          />
        </section>
      )}
    </div>
  );
}

// ── Section header ──

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-xl font-bold text-text-primary">{title}</h2>
      <span className="text-xs italic text-text-muted">{subtitle}</span>
    </div>
  );
}

function CountStat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-bold tabular-nums text-text-primary">{n}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
        {label}
      </div>
    </div>
  );
}

// ── Hero ──

function HeroCard({
  mastered,
  total,
  allMastered,
}: {
  mastered: number;
  total: number;
  allMastered: boolean;
}) {
  const pct = total > 0 ? (mastered / total) * 100 : 0;
  return (
    <div className="relative overflow-hidden rounded-[--radius-xl] border border-border bg-surface px-7 py-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
        Your progress
      </p>
      <h2 className="mt-3 max-w-[28ch] text-2xl font-bold leading-tight tracking-tight text-text-primary">
        {allMastered ? (
          <>You&rsquo;ve <em className="not-italic text-primary">mastered</em> this whole set.</>
        ) : mastered === 0 ? (
          <>Ready when you are.</>
        ) : (
          <>
            You&rsquo;re{" "}
            <em className="not-italic text-primary">
              {fractionWord(mastered, total)}
            </em>{" "}
            of the way through.
          </>
        )}
      </h2>
      <div className="mt-6 flex items-baseline gap-3">
        <span className="text-5xl font-extrabold tracking-tight text-primary">
          {mastered}
        </span>
        <span className="text-base italic text-text-muted">of</span>
        <span className="text-2xl font-bold text-text-secondary">{total}</span>
        <span className="ml-auto text-xs text-text-muted">
          answered correctly on the first try
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-text-secondary">
        <LegendSwatch tone="mastered" label="Mastered" />
        <LegendSwatch tone="attempted" label="Attempted" />
        <LegendSwatch tone="missed" label="Got wrong" />
        <LegendSwatch tone="not_started" label="Not started" />
      </div>
    </div>
  );
}

function LegendSwatch({ tone, label }: { tone: MasteryState; label: string }) {
  const cls = TONE[tone].swatch;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-2 rounded-full", cls)} />
      {label}
    </span>
  );
}

// ── CTA ──

function CTACard({
  allMastered,
  starting,
  onStart,
}: {
  allMastered: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[--radius-xl] bg-primary p-7 text-text-on-primary">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-on-primary/55">
        {allMastered ? "Stay sharp" : "Pick up where you left off"}
      </p>
      <h3 className="mt-2 max-w-[18ch] text-2xl font-bold leading-tight tracking-tight">
        {allMastered ? "Re-attempt to keep it cold." : "Start studying."}
      </h3>
      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="mt-7 inline-flex w-full items-center justify-between gap-2 rounded-[--radius-md] bg-surface px-5 py-3 text-sm font-bold text-primary-dark transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{starting ? "Loading…" : allMastered ? "Re-attempt" : "Start studying"}</span>
        <span aria-hidden className="text-lg">→</span>
      </button>
    </div>
  );
}

// ── Dot map ──

const TONE: Record<
  MasteryState,
  { swatch: string; cell: string; label: string; glyph: string }
> = {
  mastered: {
    swatch: "bg-success",
    cell: "border-success-border bg-success-light text-success",
    label: "Mastered",
    glyph: "✓",
  },
  attempted: {
    swatch: "bg-amber-500",
    cell: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300",
    label: "Attempted",
    glyph: "◐",
  },
  walked_through: {
    swatch: "bg-amber-500",
    cell: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300",
    label: "Walked through",
    glyph: "◐",
  },
  missed: {
    swatch: "bg-red-500",
    cell: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300",
    label: "Got wrong",
    glyph: "↻",
  },
  not_started: {
    swatch: "bg-bg-subtle border border-border-light",
    cell: "border-border-light bg-bg-subtle text-text-muted",
    label: "Not started",
    glyph: "·",
  },
};

function DotMap({
  problems,
  courseId,
  assignmentId,
}: {
  problems: PracticeProblemOverview[];
  courseId: string;
  assignmentId: string;
}) {
  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-5">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
        {problems.map((p) => (
          <Link
            key={p.bank_item_id}
            href={`/school/student/courses/${courseId}/practice/${assignmentId}/session?start=${p.bank_item_id}`}
            aria-label={`Problem ${p.position}, ${TONE[p.mastery_state].label}`}
            title={TONE[p.mastery_state].label}
            className={cn(
              "group relative flex aspect-[1.6/1] flex-col justify-between rounded-[--radius-sm] border p-2 transition-transform hover:-translate-y-px",
              TONE[p.mastery_state].cell,
            )}
          >
            <span className="font-mono text-[10px] font-semibold opacity-60">
              {String(p.position).padStart(2, "0")}
            </span>
            <span className="self-end text-base font-bold leading-none">
              {TONE[p.mastery_state].glyph}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Review list ──

function ReviewList({
  problems,
  courseId,
  assignmentId,
}: {
  problems: PracticeProblemOverview[];
  courseId: string;
  assignmentId: string;
}) {
  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface">
      {problems.map((p, i) => (
        <Link
          key={p.bank_item_id}
          href={`/school/student/courses/${courseId}/practice/${assignmentId}/session?start=${p.bank_item_id}`}
          className={cn(
            "group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-bg-subtle/60",
            i !== problems.length - 1 && "border-b border-border-light",
          )}
        >
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
              p.mastery_state === "missed"
                ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
            )}
          >
            {p.mastery_state === "missed" ? "Got wrong" : "Walked through"}
          </span>
          <span className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-text-primary">
            <MathText text={p.question} />
          </span>
          <span className="hidden font-mono text-xs text-text-muted sm:inline">
            {relativeWhen(p.last_attempt_at)}
          </span>
          <span aria-hidden className="text-base text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}

// ── small utils ──

function fractionWord(n: number, total: number): string {
  if (total === 0) return "no problems";
  const ratio = n / total;
  if (ratio >= 0.95) return "almost there";
  if (ratio >= 0.75) return "three quarters";
  if (ratio >= 0.6) return "two thirds";
  if (ratio >= 0.45) return "half";
  if (ratio >= 0.3) return "a third";
  if (ratio >= 0.15) return "a quarter";
  return "getting started";
}

function relativeWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
