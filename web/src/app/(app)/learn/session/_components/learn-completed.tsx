"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DifficultyPicker, type Difficulty } from "@/components/shared/difficulty-picker";
import { motion } from "framer-motion";
import { Button, Card } from "@/components/ui";
import { ChatBubbleIcon, FlagIcon } from "@/components/ui/icons";
import { CelebrationMedallion } from "@/components/shared/celebration-medallion";
import { useCelebrationReveal } from "@/components/shared/celebration-reveal";
import { cn } from "@/lib/utils";
import type { LearnQueue, Subject } from "@/stores/learn";
import { EntitlementError, type SessionResponse } from "@/lib/api";

interface LearnCompletedProps {
  session: SessionResponse;
  learnQueue: LearnQueue | null;
  subject: Subject;
  onContinueAsking: () => void;
  onToggleFlag: (index: number) => void;
  onAdvanceQueue: () => Promise<void>;
  onStartPractice: (problem: string, subject: Subject, difficulty?: Difficulty) => Promise<void>;
  onReset: () => void;
}

export function LearnCompleted({
  session,
  learnQueue,
  subject,
  onContinueAsking,
  onToggleFlag,
  onAdvanceQueue,
  onStartPractice,
  onReset,
}: LearnCompletedProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("same");
  const { container, item } = useCelebrationReveal();

  // Reflect the moment back: a fresh single solve reads as a finished
  // piece of work; mid-queue it's momentum toward the set.
  const isLastInQueue =
    learnQueue !== null && learnQueue.currentIndex >= learnQueue.problems.length - 1;
  const eyebrow = learnQueue
    ? `Problem ${learnQueue.currentIndex + 1} of ${learnQueue.problems.length}`
    : "Solved";
  const subline = learnQueue
    ? isLastInQueue
      ? "That's the last one. Let's see how it all came together."
      : "One down — keep the momentum going."
    : "You worked it all the way through. Ready to make it stick?";

  return (
    <motion.div variants={container} initial="hidden" animate="show">
      <Card variant="elevated" className="space-y-5 text-center">
        <motion.div variants={item}>
          <CelebrationMedallion />
        </motion.div>

        <motion.div variants={item} className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            {eyebrow}
          </p>
          <h2 className="font-serif text-[2.25rem] leading-[1.05] text-text-primary sm:text-[2.5rem]">
            Problem <span className="font-display-serif italic text-primary">solved.</span>
          </h2>
          <p className="mx-auto max-w-sm text-[15px] leading-relaxed text-text-secondary">
            {subline}
          </p>
        </motion.div>

        <motion.div variants={item} className="flex flex-col gap-2 pt-1">
          {learnQueue ? (
            <>
              <button
                onClick={onContinueAsking}
                className="flex w-full items-center justify-center gap-2 rounded-[--radius-md] border border-warning-dark/20 bg-warning-bg px-4 py-3 text-sm font-semibold text-warning-dark transition-colors hover:bg-warning-dark/10"
              >
                <ChatBubbleIcon className="h-4 w-4" />
                I still have questions
              </button>

              <button
                onClick={() => onToggleFlag(learnQueue.currentIndex)}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-[--radius-md] border px-4 py-3 text-sm font-semibold transition-colors",
                  learnQueue.flags[learnQueue.currentIndex]
                    ? "border-warning-dark/30 bg-warning-bg text-warning-dark"
                    : "border-border bg-surface text-text-muted hover:border-warning-dark/30 hover:text-warning-dark",
                )}
              >
                <FlagIcon className="h-4 w-4" filled={learnQueue.flags[learnQueue.currentIndex]} />
                {learnQueue.flags[learnQueue.currentIndex] ? "Flagged" : "Flag for Practice"}
              </button>

              <Button
                variant="secondary"
                onClick={onAdvanceQueue}
                className="w-full"
              >
                {learnQueue.currentIndex < learnQueue.problems.length - 1
                  ? "Next Problem"
                  : "View Results"}
              </Button>
            </>
          ) : (
            <>
              <DifficultyPicker value={difficulty} onChange={setDifficulty} />
              <Button
                loading={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    // onStartPractice returns after Phase 1 (practice_preview set); Phase 2 runs in background
                    await onStartPractice(session.problem, subject, difficulty);
                    router.push("/practice");
                  } catch (err) {
                    setLoading(false);
                    if (err instanceof EntitlementError) {
                      router.push("/pricing");
                    }
                  }
                }}
                className="w-full"
              >
                Try a practice problem
              </Button>

              <button
                onClick={onContinueAsking}
                className="flex w-full items-center justify-center gap-2 rounded-[--radius-md] border border-warning-dark/20 bg-warning-bg px-4 py-3 text-sm font-semibold text-warning-dark transition-colors hover:bg-warning-dark/10"
              >
                <ChatBubbleIcon className="h-4 w-4" />
                I still have questions
              </button>

              <Button
                variant="secondary"
                onClick={() => { onReset(); router.push("/learn"); }}
                className="w-full"
              >
                Learn New Problem
              </Button>

              <Button
                variant="secondary"
                onClick={() => { onReset(); router.push("/home"); }}
                className="w-full"
              >
                Return Home
              </Button>
            </>
          )}
        </motion.div>
      </Card>
    </motion.div>
  );
}
