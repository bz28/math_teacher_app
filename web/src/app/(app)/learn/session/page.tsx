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
    error,
    chatHistory,
    learnQueue,
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
  const [askMode, setAskMode] = useState(false);
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>(
    {},
  );

  // data-subject is synced at the layout level by <SubjectTheme />, which
  // reads useSessionStore().subject. Nothing to do here.

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
        onPracticeFlagged={(flagged) => practiceFlaggedProblems(flagged, subject)}
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

  function toggleExpandStep(stepNum: number) {
    setExpandedSteps((prev) => ({ ...prev, [stepNum]: !prev[stepNum] }));
  }

  return (
    <div className="mx-auto max-w-3xl pb-32">
      {/* Slim header — problem pill + step dots */}
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/learn")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-primary-bg hover:text-primary"
          aria-label="Back to Solve"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-primary-bg px-4 py-2 text-xs font-semibold text-primary">
          <span className="min-w-0 flex-1 truncate">
            <MathText text={session.problem} />
          </span>
          {sessionImage && (
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-primary/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          )}
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i < stepIndex && "w-1.5 bg-success",
                i === stepIndex && "w-4 bg-primary",
                i > stepIndex && "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
        {learnQueue && (
          <Badge variant="info">
            {learnQueue.currentIndex + 1}/{learnQueue.problems.length}
          </Badge>
        )}
      </div>

      {/* ── Completed steps timeline ── */}
      {completedSteps.length > 0 && (!isCompleted || session.status === "completed") && (
        <div className="mb-6">
          {completedSteps.map((step, i) => {
            const stepNum = i + 1;
            const expanded = expandedSteps[stepNum] ?? false;
            const isLast = i === completedSteps.length - 1;
            return (
              <div key={i} className="flex gap-3">
                {/* Timeline line + dot */}
                <div className="flex flex-col items-center">
                  <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success">
                    <CheckIcon className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                  </div>
                  {!isLast && <div className="mt-1 w-0.5 flex-1 bg-success-border" />}
                </div>
                {/* Content */}
                <button
                  type="button"
                  onClick={() => toggleExpandStep(stepNum)}
                  className="mb-3 flex flex-1 items-start justify-between pb-1 text-left"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} step ${stepNum}`}
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-success">
                      Step {stepNum}{step.title ? ` — ${step.title}` : ""}
                    </p>
                    <div
                      className={cn(
                        "mt-0.5 text-[13px] leading-[18px] text-text-secondary",
                        !expanded && "line-clamp-1",
                      )}
                    >
                      <MathText text={step.description} />
                    </div>
                  </div>
                  <svg
                    className={cn(
                      "ml-2 h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform",
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
          <div className="flex flex-col gap-1.5">
            {messages.map((msg, i) => (
              <ChatBubble key={i} role={msg.role} text={msg.text} />
            ))}
          </div>

          {isThinking && <TypingIndicator />}

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
        <div className="space-y-3">
          {/* Current step card — primaryBg with primary border, re-animates on step change */}
          <motion.div
            key={stepIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="rounded-[--radius-lg] border-[1.5px] border-primary-light bg-primary-bg p-4 shadow-sm"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Step {currentStep}{currentStepData?.title ? ` — ${currentStepData.title}` : ""}
            </p>
            <div className="mt-1 text-base font-semibold leading-relaxed text-primary-dark">
              {currentStepData ? <MathText text={currentStepData.description} /> : "Loading..."}
            </div>
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

          {/* ── iMessage-style chat thread for this step ── */}
          {messages.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {messages.map((msg, i) => (
                <ChatBubble key={i} role={msg.role} text={msg.text} />
              ))}
            </div>
          )}

          {/* Thinking indicator */}
          {isThinking && <TypingIndicator />}
        </div>
      )}

      {/* Sticky bottom action bar — only when actively working a step */}
      {!isCompleted && session.status !== "completed" && (
        <div className="fixed bottom-16 left-0 right-0 z-30 border-t border-border-light bg-surface/95 backdrop-blur md:bottom-0">
          <div className="mx-auto max-w-3xl px-4 py-3">
            {askMode ? (
              <div className="flex h-12 items-center gap-2 rounded-[--radius-pill] border border-border bg-input-bg px-3">
                <input
                  autoFocus
                  placeholder="Ask about this step…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim()) {
                        handleAsk();
                        setAskMode(false);
                      } else setAskMode(false);
                    } else if (e.key === "Escape") {
                      setAskMode(false);
                      setInput("");
                    }
                  }}
                  disabled={isThinking}
                  className="h-10 flex-1 bg-transparent px-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
                  aria-label="Ask a question about this step"
                />
                {/* Inline "I understand →" pill — advance the step without asking */}
                <button
                  type="button"
                  onClick={() => {
                    setAskMode(false);
                    setInput("");
                    advanceStep();
                  }}
                  disabled={isThinking}
                  className="flex items-center gap-1 rounded-[--radius-pill] bg-primary-bg px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                  aria-label="I understand, advance step"
                >
                  I understand
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
                {/* Circular send button */}
                <button
                  type="button"
                  onClick={() => { if (input.trim()) { handleAsk(); setAskMode(false); } }}
                  disabled={!input.trim() || isThinking}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm hover:bg-primary-dark disabled:opacity-40"
                  aria-label="Send question"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button
                  gradient
                  onClick={advanceStep}
                  loading={isThinking}
                  className="flex-[2] py-3"
                  aria-label="I get it, next step"
                >
                  I get it →
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setAskMode(true)}
                  className="flex-1 py-3"
                  aria-label="Ask a question about this step"
                >
                  Ask
                </Button>
              </div>
            )}
            {askMode && !isPro && remainingChats < Infinity && (
              <p className="mt-1 text-center text-xs text-text-muted">
                {remainingChats} chats left today
              </p>
            )}
          </div>
        </div>
      )}

      {UpgradeModal}
    </div>
  );
}

/**
 * iMessage-style chat bubble.
 *
 * - User: right-aligned, bg-primary / white text, sharp bottom-right corner.
 * - Tutor: left-aligned, bg-surface / border, sharp bottom-left corner.
 *
 * Matches mobile SessionScreen chat bubbles.
 */
function ChatBubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex", isUser ? "justify-end pl-12" : "justify-start pr-12")}
    >
      <div
        className={cn(
          "max-w-full rounded-[18px] px-4 py-2 text-sm leading-snug",
          isUser
            ? "rounded-br-[4px] bg-primary text-text-on-primary"
            : "rounded-bl-[4px] border border-border-light bg-surface text-text-primary",
        )}
      >
        <MathText text={text} />
      </div>
    </motion.div>
  );
}
