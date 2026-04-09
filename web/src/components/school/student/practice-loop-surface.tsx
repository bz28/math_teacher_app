"use client";

import { useMemo, useState } from "react";
import { schoolStudent, type VariationPayload } from "@/lib/api";
import { MCQCard } from "@/components/shared/mcq-card";
import { ProgressBar } from "@/components/shared/progress-bar";
import { cn } from "@/lib/utils";

/**
 * Deterministic shuffle seeded by a string. Same seed → same order,
 * so the MCQ choices don't reshuffle on every render but DO differ
 * across look-alikes. Without this the correct answer would always
 * be option A and kids would spot the pattern instantly.
 */
function shuffleStable<T>(arr: T[], seed: string): T[] {
  // Simple deterministic hash → mulberry32 PRNG
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

export interface LoopResult {
  consumption_id: string;
  variation: VariationPayload;
  picked: string;
  correct: boolean;
  flagged: boolean;
}

export interface LoopState {
  variation: VariationPayload;
  consumption_id: string;
  remaining: number;
}

interface Props {
  assignmentId: string;
  anchorBankItemId: string;
  problemPosition: number;
  initial: LoopState;
  /** Per-variation results live in the parent so they survive a
   *  Practice → Learn → Practice lens swap (which re-mounts this
   *  surface). The parent owns the array; we append via a callback. */
  results: LoopResult[];
  onAppendResult: (r: LoopResult) => void;
  onUpdateResult: (consumptionId: string, patch: Partial<LoopResult>) => void;
  /** Called when the loop ends (exhausted, or student tapped Done). */
  onDone: () => void;
  /** Called when the student wants to leave the loop without finishing. */
  onExit: () => void;
  /** Called when the student wants to switch to Learn mode on the
   *  *current* look-alike. The parent re-renders the Learn surface
   *  seeded with this state — no new sibling is fetched, no new
   *  consumption row is created. */
  onSwitchToLearn: (state: LoopState) => void;
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
  results,
  onAppendResult,
  onUpdateResult,
  onDone,
  onExit,
  onSwitchToLearn,
}: Props) {
  const [variation, setVariation] = useState<VariationPayload>(initial.variation);
  const [consumptionId, setConsumptionId] = useState<string>(initial.consumption_id);
  const [remaining, setRemaining] = useState<number>(initial.remaining);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correctAnswer = (variation.final_answer || "").trim();

  // Build the option set: correct answer + teacher-pre-stored
  // distractors, deterministically shuffled by the variation id so
  // the order is stable across re-renders but the correct answer
  // isn't always option A. Dedupe by trimmed value so a distractor
  // that happens to equal the correct answer doesn't render twice.
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

  async function pushResultAndAdvance(nextAction: "next" | "done") {
    // Allow advancing without an MCQ pick when the variation has no
    // valid distractors (broken-data fallback). In that case there's
    // no answer to record — just skip past it.
    const noMcq = choices.length < 2;
    if ((!picked && !noMcq) || advancing) return;
    // Set the in-flight flag *immediately* so a rapid double-tap on
    // the button can't race two parallel completeConsumption +
    // nextVariation pairs and create duplicate consumption rows.
    setAdvancing(true);

    // Only append a result row the first time this consumption is
    // resolved — guard against double-appends if the user double-taps
    // or if a lens swap re-mounts us with a result already recorded.
    // Skip the append entirely if there was no MCQ to answer.
    if (picked && !results.some((r) => r.consumption_id === consumptionId)) {
      onAppendResult({
        consumption_id: consumptionId,
        variation,
        picked,
        correct: picked.trim() === correctAnswer,
        flagged: false, // toggled separately via flag button
      });
    }

    // Mark current consumption complete
    try {
      await schoolStudent.completeConsumption(consumptionId);
    } catch {
      /* non-fatal */
    }

    if (nextAction === "done") {
      onDone();
      return;
    }

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
        onDone();
      }
    } catch {
      setError("Couldn't load the next problem. Try again.");
    } finally {
      setAdvancing(false);
    }
  }

  async function toggleFlag() {
    if (!picked) return; // shouldn't happen — button is gated on `revealed`
    const existing = results.find((r) => r.consumption_id === consumptionId);
    const next = !(existing?.flagged ?? false);
    try {
      await schoolStudent.flagConsumption(consumptionId, next);
      // If the kid flags before tapping "next", we don't yet have a
      // result row for this consumption. Append one now so the flag
      // is reflected in the eventual practice summary.
      if (!existing) {
        onAppendResult({
          consumption_id: consumptionId,
          variation,
          picked,
          correct: picked.trim() === correctAnswer,
          flagged: next,
        });
      } else {
        onUpdateResult(consumptionId, { flagged: next });
      }
    } catch {
      /* non-fatal */
    }
  }

  const currentFlagged =
    results.find((r) => r.consumption_id === consumptionId)?.flagged ?? false;

  // Adapt the school's (picked, revealed) state to the MCQCard's
  // (selectedChoice, feedback) shape. The school flow is one-shot:
  // disable choices as soon as something is picked, and reveal the
  // correct answer in the wrong-feedback box (vs personal's retry).
  const selectedChoice = picked === null ? null : choices.indexOf(picked);
  const feedback: "correct" | "wrong" | null = !revealed
    ? null
    : picked && picked.trim() === correctAnswer
      ? "correct"
      : "wrong";
  // Progress: how far through the approved sibling pool. (totalSeen / totalApproved)
  // We approximate from `remaining`: total = (results so far + 1) + remaining
  // because the current one is the "+1". This stays consistent across
  // refresh-safe re-serves and exhausted states.
  const totalApprox = results.length + 1 + remaining;
  const progress = totalApprox > 0
    ? Math.min(100, Math.round(((results.length + (revealed ? 1 : 0)) / totalApprox) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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

      {/* Mode toggle — swaps the lens on the *current* look-alike with
          no fetch, no new consumption row. The bottom footer's "next"
          buttons are what advance the pool. */}
      <div className="inline-flex rounded-[--radius-sm] border border-border bg-surface p-1">
        <button
          disabled
          className="rounded-[--radius-sm] bg-primary px-3 py-1 text-xs font-bold text-white"
        >
          Practice
        </button>
        <button
          onClick={() =>
            onSwitchToLearn({ variation, consumption_id: consumptionId, remaining })
          }
          className="rounded-[--radius-sm] px-3 py-1 text-xs font-bold text-text-secondary hover:text-primary"
        >
          Learn
        </button>
      </div>

      <ProgressBar value={progress} />

      {choices.length < 2 ? (
        // Defensive fallback: a variation whose distractors weren't
        // generated (LLM failure → stored as null) would otherwise
        // render a single button and trap the student. Surface the
        // problem clearly and let them advance via the footer.
        <div className="rounded-[--radius-md] border border-amber-500 bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-500/10">
          This practice problem doesn&apos;t have multiple-choice options yet. Try the
          next one or switch to Learn mode to see the worked solution.
        </div>
      ) : (
        <MCQCard
          question={variation.question}
          choices={choices}
          selectedChoice={selectedChoice}
          feedback={feedback}
          onSelectChoice={handlePick}
          // No inline advance — school uses external footer for next/done.
          disableChoices={revealed}
          correctAnswer={correctAnswer}
        />
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
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
            disabled={(!revealed && choices.length >= 2) || advancing}
            className="rounded-[--radius-sm] border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:border-primary hover:text-primary disabled:opacity-50"
          >
            Done practicing
          </button>
          <button
            onClick={() => pushResultAndAdvance("next")}
            disabled={(!revealed && choices.length >= 2) || advancing}
            className="rounded-[--radius-sm] bg-primary px-4 py-1.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {advancing ? "Loading…" : choices.length < 2 ? "Skip" : "Practice similar"}
          </button>
        </div>
      </div>
    </div>
  );
}
