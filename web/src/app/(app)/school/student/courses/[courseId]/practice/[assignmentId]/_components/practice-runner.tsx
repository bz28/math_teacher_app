"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { schoolStudent, type StudentPracticeProblem } from "@/lib/api";
import { FigureDisplay } from "@/components/shared/figure-display";
import { MathText } from "@/components/shared/math-text";
import { MCQCard } from "@/components/shared/mcq-card";
import { ProgressBar } from "@/components/shared/progress-bar";
import { Button, Card, AnimatedCounter } from "@/components/ui";
import { CheckIcon } from "@/components/ui/icons";
import { useConfetti } from "@/components/ui/confetti";
import { cn } from "@/lib/utils";
import {
  buildChoices,
  encouragementFor,
  isSolved,
  toActivityOutcome,
  type Outcome,
} from "./practice-shared";

interface Props {
  /** The practice set this runner belongs to — used to record the
   *  finished session's per-problem outcomes to the activity log. */
  assignmentId: string;
  problems: StudentPracticeProblem[];
  /** Whether a Learn walkthrough exists for this set — gates the
   *  "Learn this set" pivot so we never cross into an empty mode. */
  canLearn: boolean;
  /** Pivot to the Learn experience for this same set. */
  onLearn: () => void;
  /** Return to the course practice list. */
  onExit: () => void;
}

/**
 * One-problem-at-a-time practice runner. Ungraded: the only thing that
 * leaves the browser is the coarse per-problem outcome (first try /
 * retry / revealed) recorded to the activity log on completion — never
 * the student's actual picks. Answer mode is retry-once-then-reveal:
 * a wrong first pick lets the student try once more; a second miss
 * reveals the answer and advances. Ends in a celebration summary.
 */
export function PracticeRunner({
  assignmentId,
  problems,
  canLearn,
  onLearn,
  onExit,
}: Props) {
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [done, setDone] = useState(false);

  // Fire-and-forget activity recording. When the session reaches its
  // summary (`done`), POST one row per answered problem — the honest
  // engagement signal the teacher sees (that they practiced, never which
  // answers they picked). Posts once per completed run; `postedRef`
  // resets on "Practice again" so a genuine second run records again.
  // Practice is formative, so a failed write is swallowed.
  const postedRef = useRef(false);
  useEffect(() => {
    if (!done || postedRef.current) return;
    postedRef.current = true;
    const rows = problems
      .map((p, i) => {
        const o = outcomes[i];
        return o
          ? {
              bank_item_id: p.bank_item_id,
              mode: "practice" as const,
              outcome: toActivityOutcome(o),
              tutor_message_count: 0,
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) {
      schoolStudent.recordActivity(assignmentId, rows).catch(() => {});
    }
  }, [done, problems, outcomes, assignmentId]);

  // Per-problem answering state. Reset on advance.
  const [picked, setPicked] = useState<string | null>(null);
  const [triedWrong, setTriedWrong] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);

  const problem = problems[index];
  const choices = useMemo(() => buildChoices(problem), [problem]);
  const correctAnswer = (problem.final_answer || "").trim();
  const isLast = index >= problems.length - 1;
  const solved = outcomes.filter(isSolved).length;

  function handlePick(choice: string) {
    if (result) return; // locked once resolved
    setPicked(choice);
    const correct = choice.trim() === correctAnswer;
    if (correct) {
      resolve(triedWrong ? "retry" : "first");
    } else if (!triedWrong) {
      setTriedWrong(true); // first miss → encourage + allow one retry
    } else {
      resolve("revealed"); // second miss → reveal
    }
  }

  function resolve(o: Outcome) {
    setResult(o);
    setOutcomes((prev) => [...prev, o]);
  }

  function advance() {
    if (isLast) {
      setDone(true);
      return;
    }
    setIndex((i) => i + 1);
    setPicked(null);
    setTriedWrong(false);
    setResult(null);
  }

  if (done) {
    return (
      <PracticeSummary
        problems={problems}
        outcomes={outcomes}
        canLearn={canLearn}
        onLearn={onLearn}
        onExit={onExit}
        onRetry={() => {
          setIndex(0);
          setOutcomes([]);
          setPicked(null);
          setTriedWrong(false);
          setResult(null);
          setDone(false);
          postedRef.current = false; // a fresh run records its own session
        }}
      />
    );
  }

  // Feedback shown by MCQCard. During the retry window (one miss, not yet
  // resolved) we surface a gentle "try again" WITHOUT revealing the answer.
  const feedback: "correct" | "wrong" | null = result
    ? result === "revealed"
      ? "wrong"
      : "correct"
    : triedWrong
      ? "wrong"
      : null;
  const revealAnswer = result === "revealed" ? correctAnswer : undefined;
  const selectedChoice = picked === null ? null : choices.indexOf(picked);

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div>
        <div className="flex items-end justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
            Problem {index + 1}{" "}
            <span className="text-text-muted/60">of {problems.length}</span>
          </p>
          <ScoreTally solved={solved} answered={outcomes.length} />
        </div>
        <div className="mt-2">
          <ProgressBar value={(index / problems.length) * 100} />
        </div>
      </div>

      {/* Problem — figure always renders (geometry MCQs are unanswerable
          without their diagram); MCQCard renders only the question text. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="space-y-4"
        >
          <FigureDisplay
            svg={problem.figure_svg}
            ariaLabel={`Figure for problem ${index + 1}`}
          />
          {/* MCQCard owns the retry copy: during the retry window we
              pass no `correctAnswer`, so it shows "Not quite, try
              again!"; on reveal we pass the answer so it names it. */}
          <MCQCard
            question={problem.question}
            choices={choices}
            selectedChoice={selectedChoice}
            feedback={feedback}
            onSelectChoice={handlePick}
            disableChoices={result !== null}
            correctAnswer={revealAnswer}
          />
        </motion.div>
      </AnimatePresence>

      {/* Advance footer — appears once the problem is resolved. */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-end"
          >
            <Button onClick={advance}>
              {isLast ? "See results" : "Next problem"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ScoreTally({ solved, answered }: { solved: number; answered: number }) {
  if (answered === 0) {
    return (
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
        Ungraded
      </p>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[--radius-pill] border border-success-border bg-success-light px-2.5 py-1 text-xs font-semibold text-success">
      <CheckIcon className="h-3 w-3" strokeWidth={3} />
      {solved} of {answered} solved
    </span>
  );
}

// ── Celebration summary ──

function PracticeSummary({
  problems,
  outcomes,
  canLearn,
  onLearn,
  onExit,
  onRetry,
}: {
  problems: StudentPracticeProblem[];
  outcomes: Outcome[];
  canLearn: boolean;
  onLearn: () => void;
  onExit: () => void;
  onRetry: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { fire } = useConfetti();

  const total = outcomes.length;
  const solved = outcomes.filter(isSolved).length;
  const firstTry = outcomes.filter((o) => o === "first").length;
  const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
  const { headline, sub } = encouragementFor(pct);

  // Confetti on a strong score, intensified on a perfect run — skipped
  // under reduced-motion. Deferred past paint so it overlays the summary.
  useEffect(() => {
    if (reduceMotion || pct < 80) return;
    const t = setTimeout(() => fire(pct >= 100), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-7"
    >
      {/* Hero score */}
      <div className="text-center">
        <p className="eyebrow">Practice complete</p>
        <h2 className="mt-2 font-serif text-[2.75rem] leading-none text-primary">
          {headline}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-secondary">
          {sub}
        </p>
      </div>

      <Card variant="elevated" className="text-center">
        <div className="flex items-baseline justify-center gap-1 font-serif text-primary">
          <AnimatedCounter to={solved} className="text-5xl" />
          <span className="text-2xl text-text-muted">/ {total}</span>
        </div>
        <div className="mx-auto mt-4 h-2 w-56 max-w-full overflow-hidden rounded-full bg-border-light">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ delay: 0.2, type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <p className="mt-3 text-xs font-medium text-text-muted">
          {firstTry} first-try{firstTry === 1 ? "" : "s"} · Ungraded — your
          teacher can see that you practiced, not your answers
        </p>
      </Card>

      {/* Per-problem breakdown */}
      <div className="space-y-2">
        {problems.map((p, i) => (
          <ResultRow key={p.bank_item_id} position={i + 1} problem={p} outcome={outcomes[i]} />
        ))}
      </div>

      {/* Pivots */}
      <div className="flex flex-col gap-2">
        {canLearn ? (
          <>
            <Button onClick={onLearn} className="w-full">
              Learn this set
            </Button>
            <Button variant="secondary" onClick={onRetry} className="w-full">
              Practice again
            </Button>
          </>
        ) : (
          <Button onClick={onRetry} className="w-full">
            Practice again
          </Button>
        )}
        <Button variant="ghost" onClick={onExit} className="w-full">
          Back to practice
        </Button>
      </div>
    </motion.div>
  );
}

function ResultRow({
  position,
  problem,
  outcome,
}: {
  position: number;
  problem: StudentPracticeProblem;
  outcome: Outcome | undefined;
}) {
  const meta =
    outcome === "first"
      ? { tint: "border-success-border bg-success-light", chip: "bg-success", glyph: "✓", label: "First try" }
      : outcome === "retry"
        ? { tint: "border-warning/30 bg-warning-bg", chip: "bg-warning-dark", glyph: "↻", label: "Got it on retry" }
        : { tint: "border-error-border bg-error-light", chip: "bg-error", glyph: "✗", label: "Answer revealed" };

  return (
    <div className={cn("flex items-start gap-3 rounded-[--radius-md] border px-4 py-3", meta.tint)}>
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
          meta.chip,
        )}
      >
        {meta.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">
          Problem {position} · {meta.label}
        </p>
        <div className="mt-0.5 line-clamp-2 text-sm text-text-primary">
          <MathText text={problem.question} />
        </div>
      </div>
    </div>
  );
}
