"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button, Card, Badge } from "@/components/ui";
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

  const [selectedChoice, setSelectedChoice] = useState<{
    index: number;
    correct: boolean | null;
    forStep: number;
  } | null>(null);

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

  const currentStep = Math.max(1, session.current_step);
  const totalSteps = session.total_steps;
  const steps = session.steps;
  const stepIndex = currentStep - 1;
  const currentStepData = steps[stepIndex];
  const isFinalStep = currentStep === totalSteps;
  const isCompleted = phase === "completed";
  const isThinking = phase === "thinking";

  async function handleChoiceSelect(choice: string, index: number) {
    setSelectedChoice({ index, correct: null, forStep: currentStep });
    await submitAnswer(choice);
  }

  // After submitAnswer, check if the response was correct. Ignore stale selections from previous steps.
  const activeChoice =
    selectedChoice?.forStep === currentStep ? selectedChoice : null;
  const choiceResult =
    activeChoice && lastResponse
      ? { ...activeChoice, correct: lastResponse.is_correct }
      : activeChoice;

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
              width: `${((isCompleted ? totalSteps : currentStep) / totalSteps) * 100}%`,
            }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Step {currentStep} of {totalSteps}
        </p>
      </div>

      {/* Desktop layout: step list + active step */}
      <div className="flex gap-6">
        {/* Step sidebar (desktop only) */}
        <div className="hidden w-48 flex-shrink-0 space-y-1 lg:block">
          {steps.map((step, i) => {
            const stepNum = i + 1;
            const isCurrent = stepNum === currentStep && !isCompleted;
            const isDone = stepNum < currentStep || isCompleted;

            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2.5 rounded-[--radius-sm] px-3 py-2 text-sm transition-colors",
                  isCurrent && "bg-primary-bg font-semibold text-primary",
                  isDone && "text-text-secondary",
                  !isCurrent && !isDone && "text-text-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    isCurrent && "bg-primary text-white",
                    isDone && "bg-success text-white",
                    !isCurrent && !isDone && "bg-border text-text-muted",
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
                <span className="truncate text-xs">
                  {isDone || isCurrent
                    ? step.description.slice(0, 30) + (step.description.length > 30 ? "..." : "")
                    : `Step ${stepNum}`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Active step + chat */}
        <div className="flex-1 space-y-4">
          {/* Current step card */}
          <Card variant="elevated" className="space-y-5">
            {/* Step header */}
            <div className="flex items-start gap-4">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[--radius-md] bg-gradient-to-br from-primary to-primary-light text-sm font-bold text-white">
                {currentStep}
              </span>
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wide text-text-muted">
                  Step {currentStep} of {totalSteps}
                </p>
                <p className="mt-1 text-base leading-relaxed text-text-primary">
                  {currentStepData?.description ?? "Loading..."}
                </p>
              </div>
            </div>

            {/* Final step: multiple choice */}
            {isFinalStep && currentStepData?.choices && !isCompleted && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-text-secondary">
                  What is the result?
                </p>
                {currentStepData.choices.map((choice, i) => {
                  const isSelected = choiceResult?.index === i;
                  const isCorrect = isSelected && choiceResult?.correct === true;
                  const isWrong = isSelected && choiceResult?.correct === false;

                  return (
                    <button
                      key={i}
                      onClick={() => handleChoiceSelect(choice, i)}
                      disabled={isThinking}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[--radius-md] border px-4 py-3 text-left text-sm font-medium transition-all",
                        isCorrect &&
                          "border-success bg-success-light text-success",
                        isWrong &&
                          "border-error bg-error-light text-error",
                        !isSelected &&
                          "border-border bg-white text-text-primary hover:border-primary hover:bg-primary-bg",
                        isThinking && !isSelected && "opacity-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                          isCorrect && "bg-success text-white",
                          isWrong && "bg-error text-white",
                          !isSelected && "bg-input-bg text-text-secondary",
                        )}
                      >
                        {isCorrect
                          ? "\u2713"
                          : isWrong
                            ? "\u2717"
                            : String.fromCharCode(65 + i)}
                      </span>
                      {choice}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Non-final step: "I Understand" button */}
            {!isFinalStep && !isCompleted && (
              <Button
                variant="secondary"
                onClick={advanceStep}
                loading={isThinking}
                className="w-full"
              >
                I Understand
              </Button>
            )}

            {/* Feedback from tutor (for wrong answers or chat) */}
            {lastResponse && lastResponse.feedback && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "rounded-[--radius-md] p-4",
                  lastResponse.is_correct
                    ? "bg-success-light border border-success-border"
                    : "bg-primary-bg border border-primary/20",
                )}
              >
                <p className="text-sm leading-relaxed text-text-primary">
                  {lastResponse.feedback}
                </p>
              </motion.div>
            )}

            {/* Completed state */}
            {isCompleted && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="rounded-[--radius-md] bg-success-light border border-success-border p-5 text-center">
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
                    learnQueue.currentIndex <
                      learnQueue.problems.length - 1 && (
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

          {/* Step chat — ask questions about the step */}
          {!isCompleted && <StepChat />}
        </div>
      </div>
    </div>
  );
}
