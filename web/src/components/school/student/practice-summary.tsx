"use client";

import { useState } from "react";
import { schoolStudent, type FlaggedConsumption } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
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
    <div className="mx-auto max-w-2xl">
      <h2 className="text-xl font-bold text-text-primary">Practice summary</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Problem {problemPosition} · {correct} of {results.length} correct
      </p>

      <ul className="mt-6 space-y-2">
        {results.map((r, i) => (
          <li
            key={`${i}-${r.consumption_id}`}
            className="flex items-center justify-between gap-4 rounded-[--radius-sm] border border-border bg-surface p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-sm font-bold text-text-muted">{i + 1}.</span>
              <div className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                <MathText text={r.variation.question} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold">
              {r.flagged && <span className="text-amber-600">★ Flagged</span>}
              {r.correct ? (
                <span className="text-green-600">✓</span>
              ) : (
                <span className="text-error">✗</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button
          onClick={onBackToHomework}
          className="rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary"
        >
          Back to homework
        </button>
        {flagged > 0 && (
          <button
            onClick={startLearnFlagged}
            disabled={loading}
            className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading
              ? "Loading…"
              : `Learn ${flagged} flagged ${flagged === 1 ? "problem" : "problems"}`}
          </button>
        )}
      </div>
    </div>
  );
}
