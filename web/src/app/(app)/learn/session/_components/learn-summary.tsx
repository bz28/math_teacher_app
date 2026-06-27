"use client";

import { useState } from "react";
import { DifficultyPicker, type Difficulty } from "@/components/shared/difficulty-picker";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button, Card } from "@/components/ui";
import { CheckIcon } from "@/components/ui/icons";
import { CelebrationMedallion } from "@/components/shared/celebration-medallion";
import { useCelebrationReveal } from "@/components/shared/celebration-reveal";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/shared/math-text";
import { EntitlementError } from "@/lib/api";
import type { LearnQueue } from "@/stores/learn";

interface LearnSummaryProps {
  learnQueue: LearnQueue;
  onToggleFlag: (index: number) => void;
  onPracticeFlagged: (flagged: string[], difficulty: Difficulty) => Promise<void>;
  onReset: () => void;
}

export function LearnSummary({ learnQueue, onToggleFlag, onPracticeFlagged, onReset }: LearnSummaryProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("same");
  const { container, item } = useCelebrationReveal();
  const flaggedCount = learnQueue.flags.filter(Boolean).length;
  const reviewedCount = learnQueue.problems.length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={item} className="space-y-3 text-center">
          <CelebrationMedallion />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Session complete
          </p>
          <h1 className="font-serif text-[2.5rem] leading-[1.05] text-text-primary sm:text-[3rem]">
            Learning <span className="font-fraunces italic text-primary">complete.</span>
          </h1>
          <p className="mx-auto max-w-sm text-[15px] leading-relaxed text-text-secondary">
            You worked through {reviewedCount} problem{reviewedCount > 1 ? "s" : ""}, start to finish.
          </p>
        </motion.div>

        <motion.div variants={item}>
          <Card variant="elevated" className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
              Problems reviewed
            </p>
            <p className="mt-1 font-serif text-5xl text-primary">{reviewedCount}</p>
          </Card>
        </motion.div>
      </motion.div>

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
              loading={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  const flagged = learnQueue.problems.filter((_, i) => learnQueue.flags[i]);
                  await onPracticeFlagged(flagged, difficulty);
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
        {flaggedCount > 0 && (
          <button
            onClick={() => router.push("/review")}
            className="mt-1 text-center text-sm font-medium text-primary transition-colors hover:text-primary-light"
          >
            Review your weak spots &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
