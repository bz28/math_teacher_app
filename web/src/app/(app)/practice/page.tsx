"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { useEntitlementStore } from "@/stores/entitlements";
import { session as sessionApi } from "@/lib/api";
import { Button, Badge } from "@/components/ui";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { MCQCard } from "@/components/shared/mcq-card";
import { ProgressBar } from "@/components/shared/progress-bar";
import { PracticeSummary } from "./_components/practice-summary";
import { MathText } from "@/components/shared/math-text";

export default function PracticePage() {
  const router = useRouter();
  const { startLearnQueue, subject } = useSessionStore();
  const {
    practiceBatch,
    phase,
    error,
    beginPractice,
    submitPracticeAnswer,
    skipPracticeProblem,
    submitPracticeWork,
    nextPracticeProblem,
    togglePracticeFlag,
    retryFlaggedProblems,
    reset,
  } = usePracticeStore();

  const { isPro, dailySessionsUsed, dailySessionsLimit } = useEntitlementStore();
  const remainingSessions = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);

  const { fire: fireConfetti } = useConfetti();
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();

  // Build MC choices — must be before early returns (rules of hooks)
  const currentProblem = practiceBatch?.problems[practiceBatch.currentIndex];
  const choices = useMemo(() => {
    if (!currentProblem?.answer || !currentProblem.distractors?.length) return [];
    const all = [currentProblem.answer, ...currentProblem.distractors.slice(0, 3)];
    const seed = (currentProblem.question.length + (practiceBatch?.currentIndex ?? 0)) | 0;
    return all.sort((a, b) => {
      const ha = Array.from(a).reduce((h, c) => h * 31 + c.charCodeAt(0) + seed, 0);
      const hb = Array.from(b).reduce((h, c) => h * 31 + c.charCodeAt(0) + seed, 0);
      return ha - hb;
    });
  }, [currentProblem, practiceBatch?.currentIndex]);

  useRedirectOnIdle(phase, practiceBatch);
  useErrorToast(phase, error);

  // Confetti on perfect practice score + complete session for history
  useEffect(() => {
    if (phase === "practice_summary" && practiceBatch) {
      const allCorrect = practiceBatch.results.every((r) => r.isCorrect);
      if (allCorrect) fireConfetti(true);

      // Record in history
      if (practiceBatch.sessionId) {
        const correct = practiceBatch.results.filter((r) => r.isCorrect).length;
        sessionApi.completePracticeBatch(practiceBatch.sessionId, {
          total_questions: practiceBatch.results.length,
          correct_count: correct,
        }).catch(() => { /* session may already be completed — safe to ignore */ });
      }
    }
  }, [phase, practiceBatch, fireConfetti]);

  async function handleChoiceSelect(choice: string) {
    setSelectedChoice(choices.indexOf(choice));
    await submitPracticeAnswer(choice, subject);
  }

  if (phase === "loading" || !practiceBatch) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SkeletonStep />
        <SkeletonStep />
      </div>
    );
  }

  if (phase === "practice_preview") {
    const allSolved = practiceBatch.problems.every((q) => q.answer !== "");
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-text-primary">Your practice problem</h1>
          <p className="mt-1 text-sm text-text-muted">
            {practiceBatch.problems.length} question{practiceBatch.problems.length !== 1 ? "s" : ""} · Review before you begin
          </p>
        </div>
        <div className="space-y-3">
          {practiceBatch.problems.map((q, i) => (
            <div key={i} className="flex items-start gap-3 rounded-[--radius-lg] border border-border bg-surface px-4 py-3">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="flex-1 text-sm font-medium text-text-primary">
                <MathText text={q.question} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Button
            gradient
            onClick={beginPractice}
            className="w-full py-3 text-base"
          >
            {allSolved ? "Begin Practice" : (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Preparing answer choices…
              </span>
            )}
          </Button>
          <Button variant="ghost" onClick={() => { reset(); router.back(); }} className="w-full">
            Cancel
          </Button>
        </div>
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

  // Summary view
  if (phase === "practice_summary") {
    return (
      <PracticeSummary
        practiceBatch={practiceBatch}
        subject={subject}
        sessionsRemaining={remainingSessions}
        onToggleFlag={togglePracticeFlag}
        onStartLearnQueue={startLearnQueue}
        onUpgradeNeeded={showUpgrade}
        onReset={reset}
      />
    );
  }

  // Active practice
  const current = practiceBatch.problems[practiceBatch.currentIndex];
  const isThinking = phase === "thinking";
  const feedback = practiceBatch.currentFeedback;
  const progress = (practiceBatch.currentIndex / practiceBatch.problems.length) * 100;
  const isLast = practiceBatch.currentIndex >= practiceBatch.problems.length - 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Practice</h1>
        <Badge variant="info">
          {practiceBatch.currentIndex + 1} of {practiceBatch.problems.length}
        </Badge>
      </div>

      <ProgressBar value={progress} />

      <MCQCard
        question={current.question}
        choices={choices}
        selectedChoice={selectedChoice}
        feedback={feedback}
        isThinking={isThinking}
        onSelectChoice={handleChoiceSelect}
        onAdvance={() => {
          setSelectedChoice(null);
          nextPracticeProblem();
        }}
        advanceLabel={isLast ? "See Results" : "Next Problem"}
        belowChoices={
          <button
            onClick={skipPracticeProblem}
            disabled={isThinking}
            className="text-xs font-medium text-text-muted hover:text-text-secondary transition-colors"
          >
            Skip this problem
          </button>
        }
      />
      {UpgradeModal}
    </div>
  );
}
