"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DifficultyPicker, type Difficulty } from "@/components/shared/difficulty-picker";
import { motion } from "framer-motion";
import { Button, Card } from "@/components/ui";
import { CheckIcon, ChatBubbleIcon, FlagIcon } from "@/components/ui/icons";
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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Card variant="elevated" className="space-y-4 text-center">
        {/* Checkmark */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <CheckIcon className="h-8 w-8 text-success" />
        </div>

        <h2 className="text-xl font-extrabold text-text-primary">
          Problem Solved!
        </h2>

        <div className="flex flex-col gap-2 pt-2">
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
                gradient
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
        </div>
      </Card>
    </motion.div>
  );
}
