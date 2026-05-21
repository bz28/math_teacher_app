"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  schoolStudent,
  type ProblemChatMessage,
  type WalkthroughOpenedResponse,
} from "@/lib/api";
import { Button, Card, TypingIndicator } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Paced step reveal + persistent per-step chat for the Mastery Loop
 * walkthrough.
 *
 * Flow:
 *  1. Open: POST /walkthrough-opened → server stamps the mastery row
 *     (closing the mastery line) and returns the teacher-authored
 *     solution_steps + final_answer.
 *  2. Reveal: steps animate in one at a time as the student taps "I
 *     understand" — same pace as consumer /learn/session uses, so
 *     the tutoring feel matches.
 *  3. Per-step chat: each revealed step gets a chat input. Asking
 *     persists the turn server-side under (student, bank_item) so
 *     the conversation survives reloads + reentry.
 *  4. Final answer card after the last step + "Now try answering
 *     it" CTA bouncing back to the parent's Answer mode.
 *
 * Chat thread is global to the problem — opens across walkthrough
 * sessions, lives forever, includes per-problem asks made
 * post-walkthrough too. The full transcript is loaded on mount so
 * a student returning a week later sees their prior questions.
 */
export function WalkthroughPanel({
  bankItemId,
  onReady,
  onReturnToAnswer,
  onSkip,
}: {
  bankItemId: string;
  /** Called once when the walkthrough opens successfully — parent
   *  uses this to update the mastery state badge in the header. */
  onReady?: (resp: WalkthroughOpenedResponse) => void;
  /** Student clicked "Now try answering" after the final step. */
  onReturnToAnswer: () => void;
  /** "Skip this problem" — collapse and advance. */
  onSkip: () => void;
}) {
  const [data, setData] = useState<WalkthroughOpenedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 1-indexed count of revealed steps. Starts at 1 because the
  // student already committed by opening the walkthrough; the first
  // step is visible immediately.
  const [revealedCount, setRevealedCount] = useState(1);
  const [messages, setMessages] = useState<ProblemChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    schoolStudent
      .openProblemWalkthrough(bankItemId)
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
        onReady?.(resp);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't open the walkthrough. Try again.");
      });
    schoolStudent
      .problemChatHistory(bankItemId)
      .then((h) => {
        if (!cancelled) setMessages(h.messages);
      })
      .catch(() => {
        // Soft-fail: chat history is a nice-to-have on entry. The
        // student can still ask new questions even if the history
        // load fails; we just won't show prior turns.
      });
    return () => {
      cancelled = true;
    };
  }, [bankItemId, onReady]);

  if (error) {
    return (
      <Card variant="flat" className="text-center">
        <p className="text-error">{error}</p>
        <Button variant="secondary" className="mt-3" onClick={onSkip}>
          Skip this problem
        </Button>
      </Card>
    );
  }
  if (data === null) {
    return (
      <Card variant="flat">
        <p className="text-sm text-text-muted">Opening walkthrough…</p>
      </Card>
    );
  }

  const steps = data.solution_steps;
  const total = steps.length;
  const revealed = Math.min(revealedCount, total);
  const isLastRevealed = revealed >= total;

  async function handleAsk(stepIndex: number | null) {
    const q = chatInput.trim();
    if (!q || asking) return;
    setAsking(true);
    setActiveStepIndex(stepIndex);
    // Optimistic: render the user message immediately. The server
    // returns the assistant reply; we append both with timestamps
    // that match what GET /chat would return on reload.
    const optimisticUser: ProblemChatMessage = {
      role: "user",
      content: q,
      step_index: stepIndex,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    setChatInput("");
    try {
      const resp = await schoolStudent.askProblemTutor(bankItemId, {
        question: q,
        step_index: stepIndex,
      });
      const reply: ProblemChatMessage = {
        role: "assistant",
        content: resp.reply,
        step_index: stepIndex,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, reply]);
    } catch {
      // Rollback the optimistic user message — server has nothing
      // persisted (the endpoint commits atomically with the reply).
      setMessages((m) =>
        m.filter((msg) => msg !== optimisticUser),
      );
      setError("Couldn't reach the tutor. Try again in a moment.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Revealed steps timeline */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {steps.slice(0, revealed).map((step, i) => {
            const isCurrent = i === revealed - 1;
            const stepMessages = messages.filter((m) => m.step_index === i);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 26 }}
              >
                <Card
                  variant={isCurrent ? "elevated" : "flat"}
                  className={cn(
                    isCurrent ? "border-primary/40" : "border-border-light",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        isCurrent
                          ? "bg-primary text-white"
                          : "bg-success text-white",
                      )}
                    >
                      {isCurrent ? i + 1 : <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider",
                          isCurrent ? "text-primary" : "text-success",
                        )}
                      >
                        Step {i + 1}
                        {step.title ? ` — ${step.title}` : ""}
                      </p>
                      <div className="mt-1 text-sm leading-relaxed text-text-primary">
                        <MathText text={step.description} />
                      </div>
                    </div>
                  </div>

                  {/* Per-step chat thread */}
                  {stepMessages.length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-border-light pt-3">
                      {stepMessages.map((msg, j) => (
                        <ChatBubble key={j} message={msg} />
                      ))}
                    </div>
                  )}

                  {/* Per-step ask input — only on the most recent step */}
                  {isCurrent && (
                    <div className="mt-4 border-t border-border-light pt-3">
                      <AskInput
                        placeholder="Ask a question about this step…"
                        value={activeStepIndex === i ? chatInput : ""}
                        onChange={(v) => {
                          setActiveStepIndex(i);
                          setChatInput(v);
                        }}
                        onAsk={() => handleAsk(i)}
                        loading={asking && activeStepIndex === i}
                      />
                      {asking && activeStepIndex === i && (
                        <div className="mt-2"><TypingIndicator /></div>
                      )}
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Next-step advance OR final-answer + return-to-answer */}
      {!isLastRevealed ? (
        <Button
          variant="primary"
          onClick={() => setRevealedCount((c) => c + 1)}
          className="w-full py-3 text-base"
        >
          I understand — show next step →
        </Button>
      ) : (
        <>
          {data.final_answer && (
            <Card
              variant="elevated"
              className="border-success-border bg-success-light"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-success">
                Answer
              </p>
              <div className="mt-1 text-lg font-bold text-text-primary">
                <MathText text={data.final_answer} />
              </div>
            </Card>
          )}

          {/* Post-walkthrough chat — same thread, no step_index */}
          {messages.filter((m) => m.step_index === null).length > 0 && (
            <div className="space-y-2">
              {messages
                .filter((m) => m.step_index === null)
                .map((msg, i) => (
                  <ChatBubble key={i} message={msg} />
                ))}
              {asking && activeStepIndex === null && (
                <TypingIndicator />
              )}
            </div>
          )}
          <AskInput
            placeholder="Ask a question about the whole problem…"
            value={activeStepIndex === null ? chatInput : ""}
            onChange={(v) => {
              setActiveStepIndex(null);
              setChatInput(v);
            }}
            onAsk={() => handleAsk(null)}
            loading={asking && activeStepIndex === null}
          />

          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={onReturnToAnswer}
              className="flex-1 py-3"
            >
              Now try answering it →
            </Button>
            <Button variant="ghost" onClick={onSkip}>
              Skip
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: ProblemChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[--radius-md] bg-primary-bg px-3 py-2 text-sm text-primary">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-[--radius-md] border border-primary/15 bg-surface px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
        Tutor
      </p>
      <div className="mt-1 text-sm leading-relaxed text-text-primary">
        <MathText text={message.content} />
      </div>
    </div>
  );
}

function AskInput({
  placeholder,
  value,
  onChange,
  onAsk,
  loading,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onAsk: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && value.trim()) {
            e.preventDefault();
            onAsk();
          }
        }}
        disabled={loading}
        className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-3 py-2 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={onAsk}
        loading={loading}
        disabled={!value.trim()}
      >
        Ask
      </Button>
    </div>
  );
}
