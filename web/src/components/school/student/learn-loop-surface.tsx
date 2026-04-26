"use client";

import { useMemo, useRef, useState } from "react";
import { schoolStudent, type VariationPayload } from "@/lib/api";
import { Card } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import {
  StepTimeline,
  type TimelineChatMessage,
  type TimelineStep,
} from "@/components/shared/step-timeline";
import { ProblemChat } from "@/components/shared/problem-chat";
import { AnchorBanner } from "./_pieces/anchor-banner";
import type { LoopState } from "./practice-loop-surface";

interface LearnLoopSurfaceProps {
  assignmentId: string;
  anchorBankItemId: string;
  anchorQuestion: string;
  problemPosition: number;
  initial: LoopState;
  /** When the loop ends (exhausted, or student tapped Back to homework). */
  onDone: () => void;
  /** Student hit "Practice a similar one" on the completion screen.
   *  Parent mints a fresh Practice variation against the same anchor. */
  onPracticeSimilar: () => void;
  /** Optional explicit walk-list (used by "Learn N flagged" from the
   *  Practice summary — the default next-variation path would exhaust
   *  because all siblings are already in the consumption history). */
  queue?: LoopState[];
}

/**
 * School-student Learn surface. Walks through the variation's stored
 * solution_steps as a timeline (one page, all steps, current expanded).
 * Each step supports an inline chat via step-chat; after the final
 * step the student sees the completion screen with Practice-another /
 * Back-to-HW / Learn-another pivots and an overall problem chat.
 *
 * Zero LLM calls for the timeline — steps come from the bank. The only
 * LLM traffic is chat turns the student opts into.
 */
export function LearnLoopSurface({
  assignmentId,
  anchorBankItemId,
  anchorQuestion,
  problemPosition,
  initial,
  onDone,
  onPracticeSimilar,
  queue,
}: LearnLoopSurfaceProps) {
  const [variation, setVariation] = useState<VariationPayload>(initial.variation);
  const [consumptionId, setConsumptionId] = useState<string>(initial.consumption_id);
  const [remaining, setRemaining] = useState<number>(
    queue ? queue.length - 1 : initial.remaining,
  );
  const [queueIdx, setQueueIdx] = useState(0);

  // Per-step + problem-level chat lives here. It resets on variation
  // change — new variation, fresh conversation (per plan: no chat
  // persistence).
  const [stepIdx, setStepIdx] = useState(0);
  const [chatByStep, setChatByStep] = useState<Record<number, TimelineChatMessage[]>>({});
  const [problemChat, setProblemChat] = useState<TimelineChatMessage[]>([]);
  const [thinkingStepIndex, setThinkingStepIndex] = useState<number | null>(null);
  const [problemChatThinking, setProblemChatThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  // Bumped on every variation change. Chat handlers capture the value
  // at call time and drop the assistant reply if the variation has
  // moved on — prevents a stale response from leaking into the next
  // variation's chat state.
  const variationTokenRef = useRef(0);

  const steps: TimelineStep[] = useMemo(() => {
    const raw = variation.solution_steps || [];
    return raw.map((s) => ({
      title: s.title,
      description: s.description ?? "",
    }));
  }, [variation.solution_steps]);

  const completed = stepIdx >= steps.length;
  const onLastStep = stepIdx === steps.length - 1;

  function resetForNewVariation(v: VariationPayload, cid: string, rem: number) {
    variationTokenRef.current += 1;
    setVariation(v);
    setConsumptionId(cid);
    setRemaining(rem);
    setStepIdx(0);
    setChatByStep({});
    setProblemChat([]);
    setThinkingStepIndex(null);
    setProblemChatThinking(false);
    setError(null);
  }

  async function handleConfirmStep(index: number) {
    // Advance through steps. The last step's confirm is what transitions
    // to the "completed" state and shows the completion screen.
    if (index !== stepIdx) return;
    setStepIdx(index + 1);
  }

  async function handleStepChat(index: number, question: string) {
    setError(null);
    const prior = chatByStep[index] ?? [];
    const userMsg: TimelineChatMessage = { role: "user", content: question };
    setChatByStep((prev) => ({ ...prev, [index]: [...prior, userMsg] }));
    setThinkingStepIndex(index);
    const token = variationTokenRef.current;
    try {
      const chatReply = await schoolStudent.stepChat(variation.bank_item_id, {
        step_index: index,
        question,
        prior_messages: prior,
      });
      if (variationTokenRef.current !== token) return;
      setChatByStep((prev) => ({
        ...prev,
        [index]: [
          ...(prev[index] ?? []),
          { role: "assistant", content: chatReply.reply },
        ],
      }));
    } catch {
      if (variationTokenRef.current !== token) return;
      setError("Couldn't get a reply — try again in a moment.");
    } finally {
      if (variationTokenRef.current === token) setThinkingStepIndex(null);
    }
  }

  async function handleProblemChat(question: string) {
    setError(null);
    const prior = problemChat;
    const userMsg: TimelineChatMessage = { role: "user", content: question };
    setProblemChat([...prior, userMsg]);
    setProblemChatThinking(true);
    const token = variationTokenRef.current;
    try {
      const chatReply = await schoolStudent.problemChat(variation.bank_item_id, {
        question,
        prior_messages: prior,
      });
      if (variationTokenRef.current !== token) return;
      setProblemChat((curr) => [
        ...curr,
        { role: "assistant", content: chatReply.reply },
      ]);
    } catch {
      if (variationTokenRef.current !== token) return;
      setError("Couldn't get a reply — try again in a moment.");
    } finally {
      if (variationTokenRef.current === token) setProblemChatThinking(false);
    }
  }

  async function loadNextLearnVariation() {
    if (advancing) return;
    setAdvancing(true);
    setError(null);
    try {
      await schoolStudent.completeConsumption(consumptionId);
      if (queue) {
        const nextIdx = queueIdx + 1;
        const next = queue[nextIdx];
        if (!next) {
          onDone();
          return;
        }
        setQueueIdx(nextIdx);
        resetForNewVariation(
          next.variation,
          next.consumption_id,
          queue.length - nextIdx - 1,
        );
        return;
      }
      const resp = await schoolStudent.nextVariation(
        assignmentId,
        anchorBankItemId,
        "learn",
      );
      if (resp.status === "served") {
        resetForNewVariation(resp.variation, resp.consumption_id, resp.remaining);
      } else {
        onDone();
      }
    } catch {
      setError("Couldn't load the next problem. Try again.");
    } finally {
      setAdvancing(false);
    }
  }

  async function startPracticeSimilar() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await schoolStudent.completeConsumption(consumptionId);
    } catch {
      /* non-fatal */
    }
    onPracticeSimilar();
  }

  async function handleBackToHomework() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await schoolStudent.completeConsumption(consumptionId);
    } catch {
      /* non-fatal */
    }
    onDone();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Top nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBackToHomework}
          disabled={advancing}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary disabled:opacity-50"
        >
          ← Back to homework
        </button>
        <span className="text-xs font-medium text-text-muted">
          {remaining} more available
        </span>
      </div>

      <AnchorBanner position={problemPosition} question={anchorQuestion} />

      {/* Current variation question */}
      <Card variant="elevated">
        <p className="text-xs font-semibold text-text-muted">Problem</p>
        <div className="mt-1 text-base font-medium text-text-primary">
          <MathText text={variation.question} />
        </div>
      </Card>

      {steps.length === 0 ? (
        <Card variant="flat" className="border-border-light">
          <p className="text-sm text-text-muted">
            No worked solution available for this one.
          </p>
        </Card>
      ) : (
        <StepTimeline
          steps={steps}
          currentStepIndex={completed ? -1 : stepIdx}
          chatByStep={chatByStep}
          onConfirmStep={handleConfirmStep}
          onAskStepQuestion={handleStepChat}
          thinkingStepIndex={thinkingStepIndex}
          finalAnswer={completed ? variation.final_answer : null}
          confirmLabel={onLastStep ? "I'm done" : "I understand"}
        />
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      {completed && (
        <>
          <div className="rounded-[--radius-md] border border-border bg-surface p-5 text-center">
            <p className="text-lg font-semibold text-text-primary">
              ✓ You worked through this problem.
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Want to lock it in? Try the same style as a timed question.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={startPracticeSimilar}
                disabled={advancing}
                className="rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                Practice a similar one
              </button>
              <button
                onClick={handleBackToHomework}
                disabled={advancing}
                className="rounded-[--radius-sm] border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50"
              >
                Back to homework
              </button>
            </div>
            <button
              onClick={loadNextLearnVariation}
              disabled={advancing || remaining <= 0}
              className="mt-3 text-xs font-medium text-text-muted hover:text-primary disabled:opacity-50"
            >
              {advancing ? "Loading…" : "Learn another similar"}
            </button>
          </div>

          <div className="rounded-[--radius-md] border border-border bg-surface p-4">
            <ProblemChat
              title="Ask about this problem"
              messages={problemChat}
              onSend={handleProblemChat}
              thinking={problemChatThinking}
            />
          </div>
        </>
      )}
    </div>
  );
}
