"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { session as sessionApi } from "@/lib/api";
import { Button, Card, Badge, AnimatedCounter } from "@/components/ui";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { AttachWork } from "@/components/ui/attach-work";
import { DiagnosisTeaser } from "@/components/ui/diagnosis-teaser";
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

  const { fire: fireConfetti } = useConfetti();
  const [answer, setAnswer] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

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

  const doSubmit = useCallback(async () => {
    if (!answer.trim() || !practiceBatch) return;
    const idx = practiceBatch.currentIndex;
    const text = answer.trim();

    // Fire work diagnosis in background if image attached
    if (attachedImage) {
      submitPracticeWork(idx, attachedImage, text, subject);
    }

    await submitPracticeAnswer(text, subject);
    setAnswer("");
    setAttachedImage(null);
    setShowNudge(false);
  }, [answer, attachedImage, practiceBatch, submitPracticeAnswer, submitPracticeWork]);

  function handleSubmitOrNudge() {
    if (!answer.trim()) return;
    // Nudge once if no work attached and nudge not yet dismissed
    if (!attachedImage && !nudgeDismissed) {
      setShowNudge(true);
      return;
    }
    doSubmit();
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
        onToggleFlag={togglePracticeFlag}
        onStartLearnQueue={startLearnQueue}
        onRetryFlagged={retryFlaggedProblems}
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
        <p className="text-base font-medium text-text-primary">
          {current.question}
        </p>

        {feedback === "correct" ? (
          <div className="space-y-3">
            <div className="rounded-[--radius-md] p-3 bg-success-light border border-success-border">
              <p className="text-sm font-medium">Correct!</p>
            </div>
            <Button variant="secondary" size="sm" onClick={nextPracticeProblem}>
              {practiceBatch.currentIndex < practiceBatch.problems.length - 1
                ? "Next Problem"
                : "See Results"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Wrong answer feedback */}
            {feedback === "wrong" && (
              <div className="rounded-[--radius-md] p-3 bg-error-light border border-error-border">
                <p className="text-sm font-medium">Not quite, try again!</p>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                placeholder="Enter your answer..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmitOrNudge();
                  }
                }}
                disabled={isThinking}
                className="flex-1"
              />
              <Button
                onClick={handleSubmitOrNudge}
                loading={isThinking}
                disabled={!answer.trim()}
                size="sm"
              >
                Answer
              </Button>
            </div>

            {/* Skip button */}
            <button
              onClick={skipPracticeProblem}
              disabled={isThinking}
              className="text-xs font-medium text-text-muted hover:text-text-secondary transition-colors"
            >
              Skip this problem
            </button>

            {/* Attach work */}
            <AttachWork
              attached={!!attachedImage}
              onAttach={(base64) => { setAttachedImage(base64); setShowNudge(false); }}
            />

            {/* Work nudge */}
            {showNudge && (
              <div className="rounded-[--radius-md] border border-primary/20 bg-primary-bg p-3 space-y-2">
                <p className="text-sm font-medium text-primary">Attach your work?</p>
                <p className="text-xs text-text-secondary">
                  You&apos;ll get feedback on exactly where you went wrong.
                </p>
                <Button size="sm" variant="secondary" onClick={() => { setShowNudge(false); setNudgeDismissed(true); doSubmit(); }}>
                  Skip &amp; submit without work
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
