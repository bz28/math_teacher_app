"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { session as sessionApi } from "@/lib/api";
import { Button, Card, Badge, useToast, AnimatedCounter } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { AttachWork } from "@/components/ui/attach-work";
import { DiagnosisTeaser } from "@/components/ui/diagnosis-teaser";
import { cn } from "@/lib/utils";

export default function PracticePage() {
  const router = useRouter();
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
    startLearnQueue,
    reset,
  } = useSessionStore();

  const toast = useToast();
  const { fire: fireConfetti } = useConfetti();
  const [answer, setAnswer] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  useEffect(() => {
    if (phase === "idle" && !practiceBatch) {
      router.replace("/learn");
    }
  }, [phase, practiceBatch, router]);

  useEffect(() => {
    if (phase === "error" && error) toast.error(error);
  }, [phase, error, toast]);

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
        }).catch(() => {}); // Silent fail — history is non-critical
      }
    }
  }, [phase, practiceBatch, fireConfetti]);

  const doSubmit = useCallback(async () => {
    if (!answer.trim() || !practiceBatch) return;
    const idx = practiceBatch.currentIndex;
    const text = answer.trim();

    // Fire work diagnosis in background if image attached
    if (attachedImage) {
      submitPracticeWork(idx, attachedImage, text);
    }

    await submitPracticeAnswer(text);
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
    const { results, flags, workSubmissions } = practiceBatch;
    const correct = results.filter((r) => r.isCorrect).length;
    const flagged = flags.filter(Boolean).length;
    const percentage = Math.round((correct / results.length) * 100);
    const encouragement =
      percentage === 100
        ? "Perfect score!"
        : percentage >= 80
          ? "Great job!"
          : percentage >= 50
            ? "Good effort, keep practicing!"
            : "Keep going, you'll get there!";

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-extrabold text-text-primary">Results</h1>
        </motion.div>

        {/* Score card */}
        <Card variant="elevated" className="text-center space-y-3">
          <p className="text-4xl font-extrabold text-primary">
            <AnimatedCounter to={correct} />/{results.length}
          </p>
          <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-border-light">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-sm font-medium text-text-secondary">
            {encouragement}
          </p>
        </Card>

        {/* Per-result breakdown */}
        <div className="space-y-2">
          {results.map((result, i) => {
            const wasCorrect = result.isCorrect;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-[--radius-md] border px-4 py-3",
                  wasCorrect ? "border-success-border bg-success-light" : "border-error-border bg-error-light",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                    wasCorrect ? "bg-success" : "bg-error",
                  )}
                >
                  {wasCorrect ? "\u2713" : "\u2717"}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-text-primary">{result.problem}</p>
                  <p className="text-xs text-text-secondary">
                    {result.userAnswer === "(skipped)" ? "Skipped" : `Your answer: ${result.userAnswer}`}
                  </p>
                  <DiagnosisTeaser diagnosis={workSubmissions[i]} />
                </div>
                <button
                  onClick={() => togglePracticeFlag(i)}
                  className={cn(
                    "rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors flex-shrink-0",
                    flags[i]
                      ? "border-warning-dark/30 bg-warning-bg text-warning-dark"
                      : "border-border text-text-muted hover:border-warning-dark/30 hover:text-warning-dark",
                  )}
                >
                  {flags[i] ? "Flagged" : "Flag"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {flagged > 0 && (
            <>
              <Button
                gradient
                onClick={async () => {
                  const flaggedProblems = results
                    .filter((_, i) => flags[i])
                    .map((r) => r.problem);
                  await startLearnQueue(flaggedProblems);
                  router.push("/learn/session");
                }}
                className="w-full"
              >
                Learn {flagged} Flagged Problem{flagged > 1 ? "s" : ""}
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await retryFlaggedProblems();
                  // Stay on /practice — store resets to new batch
                }}
                className="w-full"
              >
                Practice {flagged} Similar Problem{flagged > 1 ? "s" : ""}
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => { reset(); router.push("/learn"); }} className="w-full">
            New Problem
          </Button>
          <Button variant="secondary" onClick={() => { reset(); router.push("/home"); }} className="w-full">
            Return Home
          </Button>
        </div>
      </div>
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
