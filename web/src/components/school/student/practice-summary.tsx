"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { schoolStudent, type FlaggedConsumption } from "@/lib/api";
import { AnimatedCounter, Button, Card } from "@/components/ui";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";
import { LearnLoopSurface } from "./learn-loop-surface";
import type { LoopResult, LoopState } from "./practice-loop-surface";

interface Props {
  assignmentId: string;
  anchorBankItemId: string;
  problemPosition: number;
  results: LoopResult[];
  onBackToHomework: () => void;
}

/**
 * End-of-practice summary for a school-student loop. Shows each
 * variation the student tried with ✓/✗, surfaces a "Learn N flagged"
 * CTA when any flagged rows exist (mirrors the personal flow), and
 * routes the student into the LearnLoopSurface seeded with the first
 * flagged variation. The Learn loop will then walk through the rest
 * via its own next-variation calls keyed off the same anchor.
 */
export function PracticeSummary({
  assignmentId,
  anchorBankItemId,
  problemPosition,
  results,
  onBackToHomework,
}: Props) {
  const [learnQueue, setLearnQueue] = useState<LoopState[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correct = results.filter((r) => r.correct).length;
  const flagged = results.filter((r) => r.flagged).length;
  const total = results.length;
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
  const encouragement =
    percentage === 100
      ? "Perfect score!"
      : percentage >= 80
        ? "Great job!"
        : percentage >= 50
          ? "Good effort, keep practicing!"
          : "Keep going, you'll get there!";

  async function startLearnFlagged() {
    setLoading(true);
    setError(null);
    try {
      const flaggedRows: FlaggedConsumption[] = await schoolStudent.flaggedConsumptions(
        assignmentId,
        anchorBankItemId,
      );
      if (flaggedRows.length === 0) {
        setError("No flagged problems to learn.");
        return;
      }
      // Build an explicit queue of every flagged variation. We hand
      // it to LearnLoopSurface so it walks through them locally
      // instead of calling next-variation — which would exhaust
      // immediately because all siblings are already in this
      // student's consumption history at this point.
      const queue: LoopState[] = flaggedRows.map((r, i) => ({
        variation: r.variation,
        consumption_id: r.consumption_id,
        remaining: flaggedRows.length - i - 1,
      }));
      setLearnQueue(queue);
    } catch {
      setError("Couldn't load your flagged problems. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (learnQueue) {
    return (
      <LearnLoopSurface
        assignmentId={assignmentId}
        anchorBankItemId={anchorBankItemId}
        problemPosition={problemPosition}
        initial={learnQueue[0]}
        queue={learnQueue}
        onDone={onBackToHomework}
        onExit={onBackToHomework}
        // From the practice summary's flagged-learn queue we don't
        // expose a back-to-Practice toggle — the kid is in a guided
        // review pass, the practice phase is over for this session.
        onSwitchToPractice={() => onBackToHomework()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-text-primary">Results</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Problem {problemPosition} · practice summary
        </p>
      </motion.div>

      {/* Score card — same shape as the personal practice summary so
          the visual feels like one app. */}
      <Card variant="elevated" className="space-y-3 text-center">
        <p className="text-4xl font-extrabold text-primary">
          <AnimatedCounter to={correct} />/{total}
        </p>
        <div className="mx-auto h-2 w-48 overflow-hidden rounded-full bg-border-light">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-sm font-medium text-text-secondary">{encouragement}</p>
      </Card>

      {/* Per-result breakdown */}
      <div className="space-y-2">
        {results.map((r, i) => (
          <div
            key={`${i}-${r.consumption_id}`}
            className={cn(
              "flex items-start gap-3 rounded-[--radius-md] border px-4 py-3",
              r.correct
                ? "border-success-border bg-success-light"
                : "border-error-border bg-error-light",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                r.correct ? "bg-success" : "bg-error",
              )}
            >
              {r.correct ? "\u2713" : "\u2717"}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-sm font-medium text-text-primary">
                <MathText text={r.variation.question} />
              </div>
              <div className="text-xs text-text-secondary">
                Your answer: <MathText text={r.picked} />
              </div>
            </div>
            {r.flagged && (
              <span className="rounded-[--radius-pill] border border-warning-dark/30 bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-dark">
                ★ Flagged
              </span>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex flex-col gap-2">
        {flagged > 0 && (
          <Button
            gradient
            loading={loading}
            onClick={startLearnFlagged}
            className="w-full"
          >
            Learn {flagged} Flagged Problem{flagged > 1 ? "s" : ""}
          </Button>
        )}
        <Button variant="secondary" onClick={onBackToHomework} className="w-full">
          Back to homework
        </Button>
      </div>
    </div>
  );
}
