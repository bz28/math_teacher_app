"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button, Card, Badge } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { StepChat } from "@/components/session/step-chat";
import { cn } from "@/lib/utils";

export default function LearnSessionPage() {
  const router = useRouter();
  const {
    session,
    phase,
    lastResponse,
    error,
    learnQueue,
    submitAnswer,
    advanceStep,
    advanceLearnQueue,
    reset,
  } = useSessionStore();

  const [answer, setAnswer] = useState("");

  // Redirect if no session
  useEffect(() => {
    if (phase === "idle") {
      router.replace("/learn");
    }
  }, [phase, router]);

  if (phase === "loading" || !session) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
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

  // API returns current_step: 0 before first interaction — treat as step 1
  const currentStep = Math.max(1, session.current_step);
  const totalSteps = session.total_steps;
  const steps = session.steps;
  const stepIndex = currentStep - 1; // 0-based index into steps array
  const isCompleted = phase === "completed";
  const isThinking = phase === "thinking";

  async function handleSubmitAnswer() {
    if (!answer.trim()) return;
    await submitAnswer(answer.trim());
    setAnswer("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmitAnswer();
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Problem header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-muted">Problem</p>
            <p className="mt-1 text-lg font-semibold text-text-primary">
              {session.problem}
            </p>
          </div>
          {learnQueue && (
            <Badge variant="info">
              {learnQueue.currentIndex + 1} of {learnQueue.problems.length}
            </Badge>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-2 w-full rounded-full bg-border-light overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            initial={{ width: 0 }}
            animate={{
              width: `${((isCompleted ? totalSteps : currentStep - 1) / totalSteps) * 100}%`,
            }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Step {Math.min(currentStep, totalSteps)} of {totalSteps}
        </p>
      </div>

      {/* Desktop layout: step list + active step */}
      <div className="flex gap-6">
        {/* Step sidebar (desktop only) */}
        <div className="hidden w-48 flex-shrink-0 space-y-2 lg:block">
          {steps.map((step, i) => {
            const stepNum = i + 1;
            const isCurrent = stepNum === currentStep && !isCompleted;
            const isDone = stepNum < currentStep || isCompleted;

            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 rounded-[--radius-sm] px-3 py-2 text-sm transition-colors",
                  isCurrent && "bg-primary-bg text-primary font-semibold",
                  isDone && "text-success",
                  !isCurrent && !isDone && "text-text-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    isCurrent && "bg-primary text-white",
                    isDone && "bg-success text-white",
                    !isCurrent && !isDone && "bg-border-light text-text-muted",
                  )}
                >
                  {isDone ? (
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    stepNum
                  )}
                </span>
                <span className="truncate">Step {stepNum}</span>
              </div>
            );
          })}
        </div>

        {/* Active step + chat */}
        <div className="flex-1 space-y-4">
          {/* Current step card */}
          <Card variant="elevated" className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                {currentStep}
              </span>
              <h2 className="text-base font-bold text-text-primary">
                {steps[stepIndex]?.description ?? "Loading..."}
              </h2>
            </div>

            {/* Multiple choice options */}
            {steps[stepIndex]?.choices &&
              !isCompleted &&
              steps[stepIndex].choices!.map((choice, i) => (
                <button
                  key={i}
                  onClick={() => submitAnswer(choice)}
                  disabled={isThinking}
                  className="w-full rounded-[--radius-md] border border-border bg-input-bg px-4 py-3 text-left text-sm font-medium text-text-primary transition-colors hover:border-primary hover:bg-primary-bg disabled:opacity-50"
                >
                  {choice}
                </button>
              ))}

            {/* Text answer input */}
            {!steps[stepIndex]?.choices && !isCompleted && (
              <div className="flex gap-2">
                <Input
                  placeholder="Your answer..."
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1"
                  disabled={isThinking}
                />
                <Button
                  onClick={handleSubmitAnswer}
                  loading={isThinking}
                  disabled={!answer.trim()}
                  size="sm"
                >
                  Submit
                </Button>
              </div>
            )}

            {/* Feedback */}
            {lastResponse && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "rounded-[--radius-md] p-4",
                  lastResponse.is_correct
                    ? "bg-success-light border border-success-border"
                    : "bg-error-light border border-error-border",
                )}
              >
                <p className="text-sm font-medium">
                  {lastResponse.is_correct ? "Correct!" : "Not quite."}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {lastResponse.feedback}
                </p>
              </motion.div>
            )}

            {/* Advance / Next buttons */}
            {lastResponse && !isCompleted && (
              <Button variant="secondary" onClick={advanceStep} loading={isThinking}>
                Next Step
              </Button>
            )}

            {/* Completed state */}
            {isCompleted && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="rounded-[--radius-md] bg-success-light border border-success-border p-4 text-center">
                  <p className="text-lg font-bold text-success">
                    Problem Complete!
                  </p>
                  {steps[totalSteps - 1]?.final_answer && (
                    <p className="mt-2 text-sm text-text-secondary">
                      Final answer:{" "}
                      <strong>{steps[totalSteps - 1].final_answer}</strong>
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  {learnQueue &&
                    learnQueue.currentIndex < learnQueue.problems.length - 1 && (
                      <Button gradient onClick={advanceLearnQueue}>
                        Next Problem
                      </Button>
                    )}
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
              </motion.div>
            )}
          </Card>

          {/* Step chat */}
          {!isCompleted && <StepChat />}
        </div>
      </div>
    </div>
  );
}
