"use client";

import { useEffect, useMemo, useState, use } from "react";
import { useRouter } from "next/navigation";
import {
  schoolStudent,
  type SchoolHistoryDetail,
  type SchoolChatMessage,
} from "@/lib/api";
import { Card } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import {
  StepTimeline,
  type ChatMessage,
  type TimelineStep,
} from "@/components/shared/step-timeline";
import { ProblemChat } from "@/components/shared/problem-chat";
import { AnchorBanner } from "@/components/school/student/_pieces/anchor-banner";
import { SkeletonStep } from "@/components/ui/skeleton";

/**
 * History detail — re-open a past Learn attempt for review. Renders
 * the same step timeline the student walked (now all collapsed for
 * scanning) plus per-step and whole-problem chat panels. No new
 * BankConsumption row is created; the existing row IS the archive.
 *
 * Re-opening doesn't re-consume: the detail page is read-only in the
 * sense that it doesn't advance the loop or spawn new variations.
 * Chat, however, still hits the LLM — review questions are valid use
 * of the chat endpoints.
 */
export default function SchoolHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<SchoolHistoryDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chatByStep, setChatByStep] = useState<Record<number, ChatMessage[]>>({});
  const [problemChat, setProblemChat] = useState<ChatMessage[]>([]);
  const [thinkingStepIndex, setThinkingStepIndex] = useState<number | null>(null);
  const [problemChatThinking, setProblemChatThinking] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [practicing, setPracticing] = useState(false);

  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);

  useEffect(() => {
    schoolStudent
      .historyDetail(id)
      .then(setDetail)
      .catch(() => setLoadError("Couldn't load this attempt."));
  }, [id]);

  const steps: TimelineStep[] = useMemo(() => {
    if (!detail) return [];
    const raw = detail.variation.solution_steps || [];
    return raw.map((s) => ({
      title: s.title,
      description: s.description ?? "",
    }));
  }, [detail]);

  function toggleExpand(i: number) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleStepChat(index: number, question: string) {
    if (!detail) return;
    const prior = chatByStep[index] ?? [];
    setChatByStep((prev) => ({
      ...prev,
      [index]: [...prior, { role: "user", content: question }],
    }));
    setThinkingStepIndex(index);
    try {
      const resp = await schoolStudent.stepChat(detail.variation.bank_item_id, {
        step_index: index,
        question,
        prior_messages: prior as SchoolChatMessage[],
      });
      setChatByStep((prev) => ({
        ...prev,
        [index]: [
          ...(prev[index] ?? []),
          { role: "assistant", content: resp.reply },
        ],
      }));
    } catch {
      /* inline error would add noise; swallow and let user retry */
    } finally {
      setThinkingStepIndex(null);
    }
  }

  async function handleProblemChat(question: string) {
    if (!detail) return;
    const prior = problemChat;
    setProblemChat([...prior, { role: "user", content: question }]);
    setProblemChatThinking(true);
    try {
      const resp = await schoolStudent.problemChat(detail.variation.bank_item_id, {
        question,
        prior_messages: prior as SchoolChatMessage[],
      });
      setProblemChat((curr) => [
        ...curr,
        { role: "assistant", content: resp.reply },
      ]);
    } catch {
      /* swallow */
    } finally {
      setProblemChatThinking(false);
    }
  }

  function startPracticeSimilar() {
    if (!detail || practicing) return;
    setPracticing(true);
    // The HW page handles the next-variation fetch + routing into the
    // Practice loop via its existing ?practice=<anchor_id> handler, so
    // we just navigate and unmount. Doing the fetch here would create
    // an orphaned consumption row the HW page then ignores.
    router.push(
      `/school/student/courses/${detail.course_id}/homework/${detail.assignment_id}?practice=${detail.anchor_bank_item_id}`,
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-error">{loadError}</p>
        <button
          onClick={() => router.push("/history")}
          className="mt-4 rounded-[--radius-sm] border border-border px-4 py-2 text-sm hover:border-primary"
        >
          Back to history
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SkeletonStep />
        <SkeletonStep />
        <SkeletonStep />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/history")}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
        >
          ← Back to history
        </button>
        <span className="text-xs font-medium text-text-muted">
          {detail.assignment_title}
        </span>
      </div>

      {detail.anchor_position > 0 && (
        <AnchorBanner
          position={detail.anchor_position}
          question={detail.anchor_question}
        />
      )}

      <Card variant="elevated">
        <p className="text-xs font-semibold text-text-muted">Problem</p>
        <div className="mt-1 text-base font-medium text-text-primary">
          <MathText text={detail.variation.question} />
        </div>
      </Card>

      {steps.length === 0 ? (
        <Card variant="flat" className="border-border-light">
          <p className="text-sm text-text-muted">
            No worked solution available for this attempt.
          </p>
        </Card>
      ) : (
        // currentStepIndex=-1 collapses every step as reviewable —
        // history is read-only, nothing to confirm. Callers expand
        // whichever step they want to re-read. onConfirmStep is a
        // no-op in this mode (the "I understand" button never renders
        // because no step is "active").
        <StepTimeline
          steps={steps}
          currentStepIndex={-1}
          chatByStep={chatByStep}
          onConfirmStep={() => {}}
          onAskStepQuestion={handleStepChat}
          thinkingStepIndex={thinkingStepIndex}
          finalAnswer={detail.variation.final_answer}
          expandControl={{ expandedSteps, onToggleExpand: toggleExpand }}
        />
      )}

      <div className="rounded-[--radius-md] border border-border bg-surface p-4">
        <ProblemChat
          title="Ask about this problem"
          messages={problemChat}
          onSend={handleProblemChat}
          thinking={problemChatThinking}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={startPracticeSimilar}
          disabled={practicing}
          className="rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {practicing ? "Loading…" : "Practice similar"}
        </button>
        <button
          onClick={() => router.push("/history")}
          className="rounded-[--radius-sm] border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary"
        >
          Back to history
        </button>
      </div>
    </div>
  );
}
