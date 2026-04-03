"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MathText } from "@/components/shared/math-text";
import { Button, Card, AnimatedCounter } from "@/components/ui";
import { DiagnosisTeaser } from "@/components/ui/diagnosis-teaser";
import { cn } from "@/lib/utils";
import type { PracticeBatch } from "@/stores/practice";
import type { Subject } from "@/stores/learn";
import { FREE_DAILY_SESSION_LIMIT } from "@/lib/constants";

interface PracticeSummaryProps {
  practiceBatch: PracticeBatch;
  subject: Subject;
  sessionsRemaining: number;
  onToggleFlag: (index: number) => void;
  onStartLearnQueue: (problems: string[]) => Promise<void>;
  onRetryFlagged: (subject: Subject) => Promise<void>;
  onUpgradeNeeded: (entitlement: string, message: string) => void;
  onReset: () => void;
}

export function PracticeSummary({
  practiceBatch,
  subject,
  sessionsRemaining,
  onToggleFlag,
  onStartLearnQueue,
  onRetryFlagged,
  onUpgradeNeeded,
  onReset,
}: PracticeSummaryProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { results, flags, workSubmissions } = practiceBatch;
  const correct = results.filter((r) => r.isCorrect).length;
  const flagged = flags.filter(Boolean).length;
  const percentage = Math.round((correct / results.length) * 100);
  const encouragement =
    percentage === 100
      ? "Perfect score!"
      : percentage >= 80
        ? "Great job!"
        : percentage >= 50
          ? "Good effort, keep practicing!"
          : "Keep going, you'll get there!";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-text-primary">Results</h1>
      </motion.div>

      {/* Score card */}
      <Card variant="elevated" className="text-center space-y-3">
        <p className="text-4xl font-extrabold text-primary">
          <AnimatedCounter to={correct} />/{results.length}
        </p>
        <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-border-light">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-sm font-medium text-text-secondary">
          {encouragement}
        </p>
      </Card>

      {/* Per-result breakdown */}
      <div className="space-y-2">
        {results.map((result, i) => {
          const wasCorrect = result.isCorrect;
          return (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 rounded-[--radius-md] border px-4 py-3",
                wasCorrect ? "border-success-border bg-success-light" : "border-error-border bg-error-light",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                  wasCorrect ? "bg-success" : "bg-error",
                )}
              >
                {wasCorrect ? "\u2713" : "\u2717"}
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="text-sm font-medium text-text-primary"><MathText text={result.problem} /></div>
                <p className="text-xs text-text-secondary">
                  {result.userAnswer === "(skipped)" ? "Skipped" : `Your answer: ${result.userAnswer}`}
                </p>
                <DiagnosisTeaser diagnosis={workSubmissions[i]} />
              </div>
              <button
                onClick={() => onToggleFlag(i)}
                className={cn(
                  "rounded-[--radius-pill] border px-3 py-1 text-xs font-semibold transition-colors flex-shrink-0",
                  flags[i]
                    ? "border-warning-dark/30 bg-warning-bg text-warning-dark"
                    : "border-border text-text-muted hover:border-warning-dark/30 hover:text-warning-dark",
                )}
              >
                {flags[i] ? "Flagged" : "Flag"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        {flagged > 0 && (
          <>
            <Button
              gradient
              loading={loading}
              onClick={async () => {
                setLoading(true);
                const flaggedProblems = results
                  .filter((_, i) => flags[i])
                  .map((r) => r.problem);
                await onStartLearnQueue(flaggedProblems);
                router.push("/learn/session");
              }}
              className="w-full"
            >
              Learn {flagged} Flagged Problem{flagged > 1 ? "s" : ""}
            </Button>
            <Button
              variant="secondary"
              loading={loading}
              onClick={async () => {
                if (sessionsRemaining < flagged) {
                  onUpgradeNeeded("create_session",
                    sessionsRemaining <= 0
                      ? `You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`
                      : `You only have ${sessionsRemaining} problem${sessionsRemaining !== 1 ? "s" : ""} remaining today, but this would use ${flagged}. Upgrade to Pro for unlimited access.`
                  );
                  return;
                }
                setLoading(true);
                await onRetryFlagged(subject);
              }}
              className="w-full"
            >
              Practice {flagged} Similar Problem{flagged > 1 ? "s" : ""}
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
