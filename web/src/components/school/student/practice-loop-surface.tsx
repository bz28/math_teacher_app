"use client";

import { useState } from "react";
import { schoolStudent, type VariationPayload } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

export interface LoopResult {
  consumption_id: string;
  variation: VariationPayload;
  picked: string;
  correct: boolean;
  flagged: boolean;
}

interface Props {
  assignmentId: string;
  anchorBankItemId: string;
  problemPosition: number;
  initial: { variation: VariationPayload; consumption_id: string; remaining: number };
  /** Called when the loop ends (exhausted, or student tapped Done).
   *  Receives the per-variation results so the parent can show a
   *  practice summary with flag/learn-flagged state. */
  onDone: (results: LoopResult[]) => void;
  /** Called when the student wants to leave the loop without finishing. */
  onExit: () => void;
}

/**
 * The in-loop Practice surface for school students. Wraps the MCQ
 * answer interaction (string equality, no LLM) and the per-variation
 * flag button. Footer "Practice similar (next)" pulls the next sibling
 * via the same anchor — never the current variation id — so the
 * loop is structurally non-recursive.
 */
export function PracticeLoopSurface({
  assignmentId,
  anchorBankItemId,
  problemPosition,
  initial,
  onDone,
  onExit,
}: Props) {
  const [variation, setVariation] = useState<VariationPayload>(initial.variation);
  const [consumptionId, setConsumptionId] = useState<string>(initial.consumption_id);
  const [remaining, setRemaining] = useState<number>(initial.remaining);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<LoopResult[]>([]);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correctAnswer = (variation.final_answer || "").trim();

  // Build the option set: shuffle the correct answer in with the
  // teacher-pre-stored distractors. Stable ordering per render via
  // the variation id as a key in the parent.
  const choices: string[] = (() => {
    const out = [correctAnswer, ...(variation.distractors || [])].filter(Boolean);
    return out;
  })();

  function handlePick(choice: string) {
    if (revealed) return;
    setPicked(choice);
    setRevealed(true);
  }

  async function pushResultAndAdvance(nextAction: "next" | "done") {
    if (!picked) return;
    const result: LoopResult = {
      consumption_id: consumptionId,
      variation,
      picked,
      correct: picked.trim() === correctAnswer,
      flagged: false, // toggled separately via flag button
    };
    const allResults = [...results, result];
    setResults(allResults);

    // Mark current consumption complete
    try {
      await schoolStudent.completeConsumption(consumptionId);
    } catch {
      /* non-fatal */
    }

    if (nextAction === "done") {
      onDone(allResults);
      return;
    }

    // Pull next variation
    setAdvancing(true);
    setError(null);
    try {
      const resp = await schoolStudent.nextVariation(assignmentId, anchorBankItemId, "practice");
      if (resp.status === "served") {
        setVariation(resp.variation);
        setConsumptionId(resp.consumption_id);
        setRemaining(resp.remaining);
        setPicked(null);
        setRevealed(false);
      } else {
        // Exhausted or empty → done
        onDone(allResults);
      }
    } catch {
      setError("Couldn't load the next problem. Try again.");
    } finally {
      setAdvancing(false);
    }
  }

  async function toggleFlag() {
    // Flag toggles persist on the in-flight consumption row directly.
    // We track a local "this row is currently flagged" by re-fetching
    // would be overkill — flip the latest result entry too if present.
    const wasFlagged = results.find((r) => r.consumption_id === consumptionId)?.flagged ?? false;
    const next = !wasFlagged;
    try {
      await schoolStudent.flagConsumption(consumptionId, next);
      setResults((rs) =>
        rs.some((r) => r.consumption_id === consumptionId)
          ? rs.map((r) => (r.consumption_id === consumptionId ? { ...r, flagged: next } : r))
          : rs,
      );
    } catch {
      /* non-fatal */
    }
  }

  const currentFlagged =
    results.find((r) => r.consumption_id === consumptionId)?.flagged ?? false;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary"
        >
          ← Back to homework
        </button>
        <span className="text-xs font-medium text-text-muted">
          Practicing similar to problem {problemPosition}
        </span>
      </div>

      <div className="mt-6 rounded-[--radius-md] border border-border bg-surface p-6">
        <div className="text-base text-text-primary">
          <MathText text={variation.question} />
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {choices.map((choice, i) => {
            const isPicked = picked === choice;
            const isCorrect = revealed && choice.trim() === correctAnswer;
            const isWrongPick = revealed && isPicked && !isCorrect;
            return (
              <button
                key={`${i}-${choice}`}
                onClick={() => handlePick(choice)}
                disabled={revealed}
                className={cn(
                  "flex items-center gap-3 rounded-[--radius-md] border px-4 py-3 text-left transition-colors",
                  !revealed && "border-border bg-surface hover:border-primary",
                  isCorrect && "border-green-500 bg-green-50 dark:bg-green-500/10",
                  isWrongPick && "border-error bg-error-light text-error",
                  revealed && !isPicked && !isCorrect && "border-border bg-surface opacity-60",
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">
                  <MathText text={choice} />
                </span>
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className="mt-4 text-sm font-medium">
            {picked && picked.trim() === correctAnswer ? (
              <span className="text-green-600">Nice — that&apos;s correct.</span>
            ) : (
              <span className="text-error">
                Not quite. The correct answer was{" "}
                <span className="font-bold">
                  <MathText text={correctAnswer} />
                </span>
                .
              </span>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={toggleFlag}
          disabled={!revealed}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[--radius-sm] border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
            currentFlagged
              ? "border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-500/10"
              : "border-border text-text-secondary hover:border-amber-500 hover:text-amber-600",
          )}
          title={currentFlagged ? "Flagged for review" : "Flag this for review"}
        >
          {currentFlagged ? "★ Flagged" : "☆ Flag for review"}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">{remaining} more available</span>
          <button
            onClick={() => pushResultAndAdvance("done")}
            disabled={!revealed || advancing}
            className="rounded-[--radius-sm] border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50"
          >
            Done practicing
          </button>
          <button
            onClick={() => pushResultAndAdvance("next")}
            disabled={!revealed || advancing}
            className="rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {advancing ? "Loading…" : "Practice similar"}
          </button>
        </div>
      </div>
    </div>
  );
}
