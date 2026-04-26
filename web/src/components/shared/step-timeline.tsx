"use client";

import { useState } from "react";
import { Card, Button, TypingIndicator } from "@/components/ui";
import { CheckIcon } from "@/components/ui/icons";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

export interface TimelineChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TimelineStep {
  title?: string;
  description: string;
  final_answer?: string | null;
}

interface StepTimelineProps {
  steps: TimelineStep[];
  /** 0-based index of the active step. -1 means the whole problem is
   *  done — all steps render as completed and chat-on-current is hidden. */
  currentStepIndex: number;
  chatByStep: Record<number, TimelineChatMessage[]>;
  onConfirmStep: (index: number) => void;
  onAskStepQuestion: (index: number, question: string) => Promise<void>;
  /** Optional controlled expand state. Must be provided as a single
   *  object so you can't supply the value without the setter or vice
   *  versa — mixing them silently breaks toggle. When omitted, the
   *  component tracks expand state locally with the default rule:
   *  current step open, completed steps collapsed. */
  expandControl?: {
    expandedSteps: Set<number>;
    onToggleExpand: (index: number) => void;
  };
  /** Optional inline answer shown below the final step when complete. */
  finalAnswer?: string | null;
  /** Show "Thinking…" inline on the active step while a chat turn is
   *  in-flight. The parent sets this around its `onAskStepQuestion`. */
  thinkingStepIndex?: number | null;
  /** Override confirm-button label on the active step. Defaults to
   *  "I understand". Useful for the last step ("I'm done"). */
  confirmLabel?: string;
}

/**
 * Shared step-by-step view for the student Learn experience. Renders
 * each step in vertical order with a timeline dot, keeps earlier steps
 * collapsed, expands the active one, and supports per-step chat inline.
 *
 * Presentational only — no fetch, no store. Callers own data + handlers.
 */
export function StepTimeline({
  steps,
  currentStepIndex,
  chatByStep,
  onConfirmStep,
  onAskStepQuestion,
  expandControl,
  finalAnswer,
  thinkingStepIndex,
  confirmLabel,
}: StepTimelineProps) {
  const [localExpanded, setLocalExpanded] = useState<Set<number>>(new Set());
  const effectiveExpanded = expandControl?.expandedSteps ?? localExpanded;
  const toggleExpand = (i: number) => {
    if (expandControl) {
      expandControl.onToggleExpand(i);
      return;
    }
    setLocalExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const isCompleted = currentStepIndex < 0;

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const isCurrent = !isCompleted && i === currentStepIndex;
        const isDone = isCompleted || i < currentStepIndex;
        const isFuture = !isCompleted && i > currentStepIndex;
        if (isFuture) return null;

        const expanded = isCurrent || effectiveExpanded.has(i);
        const stepMessages = chatByStep[i] ?? [];
        const isLast = i === steps.length - 1;

        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full",
                  isDone ? "bg-success" : "bg-primary",
                )}
              >
                {isDone ? (
                  <CheckIcon className="h-3 w-3 text-white" strokeWidth={3} />
                ) : (
                  <span className="text-[10px] font-bold text-white">{i + 1}</span>
                )}
              </div>
              {!isLast && <div className="w-px flex-1 bg-border" />}
            </div>

            <div className="mb-4 flex-1 min-w-0">
              {isDone ? (
                <CompletedStep
                  step={step}
                  index={i}
                  expanded={expanded}
                  onToggle={() => toggleExpand(i)}
                  messages={stepMessages}
                />
              ) : (
                <ActiveStep
                  step={step}
                  index={i}
                  messages={stepMessages}
                  thinking={thinkingStepIndex === i}
                  onConfirm={() => onConfirmStep(i)}
                  onAsk={(q) => onAskStepQuestion(i, q)}
                  confirmLabel={confirmLabel ?? "I understand"}
                />
              )}
            </div>
          </div>
        );
      })}

      {isCompleted && finalAnswer && (
        <Card
          variant="elevated"
          className="mt-4 border-success-border bg-success-light"
        >
          <p className="text-sm font-bold text-success">Answer</p>
          <div className="mt-2 text-lg font-semibold text-text-primary">
            <MathText text={finalAnswer} />
          </div>
        </Card>
      )}
    </div>
  );
}

function CompletedStep({
  step,
  index,
  expanded,
  onToggle,
  messages,
}: {
  step: TimelineStep;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  messages: TimelineChatMessage[];
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between pb-1 text-left"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold text-success">
            Step {index + 1}
            {step.title ? ` — ${step.title}` : ""}
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

      {expanded && messages.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-border-light pl-3">
          {messages.map((msg, mi) => (
            <ChatBubble key={mi} message={msg} compact />
          ))}
        </div>
      )}
    </>
  );
}

function ActiveStep({
  step,
  index,
  messages,
  thinking,
  onConfirm,
  onAsk,
  confirmLabel,
}: {
  step: TimelineStep;
  index: number;
  messages: TimelineChatMessage[];
  thinking: boolean;
  onConfirm: () => void;
  onAsk: (question: string) => Promise<void>;
  confirmLabel: string;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function handleAsk() {
    const q = input.trim();
    if (!q || sending) return;
    setInput("");
    setSending(true);
    try {
      await onAsk(q);
    } finally {
      setSending(false);
    }
  }

  const busy = sending || thinking;

  return (
    <Card variant="elevated">
      <p className="text-xs font-semibold text-text-muted">
        Step {index + 1}
        {step.title ? ` — ${step.title}` : ""}
      </p>
      <div className="mt-1 text-base leading-relaxed text-text-primary">
        <MathText text={step.description} />
      </div>

      {messages.length > 0 && (
        <div className="mt-4 space-y-3">
          {messages.map((msg, mi) => (
            <ChatBubble key={mi} message={msg} />
          ))}
        </div>
      )}

      {thinking && (
        <div className="mt-3">
          <TypingIndicator />
        </div>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) handleAsk();
              }
            }}
            placeholder="Ask about this step…"
            disabled={busy}
            className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-4 py-2.5 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          {input.trim() ? (
            <Button size="sm" onClick={handleAsk} loading={busy}>
              Ask
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={onConfirm}
              disabled={busy}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ChatBubble({
  message,
  compact = false,
}: {
  message: TimelineChatMessage;
  compact?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[85%] rounded-[--radius-md] bg-primary-bg text-primary",
            compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm",
          )}
        >
          <MathText text={message.content} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
          <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
        </svg>
      </div>
      <div
        className={cn(
          "flex-1 leading-relaxed text-text-primary",
          compact ? "text-xs" : "text-sm",
        )}
      >
        <MathText text={message.content} />
      </div>
    </div>
  );
}
