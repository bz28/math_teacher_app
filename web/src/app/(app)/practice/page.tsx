"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button, Card, Badge } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function PracticePage() {
  const router = useRouter();
  const {
    practiceBatch,
    phase,
    error,
    submitPracticeAnswer,
    nextPracticeProblem,
    togglePracticeFlag,
    retryFlaggedProblems,
    reset,
  } = useSessionStore();

  const [answer, setAnswer] = useState("");

  useEffect(() => {
    if (phase === "idle" && !practiceBatch) {
      router.replace("/learn");
    }
  }, [phase, practiceBatch, router]);

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
    const { results, flags } = practiceBatch;
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
            {correct}/{results.length}
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
          {results.map((result, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 rounded-[--radius-md] border px-4 py-3",
                result.isCorrect ? "border-success-border bg-success-light" : "border-error-border bg-error-light",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                  result.isCorrect ? "bg-success" : "bg-error",
                )}
              >
                {result.isCorrect ? "\u2713" : "\u2717"}
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-text-primary">{result.problem}</p>
                <p className="text-xs text-text-secondary">Your answer: {result.userAnswer}</p>
                {!result.isCorrect && (
                  <p className="text-xs text-text-muted italic">Flag this question and learn it to see the answer</p>
                )}
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
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          {flagged > 0 && (
            <Button
              gradient
              onClick={async () => {
                await retryFlaggedProblems();
                // Stay on /practice — store resets to new batch
              }}
              className="w-full"
            >
              Practice {flagged} Similar Problem{flagged > 1 ? "s" : ""}
            </Button>
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
  const lastResult = practiceBatch.results[practiceBatch.currentIndex];
  const progress = (practiceBatch.currentIndex / practiceBatch.problems.length) * 100;

  async function handleSubmit() {
    if (!answer.trim()) return;
    await submitPracticeAnswer(answer.trim());
    setAnswer("");
  }

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

        {!lastResult ? (
          <div className="flex gap-2">
            <Input
              placeholder="Enter your answer..."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={isThinking}
              className="flex-1"
            />
            <Button
              onClick={handleSubmit}
              loading={isThinking}
              disabled={!answer.trim()}
              size="sm"
            >
              Answer
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className={cn(
                "rounded-[--radius-md] p-3",
                lastResult.isCorrect
                  ? "bg-success-light border border-success-border"
                  : "bg-error-light border border-error-border",
              )}
            >
              <p className="text-sm font-medium">
                {lastResult.isCorrect ? "Correct!" : "Incorrect"}
              </p>
              {!lastResult.isCorrect && (
                <p className="mt-1 text-sm text-text-muted italic">
                  Flag and learn this problem to see the answer
                </p>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={nextPracticeProblem}>
              {practiceBatch.currentIndex < practiceBatch.problems.length - 1
                ? "Next Problem"
                : "See Results"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
