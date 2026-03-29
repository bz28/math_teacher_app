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

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-extrabold text-text-primary">
            Practice Complete
          </h1>
          <p className="mt-1 text-text-secondary">
            {correct}/{results.length} correct
            {flagged > 0 && ` | ${flagged} flagged for review`}
          </p>
        </motion.div>

        <div className="space-y-3">
          {results.map((result, i) => (
            <Card key={i} variant="flat" className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                  result.isCorrect ? "bg-success" : "bg-error",
                )}
              >
                {result.isCorrect ? "\u2713" : "\u2717"}
              </span>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  {result.problem}
                </p>
                <p className="text-xs text-text-secondary">
                  Your answer: {result.userAnswer}
                </p>
                {!result.isCorrect && (
                  <p className="text-xs text-success">
                    Correct: {result.correctAnswer}
                  </p>
                )}
              </div>
              {flags[i] && <Badge variant="warning">Flagged</Badge>}
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              router.push("/home");
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  // Active practice
  const current = practiceBatch.problems[practiceBatch.currentIndex];
  const isThinking = phase === "thinking";
  const lastResult = practiceBatch.results[practiceBatch.currentIndex];

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

      <Card variant="elevated" className="space-y-4">
        <p className="text-base font-medium text-text-primary">
          {current.question}
        </p>

        {!lastResult ? (
          <div className="flex gap-2">
            <Input
              placeholder="Your answer..."
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
              Check
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
                <p className="mt-1 text-sm text-text-secondary">
                  The correct answer is: {current.answer}
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
