"use client";

import type { IntegrityStateResponse } from "@/lib/api";

interface Props {
  state: IntegrityStateResponse;
  onStart: () => void;
  onLater: () => void;
}

/**
 * The "Quick understanding check" prompt that appears below the
 * SubmittedView after a kid turns in their homework. Renders only
 * when the integrity check is in progress.
 *
 * Tone: friendly, never "verification" / "cheating" / "honesty"
 * language. Per the parent plan §2.5 the exact strings here are
 * the canonical kid-facing copy.
 */
export function IntegrityCheckEntry({ state, onStart, onLater }: Props) {
  // Aggregate progress across all sampled problems for the resume
  // case ("Continue (3 of 10 done)").
  const totalQuestions = state.problems.reduce((n, p) => n + p.question_count, 0);
  const answeredQuestions = state.problems.reduce((n, p) => n + p.answered_count, 0);
  const isResume = answeredQuestions > 0;

  return (
    <div className="mt-8 rounded-[--radius-md] border border-primary bg-primary-bg/20 p-6">
      <h2 className="text-lg font-bold text-text-primary">
        Quick understanding check
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        A few quick questions about how you solved these. Helps your teacher see where
        you&apos;re strong.
      </p>
      <div className="mt-2 text-xs font-medium text-text-muted">
        {isResume
          ? `~2 minutes · ${answeredQuestions} of ${totalQuestions} done`
          : `~2 minutes · ${totalQuestions} questions`}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onStart}
          className="rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90"
        >
          {isResume ? "Continue" : "Start"}
        </button>
        <button
          onClick={onLater}
          className="rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary"
        >
          Later
        </button>
      </div>
    </div>
  );
}
