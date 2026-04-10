"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { session as sessionApi } from "@/lib/api";
import { Button, Badge } from "@/components/ui";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { MCQCard } from "@/components/shared/mcq-card";
import { ProgressBar } from "@/components/shared/progress-bar";
import { PracticeSummary } from "./_components/practice-summary";

export default function PracticePage() {
  const router = useRouter();
  const { startLearnQueue, subject } = useSessionStore();
  const {
    practiceBatch,
    phase,
    error,
    submitPracticeAnswer,
    skipPracticeProblem,
    nextPracticeProblem,
    togglePracticeFlag,
    reset,
  } = usePracticeStore();

  const { fire: fireConfetti } = useConfetti();
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const { UpgradeModal } = useUpgradePrompt();

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
        }).catch(console.error);
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
        onToggleFlag={togglePracticeFlag}
        onStartLearnQueue={startLearnQueue}
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
