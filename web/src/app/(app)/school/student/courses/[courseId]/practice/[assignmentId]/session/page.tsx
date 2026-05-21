"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  schoolStudent,
  type AnswerResponse,
  type MasteryState,
  type PracticeProblemOverview,
  type PracticeSetOverview,
} from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";
import { MCQCard } from "@/components/shared/mcq-card";
import { MathText } from "@/components/shared/math-text";
import { useConfetti } from "@/components/ui/confetti";
import { cn } from "@/lib/utils";
import { WalkthroughPanel } from "./_components/walkthrough-panel";

/**
 * The Mastery Loop study session — one problem at a time, paced.
 *
 * Loads the set's overview once on mount (mastery state + problem
 * payload — no answer-leaking fields). The `?start=<bank_item_id>`
 * search param picks the initial problem (set by the dot map, the
 * review list, or the Set Overview's "Start studying" CTA).
 * Advances locally without refetching the overview: mastery_state
 * updates come back inline on submit_answer / walkthrough-opened
 * responses, applied to a local override map.
 *
 * Three modes per problem:
 *   • idle     → choose Answer / Walk-through / Skip
 *   • answer   → MCQCard, server-side comparison, feedback inline
 *   • walkthrough → paced step reveal + persisted tutor chat
 *
 * End-of-set: when the next-target lookup says "complete," the
 * summary view renders with confetti + a path back to overview.
 */
export default function SessionPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <SessionPageInner />
    </Suspense>
  );
}

function LoadingShell() {
  return (
    <p className="mx-auto max-w-2xl py-12 text-center text-text-muted">Loading…</p>
  );
}

type SessionMode = "idle" | "answer" | "walkthrough";

function SessionPageInner() {
  const { courseId, assignmentId } = useParams<{
    courseId: string;
    assignmentId: string;
  }>();
  const searchParams = useSearchParams();
  const startParam = searchParams.get("start");

  const [overview, setOverview] = useState<PracticeSetOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(startParam);
  // Local mastery overrides — server responses on answer / walkthrough
  // patch into this so the dot strip + completion check stay current
  // without a full overview refetch each interaction.
  const [masteryOverride, setMasteryOverride] = useState<
    Record<string, { state: MasteryState; attempts: number }>
  >({});
  const [mode, setMode] = useState<SessionMode>("idle");
  const [showSummary, setShowSummary] = useState(false);
  const { fire: fireConfetti } = useConfetti();

  useEffect(() => {
    if (!assignmentId) return;
    schoolStudent
      .practiceSetOverview(assignmentId)
      .then(async (o) => {
        setOverview(o);
        // Trust ?start only if the id is actually in this set —
        // otherwise a copy-pasted stale link would strand the
        // student on "Loading…" forever. On miss, fall through to
        // the smart-resume branch.
        const startIsValid =
          startParam !== null
          && o.problems.some((p) => p.bank_item_id === startParam);
        if (startIsValid) {
          setCurrentId(startParam);
          return;
        }
        // No ?start (or stale): resolve the smart-resume target
        // server-side, with a fallback to the first problem so the
        // student is never stuck without a target.
        try {
          const next = await schoolStudent.practiceNextProblem(
            assignmentId,
          );
          if (next.status === "complete") {
            setShowSummary(true);
            if (o.problems.length > 0) fireConfetti(true);
          } else {
            setCurrentId(next.problem.bank_item_id);
          }
        } catch {
          if (o.problems.length > 0) {
            setCurrentId(o.problems[0].bank_item_id);
          } else {
            setShowSummary(true);
          }
        }
      })
      .catch(() => setError("Couldn't load this practice set. Try again."));
    // currentId is intentionally excluded from deps — this effect
    // runs once per assignmentId/startParam to seed initial state;
    // subsequent currentId changes are driven by user interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, startParam]);

  // Reset per-problem UI on every problem change.
  useEffect(() => {
    setMode("idle");
  }, [currentId]);

  // Combined problem view: original mastery from overview overlaid
  // with anything we've updated this session.
  const problems = useMemo(() => {
    if (!overview) return [];
    return overview.problems.map((p) => {
      const o = masteryOverride[p.bank_item_id];
      return o ? { ...p, mastery_state: o.state, attempts: o.attempts } : p;
    });
  }, [overview, masteryOverride]);

  const currentProblem = useMemo(
    () => problems.find((p) => p.bank_item_id === currentId) ?? null,
    [problems, currentId],
  );
  const currentIndex = problems.findIndex(
    (p) => p.bank_item_id === currentId,
  );

  const setMastery = useCallback(
    (bankItemId: string, state: MasteryState, attempts: number) => {
      setMasteryOverride((prev) => ({
        ...prev,
        [bankItemId]: { state, attempts },
      }));
    },
    [],
  );

  const advanceToNext = useCallback(() => {
    // Find the next non-mastered problem from the current position.
    // Wrap around if we hit the end with stragglers still un-mastered;
    // if everything's mastered, show the summary.
    if (problems.length === 0) return;
    const start = currentIndex >= 0 ? currentIndex + 1 : 0;
    for (let i = 0; i < problems.length; i++) {
      const idx = (start + i) % problems.length;
      if (problems[idx].mastery_state !== "mastered") {
        setCurrentId(problems[idx].bank_item_id);
        return;
      }
    }
    // All mastered.
    setShowSummary(true);
    fireConfetti(true);
  }, [problems, currentIndex, fireConfetti]);

  if (error) {
    return <p className="mx-auto max-w-2xl py-12 text-center text-error">{error}</p>;
  }
  if (overview === null) {
    return <LoadingShell />;
  }
  if (showSummary) {
    return (
      <SummaryView
        courseId={courseId}
        assignmentId={assignmentId}
        problems={problems}
      />
    );
  }
  if (currentProblem === null) {
    return <LoadingShell />;
  }

  const total = problems.length;
  const mastered = problems.filter((p) => p.mastery_state === "mastered").length;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Top strip: position pill + collapsed dot strip + back link */}
      <div className="flex items-center justify-between">
        <Link
          href={`/school/student/courses/${courseId}/practice/${assignmentId}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
        >
          ← Overview
        </Link>
        <Badge variant="info">
          {currentIndex + 1} of {total}
        </Badge>
      </div>

      <DotStrip
        problems={problems}
        currentId={currentId}
        onJump={(id) => setCurrentId(id)}
      />

      {/* Progress bar — the headline mastery count */}
      <div className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
          {mastered} of {total} mastered
        </p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            initial={false}
            animate={{
              width: `${total > 0 ? (mastered / total) * 100 : 0}%`,
            }}
            transition={{ type: "spring", stiffness: 80, damping: 18 }}
          />
        </div>
      </div>

      {/* The problem itself */}
      <motion.div
        key={currentProblem.bank_item_id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-7"
      >
        <h1 className="text-xl font-bold text-text-primary">
          Problem {currentProblem.position}
        </h1>
        {mode !== "answer" && (
          <div className="mt-3 text-lg text-text-primary">
            <MathText text={currentProblem.question} />
          </div>
        )}

        {mode === "idle" && (
          <IdleActions
            problem={currentProblem}
            onAnswer={() => setMode("answer")}
            onWalkthrough={() => setMode("walkthrough")}
            onSkip={advanceToNext}
          />
        )}

        {mode === "answer" && (
          <AnswerPanel
            problem={currentProblem}
            onResult={(resp) => {
              setMastery(
                currentProblem.bank_item_id,
                resp.mastery_state_after,
                resp.attempts_after,
              );
            }}
            onAdvance={advanceToNext}
            onWalkthrough={() => setMode("walkthrough")}
          />
        )}

        {mode === "walkthrough" && (
          <WalkthroughPanel
            bankItemId={currentProblem.bank_item_id}
            onReady={(resp) => {
              // attempts unchanged; mastery state comes back as
              // walked_through (or stays the same for re-opens).
              setMastery(
                currentProblem.bank_item_id,
                resp.mastery_state_after,
                currentProblem.attempts,
              );
            }}
            onReturnToAnswer={() => setMode("answer")}
            onSkip={advanceToNext}
          />
        )}
      </motion.div>
    </div>
  );
}

// ── Idle: the three-action picker ──

function IdleActions({
  problem,
  onAnswer,
  onWalkthrough,
  onSkip,
}: {
  problem: PracticeProblemOverview;
  onAnswer: () => void;
  onWalkthrough: () => void;
  onSkip: () => void;
}) {
  const canAnswer = problem.mcq_choices.length === 4;
  const canWalkthrough = problem.step_count > 0;
  return (
    <Card variant="flat" className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          title={canAnswer ? undefined : "MCQ choices not ready yet"}
        >
          <Button
            variant="primary"
            size="md"
            onClick={onAnswer}
            disabled={!canAnswer}
          >
            Answer
          </Button>
        </span>
        <span
          title={
            canWalkthrough
              ? "See the teacher-authored steps — closes the mastery line."
              : "No steps yet"
          }
        >
          <Button
            variant="secondary"
            size="md"
            onClick={onWalkthrough}
            disabled={!canWalkthrough}
          >
            Walk me through
          </Button>
        </span>
        <Button variant="ghost" size="md" onClick={onSkip} className="ml-auto">
          Skip
        </Button>
      </div>
      {problem.attempts > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          You&rsquo;ve attempted this {problem.attempts}{" "}
          {problem.attempts === 1 ? "time" : "times"} before.
        </p>
      )}
    </Card>
  );
}

// ── Answer panel: MCQCard wired to the server ──

function AnswerPanel({
  problem,
  onResult,
  onAdvance,
  onWalkthrough,
}: {
  problem: PracticeProblemOverview;
  onResult: (resp: AnswerResponse) => void;
  onAdvance: () => void;
  onWalkthrough: () => void;
}) {
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [correctAnswer, setCorrectAnswer] = useState<string | undefined>(
    undefined,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per-problem when the problem changes.
  useEffect(() => {
    setSelectedChoice(null);
    setFeedback(null);
    setCorrectAnswer(undefined);
    setError(null);
  }, [problem.bank_item_id]);

  async function handleChoiceSelect(choice: string) {
    if (submitting || feedback !== null) return;
    const idx = problem.mcq_choices.indexOf(choice);
    setSelectedChoice(idx);
    setSubmitting(true);
    setError(null);
    try {
      const resp = await schoolStudent.submitProblemAnswer(
        problem.bank_item_id,
        choice,
      );
      setFeedback(resp.is_correct ? "correct" : "wrong");
      if (!resp.is_correct) setCorrectAnswer(resp.correct_answer);
      onResult(resp);
    } catch {
      setError("Couldn't record your answer. Try again.");
      setSelectedChoice(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <MCQCard
        question={problem.question}
        choices={problem.mcq_choices}
        selectedChoice={selectedChoice}
        feedback={feedback}
        isThinking={submitting}
        onSelectChoice={handleChoiceSelect}
        disableChoices={feedback !== null}
        correctAnswer={correctAnswer}
      />
      {error && <p className="text-center text-sm text-error">{error}</p>}
      <AnimatePresence>
        {feedback === "wrong" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-wrap gap-2"
          >
            <Button variant="secondary" onClick={onWalkthrough} className="flex-1">
              Walk me through it →
            </Button>
            <Button variant="ghost" onClick={onAdvance} className="flex-1">
              Skip and continue
            </Button>
          </motion.div>
        )}
        {feedback === "correct" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Button onClick={onAdvance} className="w-full py-3 text-base">
              Next problem →
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Collapsed dot strip — always-visible context above the problem ──

const STRIP_TONE: Record<MasteryState, string> = {
  mastered: "bg-success",
  attempted: "bg-amber-500",
  walked_through: "bg-amber-500",
  missed: "bg-red-500",
  not_started: "bg-border",
};

function DotStrip({
  problems,
  currentId,
  onJump,
}: {
  problems: PracticeProblemOverview[];
  currentId: string | null;
  onJump: (id: string) => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-1.5 overflow-x-auto">
      {problems.map((p) => {
        const isCurrent = p.bank_item_id === currentId;
        return (
          <button
            key={p.bank_item_id}
            type="button"
            onClick={() => onJump(p.bank_item_id)}
            aria-label={`Jump to problem ${p.position}`}
            title={`Problem ${p.position}`}
            className={cn(
              "h-2.5 w-2.5 flex-shrink-0 rounded-full transition-all hover:scale-125",
              STRIP_TONE[p.mastery_state],
              isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-bg scale-125",
            )}
          />
        );
      })}
    </div>
  );
}

// ── End-of-set summary ──

function SummaryView({
  courseId,
  assignmentId,
  problems,
}: {
  courseId: string;
  assignmentId: string;
  problems: PracticeProblemOverview[];
}) {
  const mastered = problems.filter((p) => p.mastery_state === "mastered").length;
  const walked = problems.filter(
    (p) => p.mastery_state === "walked_through" || p.mastery_state === "attempted",
  ).length;
  const missed = problems.filter((p) => p.mastery_state === "missed").length;
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-text-primary">
        You&rsquo;ve mastered the set.
      </h1>
      <p className="mt-3 text-base text-text-secondary">
        Nice work — every problem answered correctly on the first try.
      </p>
      <div className="mt-8 grid grid-cols-3 gap-3">
        <SummaryStat n={mastered} label="Mastered" tone="success" />
        <SummaryStat n={walked} label="Attempted" tone="amber" />
        <SummaryStat n={missed} label="Got wrong" tone="red" />
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href={`/school/student/courses/${courseId}/practice/${assignmentId}`}
          className="inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-5 py-3 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          Back to overview
        </Link>
        <Link
          href={`/school/student/courses/${courseId}?tab=practice`}
          className="inline-flex items-center gap-2 rounded-[--radius-md] border border-border px-5 py-3 text-sm font-semibold text-text-secondary hover:border-primary hover:text-primary"
        >
          Other practice sets
        </Link>
      </div>
    </div>
  );
}

function SummaryStat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "success" | "amber" | "red";
}) {
  const cls = {
    success: "border-success-border bg-success-light text-success",
    amber:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300",
    red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300",
  }[tone];
  return (
    <div className={cn("rounded-[--radius-md] border p-4", cls)}>
      <div className="text-3xl font-extrabold tabular-nums">{n}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] opacity-80">
        {label}
      </div>
    </div>
  );
}
