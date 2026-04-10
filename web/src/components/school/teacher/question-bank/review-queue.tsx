"use client";

import { useCallback, useState } from "react";
import { teacher, type BankItem, type TeacherUnit } from "@/lib/api";
import { unitLabel as labelForUnit } from "@/lib/units";
import { MathText } from "@/components/shared/math-text";
import { DIFFICULTY_STYLE } from "./constants";
import { useAsyncAction } from "@/components/school/shared/use-async-action";

// Focused one-at-a-time review queue. Shows pending items in sequence,
// with Reject / Edit / Approve actions. Auto-advances after each
// action. Shows a completion screen when all items are reviewed.

export function ReviewQueue({
  queue,
  units,
  onBack,
  onChanged,
  onEditItem,
}: {
  queue: BankItem[];
  units: TeacherUnit[];
  /** Return to the approved table view. */
  onBack: () => void;
  onChanged: () => void;
  /** Open the WorkshopModal for editing. */
  onEditItem: (item: BankItem) => void;
}) {
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const { busy, error, run } = useAsyncAction();
  const total = queue.length;
  const current = queue[index];

  const advance = useCallback(() => {
    setIndex((i) => Math.min(i + 1, total));
  }, [total]);

  const handleApprove = () =>
    run(async () => {
      await teacher.approveBankItem(current.id);
      setReviewed((r) => r + 1);
      onChanged();
      advance();
    });

  const handleReject = () =>
    run(async () => {
      await teacher.rejectBankItem(current.id);
      setReviewed((r) => r + 1);
      onChanged();
      advance();
    });

  const handleSkip = () => {
    advance();
  };

  // All caught up
  if (index >= total) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[--radius-lg] border border-dashed border-border-light bg-bg-base/30 px-6 py-16 text-center">
        <div className="text-5xl" aria-hidden>
          &#127881;
        </div>
        <h3 className="mt-4 text-lg font-bold text-text-primary">
          All caught up!
        </h3>
        <p className="mt-2 text-sm text-text-muted">
          You reviewed {reviewed} of {total} item{total === 1 ? "" : "s"}.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
        >
          &#8592; Back to Question Bank
        </button>
      </div>
    );
  }

  const unitName = labelForUnit(units, current.unit_id);
  const diffStyle = DIFFICULTY_STYLE[current.difficulty];
  const progressPct = total > 0 ? Math.round((index / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-text-secondary hover:text-text-primary"
        >
          &#8592; Back to Question Bank
        </button>
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <span className="font-bold">
            {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={handleSkip}
            className="font-semibold text-text-secondary hover:text-text-primary"
          >
            Skip &#8594;
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Card */}
      <div className="overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface shadow-sm">
        {/* Metadata strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border-light bg-bg-subtle px-4 py-2 text-xs text-text-muted">
          {unitName && <span>&#128193; {unitName}</span>}
          {diffStyle && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${diffStyle.cls}`}
            >
              {diffStyle.label}
            </span>
          )}
          <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 font-semibold">
            {current.source === "practice" ? "Variation" : "Generated"}
          </span>
        </div>

        {/* Question */}
        <div className="px-6 py-5">
          <div className="text-base leading-relaxed text-text-primary">
            <MathText text={current.question} />
          </div>
        </div>

        {/* Solution steps */}
        {current.solution_steps && current.solution_steps.length > 0 && (
          <div className="border-t border-border-light px-6 py-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Solution Steps
            </div>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-text-secondary">
              {current.solution_steps.map((step, i) => (
                <li key={i}>
                  {step.title && (
                    <span className="font-semibold">{step.title}: </span>
                  )}
                  <MathText text={step.description} />
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Final answer */}
        {current.final_answer && (
          <div className="border-t border-border-light px-6 py-4">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Final Answer
            </div>
            <div className="text-sm font-semibold text-text-primary">
              <MathText text={current.final_answer} />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-4">
          <button
            type="button"
            onClick={handleReject}
            disabled={busy}
            className="rounded-[--radius-md] border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            Reject
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEditItem(current)}
              disabled={busy}
              className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-bold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="rounded-[--radius-md] bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
