"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  schoolStudent,
  type StudentPracticeDetail,
  type StudentPracticeProblem,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { MCQCard } from "@/components/shared/mcq-card";

/**
 * Student practice detail — ungraded, stateless, per-problem
 * Answer/Learn actions rendered inline. Reuses the MCQCard primitive
 * for the Answer flow; the Learn flow renders the teacher-authored
 * solution_steps as a simple expandable timeline (no LLM chat in
 * v1).
 *
 * Deliberately NOT using PracticeLoopSurface / LearnLoopSurface —
 * those are built around the HW variation-rotation pattern
 * (consumption tracking, anchor-based sibling fetch, mode pivots),
 * which doesn't apply when the practice items ARE the problems and
 * there's no rotation. Building on MCQCard directly keeps this
 * ~100 lines vs. the ~300-line surface plumbing.
 */
export default function PracticeDetailPage() {
  const { courseId, assignmentId } = useParams<{
    courseId: string;
    assignmentId: string;
  }>();
  const [detail, setDetail] = useState<StudentPracticeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assignmentId) return;
    schoolStudent
      .practiceDetail(assignmentId)
      .then(setDetail)
      .catch(() => setError("Couldn't load this practice set. Please try again."));
  }, [assignmentId]);

  if (error) {
    return <p className="mx-auto max-w-2xl py-12 text-center text-error">{error}</p>;
  }
  if (detail === null) {
    return (
      <p className="mx-auto max-w-2xl py-12 text-center text-text-muted">Loading…</p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/school/student/courses/${courseId}?tab=practice`}
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
      >
        ← Back to practice
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">{detail.title}</h1>
      <p className="mt-1 text-sm text-text-secondary">
        {detail.problems.length}{" "}
        {detail.problems.length === 1 ? "problem" : "problems"} · Ungraded
      </p>
      {detail.source_homework_title && (
        <p className="mt-1 text-xs text-text-muted">
          Cloned from{" "}
          <span className="font-medium text-text-secondary">
            {detail.source_homework_title}
          </span>
        </p>
      )}

      {detail.problems.length === 0 ? (
        <div className="mt-8 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-8 text-center">
          <p className="text-sm font-semibold text-text-primary">
            Still being prepared
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Your teacher is generating the problems for this set. Check back
            in a minute.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {detail.problems.map((p) => (
            <ProblemCard key={p.bank_item_id} problem={p} />
          ))}
        </div>
      )}
    </div>
  );
}

type ActionMode = "idle" | "answer" | "learn";

function ProblemCard({ problem }: { problem: StudentPracticeProblem }) {
  const [mode, setMode] = useState<ActionMode>("idle");
  const noMCQ = !problem.final_answer || (problem.distractors ?? []).length === 0;

  return (
    <div className="rounded-[--radius-md] border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-bg text-sm font-bold text-primary">
          {problem.position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base text-text-primary">
            <MathText text={problem.question} />
          </div>

          {mode === "idle" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setMode("answer")}
                disabled={noMCQ}
                title={
                  noMCQ
                    ? "This problem doesn't have multiple-choice options yet."
                    : undefined
                }
                className="rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                Answer
              </button>
              <button
                onClick={() => setMode("learn")}
                disabled={(problem.solution_steps ?? []).length === 0}
                className="rounded-[--radius-sm] border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50"
              >
                Learn it
              </button>
            </div>
          )}

          {mode === "answer" && (
            <AnswerPanel
              problem={problem}
              onDone={() => setMode("idle")}
            />
          )}

          {mode === "learn" && (
            <LearnPanel
              problem={problem}
              onDone={() => setMode("idle")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Deterministic shuffle seeded by a string — mirrors the helper in
 *  practice-loop-surface. Same seed → same choice order so render
 *  churn doesn't move options around, but siblings differ so kids
 *  don't learn "A is always correct." */
function shuffleStable<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function AnswerPanel({
  problem,
  onDone,
}: {
  problem: StudentPracticeProblem;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const correctAnswer = (problem.final_answer || "").trim();

  const choices = useMemo(() => {
    const raw = [correctAnswer, ...(problem.distractors ?? [])]
      .map((s) => (s || "").trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const c of raw) {
      if (!seen.has(c)) {
        seen.add(c);
        deduped.push(c);
      }
    }
    return shuffleStable(deduped, problem.bank_item_id);
  }, [problem.bank_item_id, problem.distractors, correctAnswer]);

  const selectedChoice = picked === null ? null : choices.indexOf(picked);
  const feedback: "correct" | "wrong" | null =
    picked === null
      ? null
      : picked.trim() === correctAnswer
        ? "correct"
        : "wrong";

  return (
    <div className="mt-4">
      <MCQCard
        question={problem.question}
        choices={choices}
        selectedChoice={selectedChoice}
        feedback={feedback}
        onSelectChoice={(c) => setPicked(c)}
        disableChoices={picked !== null}
        correctAnswer={correctAnswer}
      />
      <div className="mt-3 flex justify-end">
        <button
          onClick={onDone}
          className="text-xs font-semibold text-text-muted hover:text-text-primary"
        >
          Collapse
        </button>
      </div>
    </div>
  );
}

function LearnPanel({
  problem,
  onDone,
}: {
  problem: StudentPracticeProblem;
  onDone: () => void;
}) {
  const steps = problem.solution_steps ?? [];
  return (
    <div className="mt-4 space-y-3">
      <ol className="space-y-3">
        {steps.map((step, idx) => (
          <li
            key={idx}
            className="rounded-[--radius-sm] border border-border-light bg-bg-subtle p-3"
          >
            <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Step {idx + 1}
              {step.title ? ` · ${step.title}` : ""}
            </div>
            <div className="mt-1 text-sm text-text-primary">
              <MathText text={step.description} />
            </div>
          </li>
        ))}
      </ol>
      {problem.final_answer && (
        <div className="rounded-[--radius-sm] border border-green-200 bg-green-50 px-3 py-2 dark:border-green-900/40 dark:bg-green-900/20">
          <div className="text-[11px] font-bold uppercase tracking-wide text-green-700 dark:text-green-300">
            Answer
          </div>
          <div className="mt-0.5 text-sm text-text-primary">
            <MathText text={problem.final_answer} />
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <button
          onClick={onDone}
          className="text-xs font-semibold text-text-muted hover:text-text-primary"
        >
          Collapse
        </button>
      </div>
    </div>
  );
}
