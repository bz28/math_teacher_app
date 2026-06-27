"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MathText } from "@/components/shared/math-text";
import { Button, Card, AnimatedCounter } from "@/components/ui";
import { DiagnosisTeaser } from "@/components/ui/diagnosis-teaser";
import { CelebrationMedallion } from "@/components/shared/celebration-medallion";
import { useCelebrationReveal } from "@/components/shared/celebration-reveal";
import { cn } from "@/lib/utils";
import type { PracticeBatch } from "@/stores/practice";

interface PracticeSummaryProps {
  practiceBatch: PracticeBatch;
  onToggleFlag: (index: number) => void;
  onStartLearnQueue: (problems: string[]) => Promise<void>;
  onReset: () => void;
}

export function PracticeSummary({
  practiceBatch,
  onToggleFlag,
  onStartLearnQueue,
  onReset,
}: PracticeSummaryProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { container, item } = useCelebrationReveal();
  const { results, flags, workSubmissions } = practiceBatch;
  const correct = results.filter((r) => r.isCorrect).length;
  const flagged = flags.filter(Boolean).length;
  const percentage = Math.round((correct / results.length) * 100);

  // Headline + reflection earn their tone from how the set actually went.
  const headline =
    percentage === 100
      ? { lead: "A perfect ", emph: "round." }
      : percentage >= 80
        ? { lead: "Nicely ", emph: "done." }
        : percentage >= 50
          ? { lead: "Good ", emph: "work." }
          : { lead: "Keep ", emph: "going." };
  const reflection =
    percentage === 100
      ? `Every one correct — all ${results.length} landed.`
      : percentage >= 80
        ? `You solved ${correct} of ${results.length}. Strong round.`
        : percentage >= 50
          ? `${correct} of ${results.length} down — the misses are where the next gains are.`
          : `${correct} of ${results.length} this round. Every attempt sharpens the next.`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={item} className="space-y-3 text-center">
          <CelebrationMedallion />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Practice complete
          </p>
          <h1 className="font-serif text-[2.5rem] leading-[1.05] text-text-primary sm:text-[3rem]">
            {headline.lead}
            <span className="font-fraunces italic text-primary">{headline.emph}</span>
          </h1>
        </motion.div>

        {/* Score card */}
        <motion.div variants={item}>
          <Card variant="elevated" className="text-center space-y-3">
            <p className="font-serif text-5xl text-primary">
              <AnimatedCounter to={correct} />/{results.length}
            </p>
            <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-border-light">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="mx-auto max-w-sm text-[15px] leading-relaxed text-text-secondary">
              {reflection}
            </p>
          </Card>
        </motion.div>
      </motion.div>

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
                <div className="text-xs text-text-secondary">
                  {result.userAnswer === "(skipped)" ? "Skipped" : <span>Your answer: <MathText text={result.userAnswer} /></span>}
                </div>
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
              loading={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  const flaggedProblems = results
                    .filter((_, i) => flags[i])
                    .map((r) => r.problem);
                  await onStartLearnQueue(flaggedProblems);
                  router.push("/learn/session");
                } catch {
                  setLoading(false);
                }
              }}
              className="w-full"
            >
              Learn {flagged} Flagged Problem{flagged > 1 ? "s" : ""}
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={() => { onReset(); router.push("/learn"); }} className="w-full">
          New Problem
        </Button>
        <Button variant="secondary" onClick={() => { onReset(); router.push("/home"); }} className="w-full">
          Return Home
        </Button>
        {(correct < results.length || flagged > 0) && (
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
