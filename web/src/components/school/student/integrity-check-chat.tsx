"use client";

import { useEffect, useState } from "react";
import { schoolStudent, type NextIntegrityQuestionResponse } from "@/lib/api";

interface Props {
  submissionId: string;
  /** Called when the chat reaches the done state OR the kid taps
   *  Exit. The parent re-fetches state on close. */
  onDone: () => void;
}

const MIN_ANSWER_CHARS = 5;

/**
 * The kid-facing chat screen for the post-submission understanding
 * check. Walks through the questions one at a time:
 *
 *   1. Mounts → calls /next to get the first pending question
 *   2. Kid types an answer (gated at >= MIN_ANSWER_CHARS — same
 *      threshold the backend enforces)
 *   3. Tap Next → POST /answer → backend scores it, returns the
 *      next question in the same response (one round-trip)
 *   4. When /next or /answer returns {done: true} → render the done
 *      state and let the kid tap Back to homework
 *
 * Tone is friendly throughout. Never "verification" / "checking
 * for cheating" language. Quiet done screen — no score, no rating.
 */
export function IntegrityCheckChat({ submissionId, onDone }: Props) {
  const [current, setCurrent] = useState<NextIntegrityQuestionResponse | null>(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState<number>(Date.now());

  // Fetch the first question on mount.
  useEffect(() => {
    let cancelled = false;
    schoolStudent
      .getNextIntegrityQuestion(submissionId)
      .then((q) => {
        if (cancelled) return;
        setCurrent(q);
        setQuestionStartedAt(Date.now());
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load the check. Try again.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  async function handleNext() {
    if (!current || current.done || submitting) return;
    if (answer.trim().length < MIN_ANSWER_CHARS) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await schoolStudent.submitIntegrityAnswer(submissionId, {
        question_id: current.question_id,
        answer: answer.trim(),
        seconds_on_question: Math.max(
          0,
          Math.round((Date.now() - questionStartedAt) / 1000),
        ),
      });
      setCurrent(next);
      setAnswer("");
      setQuestionStartedAt(Date.now());
    } catch {
      setError("Couldn't save your answer. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center text-text-muted">
        Loading…
      </div>
    );
  }

  if (current === null) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-error">{error || "Couldn't load the check."}</p>
        <button
          onClick={onDone}
          className="mt-4 rounded-[--radius-sm] border border-border px-4 py-2 text-sm hover:border-primary"
        >
          Back to homework
        </button>
      </div>
    );
  }

  if (current.done) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="mt-3 text-2xl font-bold text-text-primary">All done</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Thanks! Your work is with your teacher. You&apos;ll see your grade when they
          release it.
        </p>
        <button
          onClick={onDone}
          className="mt-6 rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90"
        >
          Back to homework
        </button>
      </div>
    );
  }

  const canSubmit = answer.trim().length >= MIN_ANSWER_CHARS && !submitting;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress header — "Problem 1 of 5 · Question 1 of 2" */}
      <div className="flex items-center justify-between text-xs font-medium text-text-muted">
        <span>
          Problem {current.problem_position} of {current.total_problems}
          {" · "}
          Question {current.question_index + 1} of {current.questions_in_problem}
        </span>
        <button
          onClick={onDone}
          className="text-text-muted hover:text-primary"
          title="Save your progress and come back later"
        >
          Save & exit
        </button>
      </div>

      <div className="mt-6 rounded-[--radius-md] border border-border bg-surface p-6">
        <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
          Quick question
        </div>
        <div className="mt-2 text-base text-text-primary">{current.question_text}</div>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer…"
          rows={4}
          disabled={submitting}
          className="mt-4 w-full rounded-[--radius-sm] border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-50"
        />
        {answer.length > 0 && answer.trim().length < MIN_ANSWER_CHARS && (
          <p className="mt-1 text-xs text-text-muted">
            Try a sentence or two ({MIN_ANSWER_CHARS}+ characters).
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleNext}
          disabled={!canSubmit}
          className="rounded-[--radius-sm] bg-primary px-5 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "…" : "Next →"}
        </button>
      </div>
    </div>
  );
}
