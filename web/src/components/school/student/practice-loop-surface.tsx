"use client";

import { useMemo, useState } from "react";
import { schoolStudent, type VariationPayload } from "@/lib/api";
import { MCQCard } from "@/components/shared/mcq-card";
import { AnchorBanner } from "./_pieces/anchor-banner";
import { cn } from "@/lib/utils";

/**
 * Deterministic shuffle seeded by a string. Same seed → same order,
 * so the MCQ choices don't reshuffle on every render but DO differ
 * across look-alikes. Without this the correct answer would always
 * be option A and kids would spot the pattern instantly.
 */
function shuffleStable<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface LoopState {
  variation: VariationPayload;
  consumption_id: string;
  remaining: number;
}

interface PracticeLoopSurfaceProps {
  assignmentId: string;
  anchorBankItemId: string;
  anchorQuestion: string;
  problemPosition: number;
  initial: LoopState;
  /** Student taps "Back to homework" on the completion screen. */
  onDone: () => void;
  /** Student taps "Learn this problem" on the post-reveal completion
   *  screen — parent mints a Learn-context consumption for the SAME
   *  variation the student just answered. */
  onLearnThis: (state: LoopState) => void;
}

/**
 * School-student Practice surface. Shows a single MCQ per variation;
 * after the student picks, the post-answer completion panel offers
 * three pivots: Learn this problem (primary), Practice another
 * similar, or Back to homework.
 *
 * No in-loop Practice/Learn mode toggle — the plan moved to making the
 * completion screen the single pivot point so students finish one
 * lens cleanly before switching.
 */
export function PracticeLoopSurface({
  assignmentId,
  anchorBankItemId,
  anchorQuestion,
  problemPosition,
  initial,
  onDone,
  onLearnThis,
}: PracticeLoopSurfaceProps) {
  const [variation, setVariation] = useState<VariationPayload>(initial.variation);
  const [consumptionId, setConsumptionId] = useState<string>(initial.consumption_id);
  const [remaining, setRemaining] = useState<number>(initial.remaining);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [flagged, setFlagged] = useState(false);
  // One flag covers every terminal action on the completion screen
  // (practice-another, learn-this, back-to-homework). Prevents a
  // double-click from firing two completeConsumption calls or two
  // learn-this rows while the pivot is in flight.
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correctAnswer = (variation.final_answer || "").trim();

  const choices = useMemo(() => {
    const raw = [correctAnswer, ...(variation.distractors || [])]
      .map((s) => (s || "").trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const c of raw) {
      if (!seen.has(c)) {
        seen.add(c);
        deduped.push(c);
      }
    }
    return shuffleStable(deduped, variation.bank_item_id);
  }, [variation.bank_item_id, correctAnswer, variation.distractors]);

  function handlePick(choice: string) {
    if (revealed) return;
    setPicked(choice);
    setRevealed(true);
  }

  async function practiceAnother() {
    if (advancing) return;
    setAdvancing(true);
    setError(null);
    try {
      await schoolStudent.completeConsumption(consumptionId);
      const resp = await schoolStudent.nextVariation(
        assignmentId,
        anchorBankItemId,
        "practice",
      );
      if (resp.status === "served") {
        setVariation(resp.variation);
        setConsumptionId(resp.consumption_id);
        setRemaining(resp.remaining);
        setPicked(null);
        setRevealed(false);
        setFlagged(false);
      } else {
        onDone();
      }
    } catch {
      setError("Couldn't load the next problem. Try again.");
    } finally {
      setAdvancing(false);
    }
  }

  async function backToHomework() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await schoolStudent.completeConsumption(consumptionId);
    } catch {
      /* non-fatal */
    }
    onDone();
  }

  async function learnThisProblem() {
    if (advancing) return;
    setAdvancing(true);
    // Complete the current Practice attempt first — it's a distinct
    // mode-attempt and should be marked finished in the history.
    try {
      await schoolStudent.completeConsumption(consumptionId);
    } catch {
      /* non-fatal */
    }
    // Parent handles the pivot (calls /learn-this to mint a fresh
    // BankConsumption row with context='learn' on the same variation).
    onLearnThis({ variation, consumption_id: consumptionId, remaining });
  }

  async function toggleFlag() {
    if (!picked) return;
    const next = !flagged;
    // Optimistic: reflect locally so the button responds instantly.
    // Revert on failure so the client state matches the server.
    setFlagged(next);
    try {
      await schoolStudent.flagConsumption(consumptionId, next);
    } catch {
      setFlagged(!next);
    }
  }

  const selectedChoiceIndex = picked === null ? null : choices.indexOf(picked);
  const feedback: "correct" | "wrong" | null = !revealed
    ? null
    : picked && picked.trim() === correctAnswer
      ? "correct"
      : "wrong";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <button
          onClick={backToHomework}
          disabled={advancing}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary disabled:opacity-50"
        >
          ← Back to homework
        </button>
        <span className="text-xs font-medium text-text-muted">
          {remaining} more available
        </span>
      </div>

      <AnchorBanner position={problemPosition} question={anchorQuestion} />

      {choices.length < 2 ? (
        // Defensive fallback: a variation whose distractors weren't
        // generated (LLM failure → stored as null) would otherwise
        // render a single button and trap the student. Surface the
        // problem clearly and let them move on.
        <div className="rounded-[--radius-md] border border-amber-500 bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-500/10">
          This practice problem doesn&apos;t have multiple-choice options yet.
          Try the next one.
        </div>
      ) : (
        <MCQCard
          question={variation.question}
          choices={choices}
          selectedChoiceIndex={selectedChoiceIndex}
          feedback={feedback}
          onSelectChoice={handlePick}
          disableChoices={revealed}
          correctAnswer={correctAnswer}
        />
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      {revealed && (
        <div className="rounded-[--radius-md] border border-border bg-surface p-5">
          <p className="text-sm font-semibold text-text-primary">
            You practiced 1 problem ·{" "}
            <span
              className={cn(
                feedback === "correct" ? "text-success" : "text-error",
              )}
            >
              {feedback === "correct" ? "✓ correct" : "✗ incorrect"}
            </span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={learnThisProblem}
              disabled={advancing}
              className="rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              Learn this problem
            </button>
            <button
              onClick={practiceAnother}
              disabled={advancing || remaining <= 0}
              className="rounded-[--radius-sm] border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50"
              title={remaining <= 0 ? "No more similar problems left" : ""}
            >
              {advancing ? "Loading…" : "Practice another similar"}
            </button>
            <button
              onClick={backToHomework}
              disabled={advancing}
              className="rounded-[--radius-sm] border border-border px-4 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50"
            >
              Back to homework
            </button>
            <button
              onClick={toggleFlag}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-[--radius-sm] border px-3 py-1.5 text-sm font-medium transition-colors",
                flagged
                  ? "border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-500/10"
                  : "border-border text-text-secondary hover:border-amber-500 hover:text-amber-600",
              )}
              title={flagged ? "Flagged for review" : "Flag this for review"}
            >
              {flagged ? "★ Flagged" : "☆ Flag"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
