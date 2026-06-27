"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { schoolStudent, type StudentPracticeProblem } from "@/lib/api";
import { Button, Card } from "@/components/ui";
import { CheckIcon } from "@/components/ui/icons";
import { useConfetti } from "@/components/ui/confetti";
import { FigureDisplay } from "@/components/shared/figure-display";
import { MathText } from "@/components/shared/math-text";
import { ProgressBar } from "@/components/shared/progress-bar";
import {
  StepTimeline,
  type ChatMessage,
  type TimelineStep,
} from "@/components/shared/step-timeline";
import { ProblemChat } from "@/components/shared/problem-chat";

interface Props {
  /** The practice set this walkthrough belongs to — used to record a
   *  completed problem's walkthrough to the activity log. */
  assignmentId: string;
  problems: StudentPracticeProblem[];
  /** Whether the set has MCQ problems — gates the "Practice this set"
   *  pivot so we never cross into an empty mode. */
  canPractice: boolean;
  /** Pivot to the Practice runner for this same set. */
  onPractice: () => void;
  /** Return to the course practice list. */
  onExit: () => void;
}

/**
 * Paced, one-step-at-a-time Learn walkthrough across a practice set.
 * The worked steps come straight from the teacher-authored bank item —
 * no LLM generation. The only model traffic is the tutor chat the
 * student opts into (per-step or whole-problem), reusing the shared
 * step-chat / problem-chat endpoints scoped to this bank item.
 */
export function LearnRunner({
  assignmentId,
  problems,
  canPractice,
  onPractice,
  onExit,
}: Props) {
  const [qIndex, setQIndex] = useState(0);
  const [done, setDone] = useState(false);

  // Records a finished walkthrough exactly once per problem. We log on
  // leaving the problem (it's only reachable post-completion) so the
  // tutor_message_count reflects the whole conversation, including any
  // chat the student had after working through the steps.
  const recordedRef = useRef<Set<string>>(new Set());

  // Always-current flush closure for the leave-handlers below. They're
  // registered once on mount, so their own closure is stale; this ref is
  // re-pointed every render so a flush records the CURRENT problem's
  // walkthrough with its CURRENT chat count.
  const flushRef = useRef<() => void>(() => {});

  // Per-problem walkthrough + chat state. Reset on problem change.
  const [stepIdx, setStepIdx] = useState(0);
  const [chatByStep, setChatByStep] = useState<Record<number, ChatMessage[]>>({});
  const [problemChat, setProblemChat] = useState<ChatMessage[]>([]);
  const [thinkingStep, setThinkingStep] = useState<number | null>(null);
  const [problemThinking, setProblemThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped on every problem change. Chat handlers capture it at call
  // time and drop a reply if the student has already moved on — keeps a
  // late response from leaking into the next problem's thread.
  const tokenRef = useRef(0);

  const problem = problems[qIndex];
  const steps: TimelineStep[] = useMemo(
    () =>
      (problem.solution_steps ?? []).map((s) => ({
        title: s.title,
        description: s.description ?? "",
        figure_svg: s.figure_svg ?? null,
      })),
    [problem.solution_steps],
  );

  const completed = stepIdx >= steps.length;
  const onLastStep = stepIdx === steps.length - 1;
  const isLastProblem = qIndex >= problems.length - 1;

  function resetForProblem() {
    tokenRef.current += 1;
    setStepIdx(0);
    setChatByStep({});
    setProblemChat([]);
    setThinkingStep(null);
    setProblemThinking(false);
    setError(null);
  }

  function confirmStep(index: number) {
    if (index !== stepIdx) return;
    setStepIdx(index + 1);
  }

  async function askStep(index: number, question: string) {
    setError(null);
    const prior = chatByStep[index] ?? [];
    setChatByStep((prev) => ({
      ...prev,
      [index]: [...prior, { role: "user", content: question }],
    }));
    setThinkingStep(index);
    const token = tokenRef.current;
    try {
      const { reply } = await schoolStudent.stepChat(problem.bank_item_id, {
        step_index: index,
        question,
        prior_messages: prior,
      });
      if (tokenRef.current !== token) return;
      setChatByStep((prev) => ({
        ...prev,
        [index]: [...(prev[index] ?? []), { role: "assistant", content: reply }],
      }));
    } catch {
      if (tokenRef.current !== token) return;
      setError("Couldn't reach the tutor just now — try again in a moment.");
    } finally {
      if (tokenRef.current === token) setThinkingStep(null);
    }
  }

  async function askProblem(question: string) {
    setError(null);
    const prior = problemChat;
    setProblemChat([...prior, { role: "user", content: question }]);
    setProblemThinking(true);
    const token = tokenRef.current;
    try {
      const { reply } = await schoolStudent.problemChat(problem.bank_item_id, {
        question,
        prior_messages: prior,
      });
      if (tokenRef.current !== token) return;
      setProblemChat((curr) => [...curr, { role: "assistant", content: reply }]);
    } catch {
      if (tokenRef.current !== token) return;
      setError("Couldn't reach the tutor just now — try again in a moment.");
    } finally {
      if (tokenRef.current === token) setProblemThinking(false);
    }
  }

  // Fire-and-forget: log this completed walkthrough with its tutor chat
  // volume (per-step questions + the whole-problem chat, both sides).
  // Practice is formative, so a failed write is swallowed.
  function recordCompletion() {
    const id = problem.bank_item_id;
    if (recordedRef.current.has(id)) return;
    recordedRef.current.add(id);
    const stepMsgs = Object.values(chatByStep).reduce(
      (n, msgs) => n + msgs.length,
      0,
    );
    schoolStudent
      .recordActivity(assignmentId, [
        {
          bank_item_id: id,
          mode: "learn",
          outcome: "completed",
          tutor_message_count: stepMsgs + problemChat.length,
        },
      ])
      .catch(() => {});
  }

  function nextProblem() {
    recordCompletion();
    if (isLastProblem) {
      setDone(true);
      return;
    }
    setQIndex((i) => i + 1);
    resetForProblem();
  }

  // Keep the flush closure pointed at the latest problem + chat state.
  // Only a *completed* walkthrough is loggable; recordCompletion's
  // recordedRef dedupe keeps a flush from double-recording against the
  // advance path (nextProblem) and vice-versa.
  useEffect(() => {
    flushRef.current = () => {
      if (completed) recordCompletion();
    };
  });

  // Close the recording gap: nextProblem logs a completed walkthrough on
  // advance, but a student who finishes then leaves WITHOUT advancing —
  // closes the tab, navigates away in the sidebar, hits browser-back,
  // backgrounds the app — would never be counted. Flush on unmount and
  // on visibilitychange→hidden (the latter catches mobile tab-close /
  // backgrounding that beforeunload misses).
  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  if (done) {
    return (
      <LearnFinale
        count={problems.length}
        canPractice={canPractice}
        onPractice={onPractice}
        onExit={onExit}
      />
    );
  }

  // Step progress: count confirmed steps; show full once the problem is done.
  const stepProgress = steps.length === 0 ? 100 : (Math.min(stepIdx, steps.length) / steps.length) * 100;

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div>
        <div className="flex items-end justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
            Problem {qIndex + 1}{" "}
            <span className="text-text-muted/60">of {problems.length}</span>
          </p>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
            {completed ? "Worked" : `Step ${Math.min(stepIdx + 1, steps.length)} of ${steps.length}`}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar value={stepProgress} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={qIndex}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="space-y-5"
        >
          {/* Problem statement — figure slot preserved above the question. */}
          <Card variant="elevated">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
              Problem
            </p>
            <FigureDisplay
              svg={problem.figure_svg}
              ariaLabel={`Figure for problem ${qIndex + 1}`}
            />
            <div className="mt-1 text-base font-medium text-text-primary">
              <MathText text={problem.question} />
            </div>
          </Card>

          {steps.length === 0 ? (
            <Card variant="flat" className="border-border-light">
              <p className="text-sm text-text-muted">
                No worked solution is available for this one yet.
              </p>
            </Card>
          ) : (
            <StepTimeline
              steps={steps}
              currentStepIndex={completed ? -1 : stepIdx}
              chatByStep={chatByStep}
              onConfirmStep={confirmStep}
              onAskStepQuestion={askStep}
              thinkingStepIndex={thinkingStep}
              finalAnswer={completed ? problem.final_answer : null}
              confirmLabel={onLastStep ? "I've got it" : "I understand"}
            />
          )}

          {error && <p className="text-sm text-error">{error}</p>}

          {/* Per-problem completion: whole-problem tutor chat + advance. */}
          {(completed || steps.length === 0) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <Card variant="flat" className="border-primary/15 bg-primary-bg/30">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success">
                    <CheckIcon className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                  You worked through this problem.
                </div>
              </Card>

              <Card variant="flat" className="border-border-light">
                <ProblemChat
                  title="Still curious? Ask the tutor about this problem"
                  messages={problemChat}
                  onSend={askProblem}
                  thinking={problemThinking}
                />
              </Card>

              <div className="flex justify-end">
                <Button onClick={nextProblem}>
                  {isLastProblem ? "Finish" : "Next problem"}
                </Button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function LearnFinale({
  count,
  canPractice,
  onPractice,
  onExit,
}: {
  count: number;
  canPractice: boolean;
  onPractice: () => void;
  onExit: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { fire } = useConfetti();

  // Quiet celebration — Learn is reflective, so a gentle (non-intense)
  // burst, skipped under reduced-motion.
  useEffect(() => {
    if (reduceMotion) return;
    const t = setTimeout(() => fire(false), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-7 text-center"
    >
      <div>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 18 }}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10"
        >
          <CheckIcon className="h-8 w-8 text-success" strokeWidth={2.5} />
        </motion.div>
        <p className="eyebrow mt-5">Walkthrough complete</p>
        <h2 className="mt-2 font-serif text-[2.5rem] leading-none text-primary">
          {count === 1 ? "You worked it through." : `All ${count}, worked through.`}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-secondary">
          {canPractice
            ? "You've seen every step. The fastest way to make it stick is to try the set yourself — no grade, just reps."
            : "You've seen every step. Come back any time to walk it through again."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {canPractice && (
          <Button onClick={onPractice} className="w-full">
            Practice this set
          </Button>
        )}
        <Button
          variant={canPractice ? "ghost" : "primary"}
          onClick={onExit}
          className="w-full"
        >
          Back to practice
        </Button>
      </div>
    </motion.div>
  );
}
