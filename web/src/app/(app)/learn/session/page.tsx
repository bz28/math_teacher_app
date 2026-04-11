"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { useEntitlementStore } from "@/stores/entitlements";
import { Button, Card, Badge, TypingIndicator } from "@/components/ui";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { useRedirectOnIdle, useErrorToast } from "@/hooks/use-session-effects";
import { SkeletonStep } from "@/components/ui/skeleton";
import { useConfetti } from "@/components/ui/confetti";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/shared/math-text";
import { FREE_DAILY_CHAT_LIMIT } from "@/lib/constants";
import { LearnSummary } from "./_components/learn-summary";
import { LearnCompleted } from "./_components/learn-completed";

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
    continueAsking,
    finishAsking,
    toggleLearnFlag,
    resumeSession,
    sessionImage,
    subject,
    reset,
  } = useSessionStore();
  const { startPracticeBatch, practiceFlaggedProblems } = usePracticeStore();
  const { isPro, dailyChatsUsed, dailyChatsLimit, fetchEntitlements } = useEntitlementStore();
  const remainingChats = isPro ? Infinity : Math.max(0, dailyChatsLimit - dailyChatsUsed);

  const { fire: fireConfetti } = useConfetti();
  const [input, setInput] = useState("");
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>(
    {},
  );
  const [selectedChoice, setSelectedChoice] = useState<{
    index: number;
    correct: boolean | null;
    forStep: number;
  } | null>(null);

  // Set subject color theme
  const subjectParam = searchParams.get("subject") ?? session?.subject ?? "math";
  useEffect(() => {
    document.documentElement.setAttribute("data-subject", subjectParam);
    return () => { document.documentElement.removeAttribute("data-subject"); };
  }, [subjectParam]);

  // Resume session from history
  useEffect(() => {
    if (resumeId) {
      resumeSession(resumeId);
    }
  }, [resumeId, resumeSession]);

  useRedirectOnIdle(phase, resumeId || session);
  useErrorToast(phase, error);

  // Confetti on completion
  useEffect(() => {
    if (phase === "completed") fireConfetti();
  }, [phase, fireConfetti]);

  // Keyboard shortcut: Cmd/Ctrl+Enter to advance step
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && phase === "awaiting_input") {
        e.preventDefault();
        advanceStep();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, advanceStep]);

  // Learn queue summary
  if (phase === "learn_summary" && learnQueue) {
    return (
      <LearnSummary
        learnQueue={learnQueue}
        onToggleFlag={toggleLearnFlag}
        onPracticeFlagged={(flagged, difficulty) => practiceFlaggedProblems(flagged, subject, difficulty)}
        onReset={reset}
      />
    );
  }

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

  // Backend: current_step is 0-indexed, total_steps is count
  // Matches mobile: session.steps[session.current_step]
  const totalSteps = session.total_steps;
  const stepIndex = Math.min(session.current_step, totalSteps - 1); // clamp to valid range
  const currentStep = stepIndex + 1; // 1-indexed for display
  const steps = session.steps;
  const currentStepData = steps[stepIndex];
  const isFinalStep = stepIndex >= totalSteps - 1;
  const isCompleted = phase === "completed";
  const isThinking = phase === "thinking";
  const completedSteps = session.status === "completed" ? steps : steps.slice(0, stepIndex);
  const messages = chatHistory[stepIndex] ?? [];

  // Choice selection scoped to current step (use stepIndex for consistency)
  const activeChoice =
    selectedChoice?.forStep === stepIndex ? selectedChoice : null;
  const choiceResult =
    activeChoice && lastResponse
      ? { ...activeChoice, correct: lastResponse.is_correct }
      : activeChoice;

  async function handleAsk() {
    if (!input.trim()) return;
    if (!isPro && remainingChats <= 0) {
      showUpgrade("chat_message", `You've used all ${FREE_DAILY_CHAT_LIMIT} chat messages for today. Upgrade to Pro for unlimited chat.`);
      return;
    }
    const q = input.trim();
    setInput("");
    await askAboutStep(q);
    fetchEntitlements();
  }

  async function handleChoiceSelect(choice: string, index: number) {
    setSelectedChoice({ index, correct: null, forStep: stepIndex });
    await submitAnswer(choice);
    // Auto-reset wrong answer after 1.2s (matches mobile)
    const { lastResponse: resp } = useSessionStore.getState();
    if (resp && !resp.is_correct) {
      setTimeout(() => setSelectedChoice(null), 1200);
    }
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
            <div className="mt-1 text-lg font-semibold text-text-primary">
              <MathText text={session.problem} />
            </div>
            {sessionImage && (
              <details className="mt-3" open>
                <summary className="cursor-pointer text-xs font-semibold text-text-muted hover:text-text-secondary">
                  Original photo
                </summary>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${sessionImage}`}
                  alt="Problem"
                  className="mt-2 max-h-80 rounded-[--radius-md] border border-border object-contain cursor-pointer"
                  onClick={(e) => {
                    const img = e.currentTarget;
                    if (img.classList.contains("max-h-80")) {
                      img.classList.remove("max-h-80");
                      img.classList.add("max-h-[80vh]");
                    } else {
                      img.classList.remove("max-h-[80vh]");
                      img.classList.add("max-h-80");
                    }
                  }}
                />
              </details>
            )}
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
              width: `${((isCompleted ? totalSteps : stepIndex) / totalSteps) * 100}%`,
            }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          />
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Step {currentStep} of {totalSteps}
        </p>
      </div>

      {/* ── Completed steps timeline ── */}
      {completedSteps.length > 0 && (!isCompleted || session.status === "completed") && (
        <div className="mb-6 space-y-0">
          {completedSteps.map((step, i) => {
            const stepNum = i + 1;
            const expanded = expandedSteps[stepNum] ?? false;
            return (
              <div key={i} className="flex gap-3">
                {/* Timeline line + dot */}
                <div className="flex flex-col items-center">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-success">
                    <CheckIcon className="h-3 w-3 text-white" strokeWidth={3} />
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
                      Step {stepNum}{step.title ? ` — ${step.title}` : ""}
                    </p>
                    <div
                      className={cn(
                        "text-sm text-text-secondary",
                        !expanded && "line-clamp-1",
                      )}
                    >
                      <MathText text={step.description} />
                    </div>
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

      {/* Answer card after all steps when session is completed */}
      {session.status === "completed" && steps.length > 0 && steps[steps.length - 1].final_answer && (
        <Card variant="elevated" className="mb-6 border-success-border bg-success-light">
          <p className="text-sm font-bold text-success">Answer</p>
          <div className="mt-2 text-lg font-semibold text-text-primary">
            <MathText text={steps[steps.length - 1].final_answer ?? ""} />
          </div>
        </Card>
      )}

      {/* ── Completed state ── */}
      {isCompleted && (
        <LearnCompleted
          session={session}
          learnQueue={learnQueue}
          subject={subject}
          onContinueAsking={continueAsking}
          onToggleFlag={toggleLearnFlag}
          onAdvanceQueue={advanceLearnQueue}
          onStartPractice={startPracticeBatch}
          onReset={reset}
        />
      )}

      {/* ── "Continue asking" state (completed but user wants to ask more) ── */}
      {(phase === "awaiting_input" || phase === "thinking") && session?.status === "completed" && (
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-[--radius-md] bg-primary-bg px-4 py-3 text-sm text-primary">{msg.text}</div>
                </div>
              ) : (
                <Card variant="flat" className="border-primary/15">
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-primary">Tutor</p>
                      <div className="mt-1 text-sm leading-relaxed text-text-primary"><MathText text={msg.text} /></div>
                    </div>
                  </div>
                </Card>
              )}
            </motion.div>
          ))}

          {isThinking && (
            <TypingIndicator />
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-muted">Ask a question about the problem</p>
              {!isPro && remainingChats < Infinity && (
                <p className="text-xs text-text-muted">{remainingChats} chats remaining</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Ask a question..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                disabled={isThinking}
                className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-4 py-2.5 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              />
              {input.trim() ? (
                <Button size="sm" onClick={handleAsk} loading={isThinking}>Ask</Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={finishAsking}>I Understand Now</Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Active step (only when session is truly active, not in continue-asking) ── */}
      {!isCompleted && session.status !== "completed" && (
        <div className="space-y-4">
          {/* Current step card — re-animates when step changes */}
          <motion.div
            key={stepIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <Card variant="elevated">
              <div className="flex items-start gap-4">
                <motion.span
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 20 }}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[--radius-sm] bg-gradient-to-br from-primary to-primary-light text-sm font-bold text-white"
                >
                  {currentStep}
                </motion.span>
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <p className="text-xs font-semibold text-text-muted">
                    Step {currentStep}{currentStepData?.title ? ` — ${currentStepData.title}` : ""}
                  </p>
                  <div className="mt-1 text-base leading-relaxed text-text-primary">
                    {currentStepData ? <MathText text={currentStepData.description} /> : "Loading..."}
                  </div>
                </motion.div>
              </div>
            </Card>
          </motion.div>

          {/* Final Answer — its own card after the last step */}
          {isFinalStep && currentStepData?.final_answer && (
            <motion.div
              key="final-answer"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card variant="elevated" className="border-success-border bg-success-light">
                <p className="text-sm font-bold text-success">Answer</p>
                <div className="mt-2 text-lg font-semibold text-text-primary">
                  <MathText text={currentStepData.final_answer} />
                </div>
              </Card>
            </motion.div>
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
                      <div className="mt-1 text-sm leading-relaxed text-text-primary">
                        <MathText text={msg.text} />
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </motion.div>
          ))}


          {/* Thinking indicator */}
          {isThinking && (
            <TypingIndicator />
          )}

          {/* ── Chat input + I Understand / Ask button ── */}
          {!isCompleted && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-text-muted">Have a question about this step?</p>
                {!isPro && remainingChats < Infinity && (
                  <p className="text-xs text-text-muted">{remainingChats} chats remaining</p>
                )}
              </div>
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
      {UpgradeModal}
    </div>
  );
}
