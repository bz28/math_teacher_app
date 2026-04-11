"use client";

import { useState } from "react";
import { DifficultyPicker, type Difficulty } from "@/components/shared/difficulty-picker";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button, Card } from "@/components/ui";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/shared/math-text";
import type { LearnQueue } from "@/stores/learn";

interface LearnSummaryProps {
  learnQueue: LearnQueue;
  onToggleFlag: (index: number) => void;
  onPracticeFlagged: (flagged: string[], difficulty: string) => Promise<void>;
  onReset: () => void;
}

export function LearnSummary({ learnQueue, onToggleFlag, onPracticeFlagged, onReset }: LearnSummaryProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("same");
  const flaggedCount = learnQueue.flags.filter(Boolean).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-text-primary">Learning Complete</h1>
      </motion.div>

      <Card variant="elevated" className="text-center">
        <p className="text-sm text-text-muted">Problems Reviewed</p>
        <p className="text-4xl font-extrabold text-primary">{learnQueue.problems.length}</p>
      </Card>

      <div className="space-y-2">
        {learnQueue.problems.map((problem, i) => (
          <div key={i} className="flex items-center gap-3 rounded-[--radius-md] border border-success-border bg-success-light px-4 py-3">
            <CheckIcon className="h-5 w-5 flex-shrink-0 text-success" />
            <div className="flex-1 text-sm font-medium text-text-primary"><MathText text={problem} /></div>
            <button
              onClick={() => onToggleFlag(i)}
              className={cn(
                "rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors",
                learnQueue.flags[i]
                  ? "border-warning-dark/30 bg-warning-bg text-warning-dark"
                  : "border-border text-text-muted hover:border-warning-dark/30 hover:text-warning-dark",
              )}
            >
              {learnQueue.flags[i] ? "Flagged" : "Flag"}
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {flaggedCount > 0 && (
          <>
            <DifficultyPicker value={difficulty} onChange={setDifficulty} />
            <Button
              gradient
              loading={loading}
              onClick={async () => {
                setLoading(true);
                const flagged = learnQueue.problems.filter((_, i) => learnQueue.flags[i]);
                await onPracticeFlagged(flagged, difficulty);
                router.push("/practice");
              }}
              className="w-full"
            >
              Practice {flaggedCount} Similar Problem{flaggedCount > 1 ? "s" : ""}
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={() => { onReset(); router.push("/learn"); }} className="w-full">
          New Problem
        </Button>
        <Button variant="secondary" onClick={() => { onReset(); router.push("/home"); }} className="w-full">
          Return Home
        </Button>
      </div>
    </div>
  );
}
