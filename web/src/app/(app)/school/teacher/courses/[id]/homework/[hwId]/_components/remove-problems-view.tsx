"use client";

import { useState } from "react";
import { MathText } from "@/components/shared/math-text";
import type { AssignmentProblem } from "../_lib/types";

// ── Remove problems sub-view ──
//
// Bulk-select UI for taking problems off a HW without going into each
// one individually. Uncheck the cards you want to drop, save. Editing
// the content of a single problem (question text, solution, chat with
// AI) happens by clicking the problem card itself — not here.

export function RemoveProblemsView({
  problems,
  onCancel,
  onSave,
  busy,
}: {
  problems: AssignmentProblem[];
  onCancel: () => void;
  /** Called with the bank_item_ids the teacher wants to KEEP after
   *  the bulk remove. Parent's `saveProblems` writes that list as
   *  the new HW content. */
  onSave: (next: string[]) => void;
  busy: boolean;
}) {
  // Set of bank_item_ids currently marked for removal. Click × on a
  // row to add/remove from this set — nothing is committed until
  // Save. Cancel discards the marks and keeps the HW as-is.
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const kept = problems.filter((p) => !marked.has(p.bank_item_id));
  const wouldLeaveEmpty = kept.length === 0;
  const markCount = marked.size;

  const save = () => {
    if (markCount === 0) return;
    if (wouldLeaveEmpty) return;
    onSave(kept.map((p) => p.bank_item_id));
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Remove problems
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            Click × on a problem to mark it for removal. Nothing is removed
            until you Save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || markCount === 0 || wouldLeaveEmpty}
            title={
              wouldLeaveEmpty
                ? "Keep at least one problem — or delete the homework instead"
                : markCount === 0
                  ? "Click × on a problem to mark it for removal"
                  : `Remove ${markCount} problem${markCount === 1 ? "" : "s"}`
            }
            className="rounded-[--radius-md] bg-[color:var(--color-error)] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[color:var(--color-error)]/85 disabled:bg-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-600"
          >
            {busy
              ? "Saving…"
              : markCount === 0
                ? "Remove"
                : `Remove ${markCount}`}
          </button>
        </div>
      </div>

      {wouldLeaveEmpty && markCount > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-text-primary  dark:bg-[color:var(--color-warning)]/10">
          You&apos;ve marked every problem. Keep at least one, or{" "}
          <span className="font-semibold">delete the homework</span> instead if
          you want to start over.
        </p>
      )}

      <div className="mt-5 space-y-2">
        {problems.map((p) => {
          const isMarked = marked.has(p.bank_item_id);
          return (
            <RemovableProblemRow
              key={`${p.bank_item_id}-${p.position}`}
              problem={p}
              marked={isMarked}
              disabled={busy}
              onToggle={() => toggle(p.bank_item_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function RemovableProblemRow({
  problem,
  marked,
  disabled,
  onToggle,
}: {
  problem: AssignmentProblem;
  marked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[--radius-md] border px-4 py-3 transition-all ${
        marked
          ? "border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)]/60 opacity-60  dark:bg-[color:var(--color-error-light)]"
          : "border-border-light bg-surface"
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
          marked
            ? "bg-gray-400 dark:bg-gray-600"
            : "bg-gradient-to-br from-primary to-primary-dark"
        }`}
      >
        {problem.position}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`line-clamp-2 text-[15px] leading-snug text-text-primary ${
            marked ? "line-through" : ""
          }`}
        >
          <MathText text={problem.question} />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            {problem.difficulty}
          </span>
          {marked && (
            <span className="text-[10px] font-semibold text-[color:var(--color-error)] ">
              · marked for removal
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={marked ? "Undo remove" : "Mark for removal"}
        className={`shrink-0 rounded-full p-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
          marked
            ? "bg-surface text-primary hover:text-primary-dark"
            : "text-text-muted hover:bg-[color:var(--color-error-light)] hover:text-[color:var(--color-error)] dark:hover:bg-[color:var(--color-error-light)]"
        }`}
        title={marked ? "Undo" : "Mark for removal"}
      >
        {marked ? "Undo" : "✕"}
      </button>
    </div>
  );
}
