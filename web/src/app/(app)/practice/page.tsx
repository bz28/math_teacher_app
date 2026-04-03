"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { useEntitlementStore } from "@/stores/entitlements";
import { session as sessionApi } from "@/lib/api";
import { Button, Card, Badge } from "@/components/ui";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";
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
        subject={subject}
        sessionsRemaining={remainingSessions}
        onToggleFlag={togglePracticeFlag}
        onStartLearnQueue={startLearnQueue}
        onRetryFlagged={retryFlaggedProblems}
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text-primary">Practice</h1>
        <Badge variant="info">
          {practiceBatch.currentIndex + 1} of {practiceBatch.problems.length}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-border-light">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        />
      </div>

      <Card variant="elevated" className="space-y-4">
        <div className="text-base font-medium text-text-primary">
          <MathText text={current.question} />
        </div>

        {feedback === "correct" ? (
          <div className="space-y-3">
            <div className="rounded-[--radius-md] p-3 bg-success-light border border-success-border">
              <p className="text-sm font-medium">Correct!</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setSelectedChoice(null); nextPracticeProblem(); }}>
              {practiceBatch.currentIndex < practiceBatch.problems.length - 1
                ? "Next Problem"
                : "See Results"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {feedback === "wrong" && (
              <div className="rounded-[--radius-md] p-3 bg-error-light border border-error-border">
                <p className="text-sm font-medium">Not quite, try again!</p>
              </div>
            )}

            {/* MC choices */}
            {choices.length > 0 ? (
              <div className="space-y-2">
                {choices.map((choice, i) => {
                  const isSelected = selectedChoice === i;
                  const isWrong = isSelected && feedback === "wrong";
                  const isSvg = choice.trim().startsWith("<svg");

                  return (
                    <button
                      key={i}
                      onClick={() => handleChoiceSelect(choice)}
                      disabled={isThinking}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[--radius-md] border px-4 py-3 text-left text-sm font-medium transition-all",
                        isWrong && "border-error bg-error-light text-error",
                        !isWrong && "border-border bg-surface text-text-primary hover:border-primary hover:bg-primary-bg",
                        isThinking && !isSelected && "opacity-50",
                      )}
                    >
                      <span className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        isWrong && "bg-error text-white",
                        !isWrong && "bg-input-bg text-text-secondary",
                      )}>
                        {isWrong ? "\u2717" : String.fromCharCode(65 + i)}
                      </span>
                      {isSvg ? (
                        <div className="rounded bg-white p-2" dangerouslySetInnerHTML={{ __html: choice }} />
                      ) : (
                        <MathText text={choice} />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-text-muted">Loading choices...</p>
            )}

            <button
              onClick={skipPracticeProblem}
              disabled={isThinking}
              className="text-xs font-medium text-text-muted hover:text-text-secondary transition-colors"
            >
              Skip this problem
            </button>
          </div>
        )}
      </Card>
      {UpgradeModal}
    </div>
  );
}
