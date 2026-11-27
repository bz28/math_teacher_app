"use client";

import { useId, useState } from "react";
import type { TeacherRubric } from "@/lib/api";
import { hasRubricText } from "@/lib/rubric";
import { MAX_TOTAL_POINTS } from "@/lib/points";
import { LATE_POLICY_OPTIONS } from "./assignment-wizard-steps";
import { GradingSetupCard } from "./grading-setup-card";
import { SelectableChip } from "./selectable-chip";

const LATE_SHORT: Record<string, string> = {
  none: "accept any time",
  penalty_per_day: "−10% per day",
  no_credit: "closed after due date",
};

/**
 * Grading folded into one line on the wizard's Problems step: what it's
 * worth, the late policy and whose rules grade it. Every default is what
 * most homeworks keep, so it reads as a summary with an Edit, and opens
 * into the full editor when the teacher wants it (or when the points are
 * invalid, so the problem is never hidden).
 */
export function WizardGradingLine({
  courseId,
  totalPointsText,
  onTotalPointsTextChange,
  pointsValid,
  latePolicy,
  onLatePolicyChange,
  rubric,
  onRubricChange,
  disabled,
}: {
  courseId: string;
  totalPointsText: string;
  onTotalPointsTextChange: (v: string) => void;
  pointsValid: boolean;
  latePolicy: string;
  onLatePolicyChange: (v: string) => void;
  rubric: TeacherRubric | null;
  onRubricChange: (patch: Partial<TeacherRubric>) => void;
  disabled: boolean;
}) {
  // Opens itself when the points are invalid and stays open until the
  // teacher presses Done: closing on the first valid keystroke would pull
  // the input out from under her mid-number ("5" of "50").
  const [open, setOpen] = useState(() => !pointsValid);
  if (!pointsValid && !open) setOpen(true);
  const panelId = useId();
  const rules = hasRubricText(rubric) ? "Class rules + yours" : "Class rules";
  const late = LATE_SHORT[latePolicy] ?? latePolicy;
  const points = pointsValid ? `${Number(totalPointsText.trim())} pts` : "points?";

  return (
    <div className="rounded-[--radius-md] border border-border-light bg-bg-subtle/40">
      <div className="flex items-center gap-3 px-4 py-2.5 text-xs">
        <span className="font-bold text-text-primary">Grading</span>
        <span className="min-w-0 flex-1 truncate text-text-secondary">
          {rules} · {points} · Late: {late}
        </span>
        {pointsValid && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            disabled={disabled}
            className="inline-flex min-h-8 items-center font-semibold text-primary hover:underline disabled:opacity-50"
          >
            {open ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {open && (
        <div id={panelId} className="space-y-4 border-t border-border-light px-4 py-4">
          <div>
            <label
              htmlFor="hw-total-points"
              className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary"
            >
              This homework is worth
              <input
                id="hw-total-points"
                type="text"
                inputMode="numeric"
                value={totalPointsText}
                onChange={(e) => onTotalPointsTextChange(e.target.value)}
                onFocus={(e) => e.target.select()}
                aria-invalid={!pointsValid || undefined}
                disabled={disabled}
                className={`w-16 rounded-[--radius-sm] border bg-bg-base px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-text-primary focus:border-primary focus:outline-none ${
                  pointsValid ? "border-border-light" : "border-[color:var(--color-error)]"
                }`}
              />
              points
            </label>
            <p className="mt-1 text-xs text-text-muted">
              {pointsValid
                ? "Split evenly across its problems. You can change any problem’s points once they’re made."
                : `A whole number from 1 to ${MAX_TOTAL_POINTS}.`}
            </p>
          </div>
          <div>
            <span className="block text-sm font-semibold text-text-primary">Late work</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {LATE_POLICY_OPTIONS.map((o) => (
                <SelectableChip
                  key={o.value}
                  label={o.label}
                  selected={latePolicy === o.value}
                  onToggle={() => onLatePolicyChange(o.value)}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
          <GradingSetupCard
            rubric={rubric}
            saveState="idle"
            saveError={null}
            onChange={onRubricChange}
            courseId={courseId}
            // Leaving for settings would discard this unsaved wizard — no
            // link out from inside it.
            linkToClassRubric={false}
          />
        </div>
      )}
    </div>
  );
}
