"use client";

import { useEffect, useMemo, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { teacher, type BankItem, type TeacherAssignment } from "@/lib/api";
import { DestinationPicker } from "./destination-picker";

type Resolution = "added" | "rejected" | "skipped";

/**
 * Full-screen review modal for fresh primary problems (Flow A in
 * plans/question-bank-redesign-v2.md).
 *
 * Walks the teacher through a queue of pending primary questions one
 * at a time. The action that approves a question is "Add to Homework"
 * — picking a destination is the act of approval. There is no plain
 * "Approve" button: every question must commit to a destination or be
 * rejected/skipped.
 *
 * Variation review (Flow B — children of an existing primary) lives in
 * a future commit and may share this shell with simpler buttons.
 */
export function ReviewModal({
  courseId,
  queue,
  onClose,
  onChanged,
  onEditItem,
}: {
  courseId: string;
  queue: BankItem[];
  onClose: () => void;
  // Bubble after every successful action so the parent can refetch
  // the bank list and counts.
  onChanged: () => void;
  // Edit opens the existing WorkshopModal on top — the parent owns
  // that surface so it can plug in chat, regenerate, etc.
  onEditItem: (item: BankItem) => void;
}) {
  // Captured-at-open queue. New items generated mid-review don't
  // splice in — they show up in the pending tray for the next pass.
  const [items] = useState<BankItem[]>(() =>
    queue.filter((q) => !q.parent_question_id),
  );
  const [index, setIndex] = useState(0);
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [showSolution, setShowSolution] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current: BankItem | undefined = items[index];
  const total = items.length;
  const done = Object.keys(resolved).length;
  const isComplete = done >= total;

  const counts = useMemo(() => {
    const c = { added: 0, rejected: 0, skipped: 0 };
    for (const r of Object.values(resolved)) c[r]++;
    return c;
  }, [resolved]);

  const advance = () => {
    setShowSolution(false);
    setShowPicker(false);
    setError(null);
    setIndex((i) => i + 1);
  };

  const markResolved = (r: Resolution) => {
    if (!current) return;
    setResolved((prev) => ({ ...prev, [current.id]: r }));
  };

  // ── Actions ──

  const reject = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await teacher.rejectBankItem(current.id);
      markResolved("rejected");
      onChanged();
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    if (!current || busy) return;
    markResolved("skipped");
    advance();
  };

  // Atomic approve + attach. The backend `/approve` endpoint takes
  // an optional `assignment_id` and does both in one transaction.
  const addToExisting = async (assignment: TeacherAssignment) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await teacher.approveBankItem(current.id, { assignmentId: assignment.id });
      markResolved("added");
      onChanged();
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to homework");
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async (title: string) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await teacher.approveBankItem(current.id);
      await teacher.createAssignment(courseId, {
        title,
        type: "homework",
        bank_item_ids: [current.id],
      });
      markResolved("added");
      onChanged();
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create homework");
    } finally {
      setBusy(false);
    }
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showPicker || busy || isComplete || !current) return;
      // Don't fire on inputs (the destination picker has its own).
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setShowPicker(true);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        reject();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        skip();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        onEditItem(current);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setShowSolution((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, showPicker, busy, isComplete]);

  // ── Render ──

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <div>
            <h2 className="text-base font-bold text-text-primary">
              {isComplete ? "All caught up" : "Reviewing pending questions"}
            </h2>
            {!isComplete && current && (
              <p className="mt-0.5 text-xs text-text-muted">
                {index + 1} of {total}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        {!isComplete && total > 0 && (
          <div className="h-1 w-full bg-bg-subtle">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isComplete ? (
            <CompletionState
              total={total}
              counts={counts}
              onClose={onClose}
            />
          ) : current ? (
            <CurrentQuestion
              item={current}
              showSolution={showSolution}
              onToggleSolution={() => setShowSolution((v) => !v)}
            />
          ) : (
            <p className="text-sm text-text-muted">No pending questions.</p>
          )}
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        {!isComplete && current && (
          <div className="border-t border-border-light px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowPicker((v) => !v)}
                  className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  → Add to Homework
                </button>
                {showPicker && (
                  <DestinationPicker
                    courseId={courseId}
                    onClose={() => setShowPicker(false)}
                    onPickExisting={addToExisting}
                    onCreateNew={createAndAdd}
                  />
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onEditItem(current)}
                className="rounded-[--radius-md] border border-border-light px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={skip}
                className="rounded-[--radius-md] border border-border-light px-3 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
              >
                Skip
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={busy}
                onClick={reject}
                className="rounded-[--radius-md] border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                ✕ Reject
              </button>
            </div>
            <p className="mt-3 text-[11px] text-text-muted">
              <kbd className="rounded border border-border-light px-1">H</kbd> homework ·
              <kbd className="ml-1 rounded border border-border-light px-1">E</kbd> edit ·
              <kbd className="ml-1 rounded border border-border-light px-1">S</kbd> skip ·
              <kbd className="ml-1 rounded border border-border-light px-1">R</kbd> reject ·
              <kbd className="ml-1 rounded border border-border-light px-1">↑</kbd> solution
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CurrentQuestion({
  item,
  showSolution,
  onToggleSolution,
}: {
  item: BankItem;
  showSolution: boolean;
  onToggleSolution: () => void;
}) {
  return (
    <div>
      <div className="rounded-[--radius-lg] border border-border-light bg-bg-base p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-wider text-text-muted">
            {item.title}
          </div>
          <span className="rounded-[--radius-pill] bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
            {item.difficulty} · pending
          </span>
        </div>
        <div className="mt-3 text-base leading-relaxed text-text-primary">
          <MathText text={item.question} />
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleSolution}
        className="mt-4 flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary"
      >
        <span>{showSolution ? "▾" : "▸"}</span>
        <span>
          {showSolution ? "Hide" : "Show"} solution
          {item.solution_steps?.length
            ? ` (${item.solution_steps.length} step${item.solution_steps.length === 1 ? "" : "s"})`
            : ""}
        </span>
      </button>

      {showSolution && (
        <div className="mt-2 space-y-2 rounded-[--radius-md] border border-border-light bg-bg-subtle p-4">
          {item.solution_steps?.map((step, i) => (
            <div key={i}>
              <div className="text-xs font-bold text-text-secondary">
                Step {i + 1}: {step.title}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                <MathText text={step.description} />
              </div>
            </div>
          ))}
          {item.final_answer && (
            <div className="mt-3 border-t border-border-light pt-2">
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Final answer
              </div>
              <div className="mt-1 text-sm text-text-primary">
                <MathText text={item.final_answer} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompletionState({
  total,
  counts,
  onClose,
}: {
  total: number;
  counts: { added: number; rejected: number; skipped: number };
  onClose: () => void;
}) {
  return (
    <div className="py-8 text-center">
      <div className="text-5xl">🎉</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">All caught up</h3>
      <p className="mt-1 text-sm text-text-muted">
        You reviewed {total} question{total === 1 ? "" : "s"}.
      </p>
      <div className="mt-4 flex justify-center gap-6 text-sm">
        <div>
          <div className="text-2xl font-bold text-green-600">{counts.added}</div>
          <div className="text-xs text-text-muted">added to homework</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-red-600">{counts.rejected}</div>
          <div className="text-xs text-text-muted">rejected</div>
        </div>
        {counts.skipped > 0 && (
          <div>
            <div className="text-2xl font-bold text-text-muted">{counts.skipped}</div>
            <div className="text-xs text-text-muted">skipped</div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-6 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
      >
        Done
      </button>
    </div>
  );
}

