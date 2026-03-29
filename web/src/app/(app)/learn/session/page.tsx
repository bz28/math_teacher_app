"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/session";
import { Button, Card, Badge } from "@/components/ui";
import { SkeletonStep } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function LearnSessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get("resume");
  const {
    session,
    phase,
    lastResponse,
    error,
    chatHistory,
    learnQueue,
    submitAnswer,
    advanceStep,
    askAboutStep,
    advanceLearnQueue,
    resumeSession,
    reset,
  } = useSessionStore();

  const [input, setInput] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>(
    {},
  );
  const [selectedChoice, setSelectedChoice] = useState<{
    index: number;
    correct: boolean | null;
    forStep: number;
  } | null>(null);

  // Resume session from history
  useEffect(() => {
    if (resumeId && phase === "idle") {
      resumeSession(resumeId);
    }
  }, [resumeId, phase, resumeSession]);

  // Redirect if no session and not resuming
  useEffect(() => {
    if (phase === "idle" && !resumeId) {
      router.replace("/learn");
    }
  }, [phase, router, resumeId]);

  if (phase === "loading" || !session) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
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
  const messages = chatHistory[currentStep] ?? [];

  // Choice selection scoped to current step
  const activeChoice =
    selectedChoice?.forStep === currentStep ? selectedChoice : null;
  const choiceResult =
    activeChoice && lastResponse
      ? { ...activeChoice, correct: lastResponse.is_correct }
      : activeChoice;

  async function handleAsk() {
    if (!input.trim()) return;
    const q = input.trim();
    setInput("");
    await askAboutStep(q);
  }

  async function handleChoiceSelect(choice: string, index: number) {
    setSelectedChoice({ index, correct: null, forStep: currentStep });
    await submitAnswer(choice);
  }

  function toggleExpandStep(stepNum: number) {
    setExpandedSteps((prev) => ({ ...prev, [stepNum]: !prev[stepNum] }));
  }

  return (
    <div className="mx-auto max-w-3xl">
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

      {/* ── Completed steps timeline ── */}
      {currentStep > 1 && !isCompleted && (
        <div className="mb-6 space-y-0">
          {steps.slice(0, stepIndex).map((step, i) => {
            const stepNum = i + 1;
            const expanded = expandedSteps[stepNum] ?? false;
            return (
              <div key={i} className="flex gap-3">
                {/* Timeline line + dot */}
                <div className="flex flex-col items-center">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-success">
                    <svg
                      className="h-3 w-3 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div className="w-px flex-1 bg-border" />
                </div>
                {/* Content */}
                <button
                  onClick={() => toggleExpandStep(stepNum)}
                  className="mb-3 flex flex-1 items-start justify-between pb-1 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-success">
                      Step {stepNum}
                    </p>
                    <p
                      className={cn(
                        "text-sm text-text-secondary",
                        !expanded && "line-clamp-1",
                      )}
                    >
                      {step.description}
                    </p>
                    {expanded && step.final_answer && (
                      <p className="mt-1 text-sm font-medium text-text-primary">
                        &rarr; {step.final_answer}
                      </p>
                    )}
                  </div>
                  <svg
                    className={cn(
                      "ml-2 h-4 w-4 flex-shrink-0 text-text-muted transition-transform",
                      expanded && "rotate-180",
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Completed state ── */}
      {isCompleted && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card variant="elevated" className="space-y-5 text-center">
            {/* Checkmark */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <svg
                className="h-8 w-8 text-success"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <h2 className="text-xl font-extrabold text-text-primary">
              Problem Solved!
            </h2>

            {steps[totalSteps - 1]?.final_answer && (
              <p className="text-sm text-text-secondary">
                Answer:{" "}
                <strong className="text-text-primary">
                  {steps[totalSteps - 1].final_answer}
                </strong>
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {learnQueue &&
                learnQueue.currentIndex <
                  learnQueue.problems.length - 1 && (
                  <Button gradient onClick={advanceLearnQueue} className="w-full">
                    Next Problem
                  </Button>
                )}
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                  router.push("/home");
                }}
                className="w-full"
              >
                Return Home
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* ── Active step (non-completed) ── */}
      {!isCompleted && (
        <div className="space-y-4">
          {/* Current step card */}
          <Card variant="elevated">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[--radius-sm] bg-gradient-to-br from-primary to-primary-light text-sm font-bold text-white">
                {currentStep}
              </span>
              <div>
                <p className="text-xs font-semibold text-text-muted">
                  Step {currentStep}
                </p>
                <p className="mt-1 text-base leading-relaxed text-text-primary">
                  {currentStepData?.description ?? "Loading..."}
                </p>
              </div>
            </div>
          </Card>

          {/* Final step: multiple choice or text answer fallback */}
          {isFinalStep && currentStepData?.choices && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-text-secondary">
                What is the result?
              </p>
              {currentStepData.choices.map((choice, i) => {
                const isSelected = choiceResult?.index === i;
                const isCorrect =
                  isSelected && choiceResult?.correct === true;
                const isWrong =
                  isSelected && choiceResult?.correct === false;

                return (
                  <button
                    key={i}
                    onClick={() => handleChoiceSelect(choice, i)}
                    disabled={isThinking || (choiceResult?.correct === true)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[--radius-md] border px-4 py-3 text-left text-sm font-medium transition-all",
                      isCorrect &&
                        "border-success bg-success-light text-success",
                      isWrong && "border-error bg-error-light text-error",
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

          {/* ── Inline chat: question bubbles + tutor responses ── */}
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {msg.role === "user" ? (
                /* User question bubble */
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-[--radius-md] bg-primary-bg px-4 py-3 text-sm text-primary">
                    {msg.text}
                  </div>
                </div>
              ) : (
                /* Tutor response card */
                <Card variant="flat" className="border-primary/15">
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-primary">
                        Tutor
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-text-primary">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </motion.div>
          ))}

          {/* Final step fallback: text answer when no choices */}
          {isFinalStep && !currentStepData?.choices && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-text-secondary">
                What is the answer?
              </p>
              <div className="flex gap-2">
                <input
                  placeholder="Type your answer..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                      e.preventDefault();
                      submitAnswer(input.trim());
                      setInput("");
                    }
                  }}
                  disabled={isThinking}
                  className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-4 py-2.5 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (input.trim()) {
                      submitAnswer(input.trim());
                      setInput("");
                    }
                  }}
                  loading={isThinking}
                  disabled={!input.trim()}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Thinking...
            </div>
          )}

          {/* ── Chat input + I Understand / Ask button ── */}
          {!isFinalStep && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-text-muted">
                Have a question about this step?
              </p>
              <div className="flex gap-2">
                <input
                  placeholder="Ask a question..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim()) handleAsk();
                    }
                  }}
                  disabled={isThinking}
                  className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-4 py-2.5 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
                {input.trim() ? (
                  <Button
                    size="sm"
                    onClick={handleAsk}
                    loading={isThinking}
                  >
                    Ask
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={advanceStep}
                    loading={isThinking}
                  >
                    I Understand
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
