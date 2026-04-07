"use client";

import { useEffect, useMemo, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { teacher, type BankItem } from "@/lib/api";
import { ClickToEditText } from "@/components/school/shared/click-to-edit-text";
import { useAsyncAction } from "@/components/school/shared/use-async-action";

type ResolvedAction = "approved" | "rejected" | "skipped";

/**
 * Focused single-question review mode. Walks the teacher through the
 * pending queue captured at open time. Approve/Reject hits the API and
 * advances; Skip leaves the question pending and advances.
 *
 * Inline edit mode is for quick fixes (typos, wording, small math
 * corrections). Click "Edit" to swap the question / each step / final
 * answer into click-to-edit mode in place — no second modal opens. For
 * deeper AI-assisted edits, the teacher skips and uses the workshop
 * modal from the bank list.
 *
 * The queue is a frozen snapshot — questions added to the bank after
 * open time don't enter this session. New "review pending" launches
 * pick them up.
 */
export function ReviewModeModal({
  initialQueue,
  onClose,
  onChanged,
}: {
  initialQueue: BankItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  // Mutable queue — manual edits update the item in place so the same
  // session sees the new content. Status changes (approve/reject) live
  // in `resolved`, not the queue itself.
  const [queue, setQueue] = useState<BankItem[]>(initialQueue);
  // Per-index resolved action ("approved" | "rejected" | "skipped" | undefined)
  const [resolved, setResolved] = useState<Record<number, ResolvedAction>>({});
  const [index, setIndex] = useState(0);
  const [solutionOpen, setSolutionOpen] = useState(false);
  // Inline edit mode for the current question. Reset to false when the
  // teacher advances or closes.
  const [editing, setEditing] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();

  const current = queue[index];
  const total = queue.length;
  const counts = useMemo(() => {
    const out = { approved: 0, rejected: 0, skipped: 0 };
    for (const r of Object.values(resolved)) out[r]++;
    return out;
  }, [resolved]);

  const allResolved = Object.keys(resolved).length >= total;

  const advance = () => {
    setEditing(false);
    // Move to the next unresolved index, wrapping if needed.
    for (let step = 1; step <= total; step++) {
      const next = (index + step) % total;
      if (!resolved[next]) {
        setIndex(next);
        return;
      }
    }
    // Nothing unresolved left — fall through to completion screen
    setIndex(index);
  };

  const markAndAdvance = (action: ResolvedAction) => {
    setResolved((prev) => ({ ...prev, [index]: action }));
    advance();
  };

  const approve = () =>
    run(async () => {
      if (!current || editing) return;
      await teacher.approveBankItem(current.id);
      markAndAdvance("approved");
      onChanged();
    });

  const reject = () =>
    run(async () => {
      if (!current || editing) return;
      await teacher.rejectBankItem(current.id);
      markAndAdvance("rejected");
      onChanged();
    });

  const skip = () => {
    setError(null);
    if (!current || editing) return;
    markAndAdvance("skipped");
  };

  // Replace the queue entry at the given index with an updated item.
  // Used after each click-to-edit save so the same review session shows
  // the latest content.
  const updateCurrent = (next: BankItem) => {
    setQueue((prev) => prev.map((q, i) => (i === index ? next : q)));
    onChanged();
  };

  const saveQuestion = (nextText: string) =>
    run(async () => {
      if (!current) return;
      const trimmed = nextText.trim();
      if (!trimmed || trimmed === current.question) return;
      const updated = await teacher.updateBankItem(current.id, { question: trimmed });
      updateCurrent(updated);
    });

  const saveStep = (idx: number, field: "title" | "description", nextText: string) =>
    run(async () => {
      if (!current?.solution_steps) return;
      const updatedSteps = current.solution_steps.map((s, i) =>
        i === idx ? { ...s, [field]: nextText } : s,
      );
      const updated = await teacher.updateBankItem(current.id, {
        solution_steps: updatedSteps,
      });
      updateCurrent(updated);
    });

  const saveFinalAnswer = (nextText: string) =>
    run(async () => {
      if (!current) return;
      if (nextText === (current.final_answer ?? "")) return;
      const updated = await teacher.updateBankItem(current.id, { final_answer: nextText });
      updateCurrent(updated);
    });

  // Keyboard shortcuts. Disabled while editing or busy or done.
  useEffect(() => {
    if (editing || allResolved) return;
    const handler = (e: KeyboardEvent) => {
      if (busy) return;
      // Ignore shortcuts when typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Enter" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        approve();
      } else if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        reject();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        skip();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setEditing(true);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSolutionOpen((v) => !v);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, allResolved, busy, index, current?.id]);

  // Empty queue — close immediately.
  if (total === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-[--radius-xl] bg-surface p-8 text-center shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-text-muted">
            Nothing to review — generate questions or approve from the list.
          </p>
          <button
            onClick={onClose}
            className="mt-4 rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // Completion screen.
  if (allResolved) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-[--radius-xl] bg-surface p-8 text-center shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-5xl">🎉</div>
          <h2 className="mt-3 text-lg font-bold text-text-primary">All caught up</h2>
          <p className="mt-1 text-sm text-text-muted">
            You reviewed {total} question{total === 1 ? "" : "s"}
          </p>
          <div className="mt-4 flex justify-center gap-4 text-sm">
            <span className="font-semibold text-green-700 dark:text-green-400">
              ✓ {counts.approved} approved
            </span>
            <span className="font-semibold text-red-700 dark:text-red-400">
              ✕ {counts.rejected} rejected
            </span>
            {counts.skipped > 0 && (
              <span className="font-semibold text-text-muted">⏭ {counts.skipped} skipped</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="mt-6 rounded-[--radius-md] bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-primary-dark"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const resolvedCount = Object.keys(resolved).length;
  const progressPct = (resolvedCount / total) * 100;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <div
          className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold text-text-primary">Reviewing pending</h2>
              <span className="text-xs font-semibold text-text-muted">
                {resolvedCount + 1} / {total}
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-bg-subtle">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {/* Question card */}
            <div
              className={`rounded-[--radius-lg] border p-5 shadow-sm transition-colors ${
                editing
                  ? "border-primary bg-primary-bg/20"
                  : "border-border-light bg-surface"
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted">
                <span>Question {editing && "· editing"}</span>
                <span className="rounded-[--radius-pill] bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-500/10">
                  pending
                </span>
              </div>
              <div className="mt-3 text-base text-text-primary">
                {editing ? (
                  <ClickToEditText
                    value={current.question}
                    multiline
                    onSave={saveQuestion}
                    busy={busy}
                  />
                ) : (
                  <MathText text={current.question} />
                )}
              </div>
            </div>

            {/* Solution toggle (auto-expands while editing) */}
            <button
              type="button"
              onClick={() => setSolutionOpen(!solutionOpen)}
              className="mt-5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
            >
              <span>{solutionOpen || editing ? "▾" : "▸"}</span>
              {solutionOpen || editing ? "Hide" : "Show"} solution
              {current.solution_steps && ` (${current.solution_steps.length} steps)`}
            </button>

            {(solutionOpen || editing) && (
              <div className="mt-3 space-y-2">
                {current.solution_steps && current.solution_steps.length > 0 ? (
                  current.solution_steps.map((s, i) => (
                    <div
                      key={i}
                      className={`rounded-[--radius-md] border p-3 ${
                        editing
                          ? "border-primary/40 bg-primary-bg/10"
                          : "border-border-light bg-bg-subtle"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="font-semibold text-text-primary">
                            {editing ? (
                              <ClickToEditText
                                value={s.title}
                                inline
                                onSave={(next) => saveStep(i, "title", next)}
                                busy={busy}
                              />
                            ) : (
                              <MathText text={s.title} />
                            )}
                          </div>
                          <div className="mt-1 text-text-secondary">
                            {editing ? (
                              <ClickToEditText
                                value={s.description}
                                multiline
                                onSave={(next) => saveStep(i, "description", next)}
                                busy={busy}
                              />
                            ) : (
                              <MathText text={s.description} />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs italic text-text-muted">No solution steps recorded.</p>
                )}
                {(current.final_answer || editing) && (
                  <div
                    className={`rounded-[--radius-md] border p-3 text-xs ${
                      editing
                        ? "border-primary/40 bg-primary-bg/10"
                        : "border-primary/30 bg-primary-bg/30"
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                      Final answer:
                    </span>{" "}
                    <span className="font-semibold text-text-primary">
                      {editing ? (
                        <ClickToEditText
                          value={current.final_answer ?? ""}
                          inline
                          onSave={saveFinalAnswer}
                          busy={busy}
                        />
                      ) : (
                        <MathText text={current.final_answer ?? ""} />
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Source + constraint footer (hidden in edit mode to keep focus) */}
            {!editing && (
              <div className="mt-5 space-y-1 border-t border-border-light pt-3 text-[11px] text-text-muted">
                {current.source_doc_ids && current.source_doc_ids.length > 0 && (
                  <div>
                    <span className="font-bold uppercase tracking-wider">Source:</span>{" "}
                    {current.source_doc_ids.length} document
                    {current.source_doc_ids.length === 1 ? "" : "s"}
                  </div>
                )}
                {current.generation_prompt && (
                  <div>
                    <span className="font-bold uppercase tracking-wider">Constraint:</span>{" "}
                    &ldquo;{current.generation_prompt}&rdquo;
                  </div>
                )}
              </div>
            )}

            {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
          </div>

          {/* Actions */}
          <div className="border-t border-border-light px-6 py-3">
            {editing ? (
              <>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={busy}
                    className="rounded-[--radius-md] bg-primary px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    ✓ Done editing
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-text-muted">
                  Click any text above to edit. Need AI help instead?
                  Skip this question and open it from the bank list — the workshop has chat.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={reject}
                    disabled={busy}
                    className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    ✕ Reject
                  </button>
                  <button
                    onClick={skip}
                    disabled={busy}
                    className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => setEditing(true)}
                    disabled={busy}
                    className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                  >
                    ✏ Edit
                  </button>
                  <button
                    onClick={approve}
                    disabled={busy}
                    className="ml-auto rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    ✓ Approve
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-text-muted">
                  ↵ approve · X reject · S skip · E edit · ↑ toggle solution · Esc close
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
