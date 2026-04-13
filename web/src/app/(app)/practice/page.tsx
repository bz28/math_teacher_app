"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { Button, Card, Badge } from "@/components/ui";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { FlagIcon } from "@/components/ui/icons";
import { MathText } from "@/components/shared/math-text";
import { cn, shuffleChoices, formatElapsed } from "@/lib/utils";
import { PracticeSummary } from "./_components/practice-summary";

export default function PracticePage() {
  const router = useRouter();
  const { startLearnQueue } = useSessionStore();
  const {
    practiceBatch,
    phase,
    error,
    savePracticeAnswer,
    togglePracticeFlag,
    setPracticeIndex,
    submitPractice,
    reset,
  } = usePracticeStore();

  const { fire: fireConfetti } = useConfetti();

  // Build shuffled MCQ choices — must be before early returns (rules of hooks)
  const currentProblem = practiceBatch?.problems[practiceBatch.currentIndex];
  const choices = useMemo(() => {
    if (!currentProblem?.answer || !currentProblem.distractors?.length) return [];
    const all = [currentProblem.answer, ...currentProblem.distractors.slice(0, 3)];
    const seed = (currentProblem.question.length + (practiceBatch?.currentIndex ?? 0)) | 0;
    return shuffleChoices(all, seed);
  }, [currentProblem, practiceBatch?.currentIndex]);

  useRedirectOnIdle(phase, practiceBatch);
  useErrorToast(phase, error);

  // Confetti on perfect score
  useEffect(() => {
    if (phase === "practice_summary" && practiceBatch?.results) {
      const correct = practiceBatch.results.filter((r) => r.isCorrect === true).length;
      const score = Math.round((correct / practiceBatch.results.length) * 100);
      if (score === 100) fireConfetti(true);
      else if (score >= 70) fireConfetti(false);
    }
  }, [phase, practiceBatch, fireConfetti]);

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== "practice_active" || !practiceBatch) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - practiceBatch.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, practiceBatch]);

  // Keyboard shortcuts
  useEffect(() => {
    if (phase !== "practice_active" || !practiceBatch) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPracticeIndex(Math.max(0, practiceBatch!.currentIndex - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPracticeIndex(Math.min(practiceBatch!.problems.length - 1, practiceBatch!.currentIndex + 1));
      } else if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < practiceBatch!.problems.length) {
          e.preventDefault();
          setPracticeIndex(idx);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, practiceBatch, setPracticeIndex, submitPractice]);

  if (phase === "loading" || !practiceBatch) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SkeletonStep />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-2xl text-center space-y-4 py-12">
        <p className="text-error font-medium">{error}</p>
        <Button variant="secondary" onClick={() => router.push("/learn")}>
          Try Again
        </Button>
      </div>
    );
  }

  // Summary
  if (phase === "practice_summary" && practiceBatch.results) {
    return (
      <PracticeSummary
        practiceBatch={practiceBatch}
        onToggleFlag={togglePracticeFlag}
        onStartLearnQueue={startLearnQueue}
        onReset={reset}
      />
    );
  }

  // Active practice — mock-test-style UI
  const current = practiceBatch.problems[practiceBatch.currentIndex];
  const currentAnswer = practiceBatch.answers[practiceBatch.currentIndex] ?? "";
  const isFlagged = practiceBatch.flags[practiceBatch.currentIndex];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header with elapsed timer */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Practice</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-bold text-text-secondary">
            {formatElapsed(elapsed)}
          </span>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const unanswered = practiceBatch.problems.length - Object.keys(practiceBatch.answers).filter((k) => practiceBatch.answers[Number(k)]?.trim()).length;
              const msg = unanswered > 0
                ? `You have ${unanswered} unanswered question${unanswered > 1 ? "s" : ""}. Submit anyway?`
                : "Submit your answers? You won't be able to change them.";
              if (window.confirm(msg)) submitPractice();
            }}
          >
            Submit
          </Button>
        </div>
      </div>

      {/* Question navigator */}
      <div className="overflow-x-auto -mx-2 px-2 pb-1">
        <div className="flex gap-2 min-w-min md:flex-wrap">
          {practiceBatch.problems.map((_, i) => (
            <button
              key={i}
              onClick={() => setPracticeIndex(i)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-[--radius-sm] text-xs font-bold transition-colors",
                i === practiceBatch.currentIndex
                  ? "bg-primary text-white"
                  : practiceBatch.answers[i]
                    ? "bg-success-light text-success border border-success-border"
                    : "bg-input-bg text-text-muted border border-border",
                practiceBatch.flags[i] && "ring-2 ring-warning",
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Current question */}
      <Card variant="elevated" className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <Badge variant="info">
              Question {practiceBatch.currentIndex + 1} of{" "}
              {practiceBatch.problems.length}
            </Badge>
            <div className="mt-3 text-base font-medium text-text-primary">
              <MathText text={current.question} />
            </div>
          </div>
          <button
            onClick={() => togglePracticeFlag(practiceBatch.currentIndex)}
            className={cn(
              "rounded-[--radius-sm] p-2 transition-colors",
              isFlagged
                ? "bg-warning-bg text-warning-dark"
                : "text-text-muted hover:bg-warning-bg hover:text-warning-dark",
            )}
            title={isFlagged ? "Unflag" : "Flag for review"}
            aria-label={isFlagged ? "Unflag for review" : "Flag for review"}
          >
            <FlagIcon className="h-5 w-5" filled={isFlagged} />
          </button>
        </div>

        {/* MCQ choices */}
        {choices.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map((choice) => (
              <button
                key={choice}
                onClick={() => savePracticeAnswer(practiceBatch.currentIndex, choice)}
                className={cn(
                  "rounded-[--radius-md] border px-4 py-3 text-left text-sm font-medium transition-colors",
                  currentAnswer === choice
                    ? "border-primary bg-primary-bg text-primary"
                    : "border-border-light bg-surface text-text-primary hover:border-primary/30",
                )}
              >
                <MathText text={choice} />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-8 text-text-muted">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">Loading choices…</span>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPracticeIndex(Math.max(0, practiceBatch.currentIndex - 1))}
            disabled={practiceBatch.currentIndex === 0}
          >
            <kbd className="hidden rounded border border-border bg-input-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">&larr;</kbd>
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPracticeIndex(Math.min(practiceBatch.problems.length - 1, practiceBatch.currentIndex + 1))}
            disabled={practiceBatch.currentIndex === practiceBatch.problems.length - 1}
          >
            Next
            <kbd className="hidden rounded border border-border bg-input-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">&rarr;</kbd>
          </Button>
        </div>
      </Card>
    </div>
  );
}
