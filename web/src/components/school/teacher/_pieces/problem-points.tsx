"use client";

import { useState } from "react";
import type { HomeworkPoints } from "@/lib/api";
import { MAX_TOTAL_POINTS } from "@/lib/points";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";

/** What the teacher asked to change: a new even total, or every
 *  problem's points by hand. Mirrors the PATCH body. */
export type PointsChange =
  | { total_points: number }
  | { problem_points: Record<string, number> };

const numberInputClass =
  "w-14 rounded-[--radius-sm] border border-border-light bg-bg-base px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-text-primary focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60";

/**
 * A whole-number box that commits on blur or Enter and snaps back on
 * Escape. `validate` returns an error to show (and the box reverts), or
 * null to commit.
 */
export function PointsInput({
  value,
  label,
  onCommit,
  validate,
  disabled,
  className = "",
}: {
  value: number;
  label: string;
  onCommit: (n: number) => void;
  validate: (n: number) => string | null;
  disabled?: boolean;
  className?: string;
}) {
  // null = show `value`; a string = the teacher is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    const n = Number(raw);
    if (!raw || !Number.isInteger(n)) {
      setError("Use a whole number.");
      return;
    }
    if (n === value) {
      setError(null);
      return;
    }
    const problem = validate(n);
    setError(problem);
    if (!problem) onCommit(n);
  };

  return (
    <span className="inline-flex flex-col items-end">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={draft ?? String(value)}
        disabled={disabled}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
        className={`${numberInputClass} ${error ? "border-[color:var(--color-error)]" : ""} ${className}`}
      />
      {error && (
        <span role="alert" className="mt-1 max-w-[14rem] text-right text-[11px] text-[color:var(--color-error)]">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * The top of "Problems & grading": the homework's total, how it's split,
 * and a way back to an even split once problems were set by hand.
 */
export function PointsTotalBar({
  points,
  problemCount,
  isPublished,
  saveState,
  saveError,
  onChange,
}: {
  points: HomeworkPoints;
  problemCount: number;
  isPublished: boolean;
  saveState: SaveState;
  saveError: string | null;
  onChange: (change: PointsChange) => void;
}) {
  return (
    <div
      id="homework-points"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[--radius-md] border border-border-light bg-bg-subtle/40 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          Worth
          <PointsInput
            value={points.total}
            label="Total points for this homework"
            onCommit={(n) => onChange({ total_points: n })}
            validate={(n) =>
              n < problemCount
                ? `At least ${problemCount}: every problem is worth a point or more.`
                : n > MAX_TOTAL_POINTS
                  ? `At most ${MAX_TOTAL_POINTS} points.`
                  : null
            }
          />
          points
        </label>
        <span className="text-xs text-text-muted">
          {points.custom
            ? "set problem by problem"
            : `split evenly across ${problemCount} problem${problemCount === 1 ? "" : "s"}`}
        </span>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      {points.custom && (
        <button
          type="button"
          onClick={() => onChange({ total_points: points.total })}
          className="min-h-9 rounded-[--radius-md] px-2 text-xs font-semibold text-primary hover:bg-primary-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Split {points.total} evenly
        </button>
      )}
      {isPublished && (
        <p className="basis-full text-[11px] text-text-muted">
          Grades already given are re-added with the new points. Students
          see the change when you republish.
        </p>
      )}
    </div>
  );
}
