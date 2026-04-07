"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankChatMessage,
  type BankChatProposal,
  type BankItem,
  type TeacherUnit,
} from "@/lib/api";
import { ClickToEditText } from "@/components/school/shared/click-to-edit-text";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { STATUS_BADGE } from "./bank-styles";

/**
 * Unified workshop modal for editing a single question OR walking through
 * a queue of pending questions. The two modes share one component:
 *
 * - **Single mode** (queue prop omitted): opened by clicking a question
 *   in the bank list. Chat panel visible by default. Approve/Reject just
 *   update status; no advance.
 *
 * - **Queue mode** (queue prop provided): opened by "Review pending →".
 *   Header shows progress + counter. Footer adds Skip button. Approve/
 *   Reject advance to the next pending. Chat panel collapsed by default
 *   so the teacher can scan and decide fast.
 *
 * In both modes:
 * - Chat panel is toggleable via 💬 AI button (or C key)
 * - Click-to-edit on every text field
 * - Preview-before-commit for AI proposals
 * - One-level undo for 30s after any change
 * - All other actions gated while a proposal is pending
 */
export function WorkshopModal({
  item: initialItem,
  queue,
  onClose,
  onChanged,
}: {
  item?: BankItem;
  queue?: BankItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  // Queue state — only meaningful when `queue` is provided
  const isQueueMode = queue !== undefined && queue.length > 0;
  const [queueState, setQueueState] = useState<BankItem[]>(queue ?? []);
  const [resolved, setResolved] = useState<Record<number, "approved" | "rejected" | "skipped">>({});
  const [queueIndex, setQueueIndex] = useState(0);

  // The current item — either the explicit single-mode item or the
  // current queue position.
  const sourceItem: BankItem | undefined = isQueueMode ? queueState[queueIndex] : initialItem;

  const [liveItem, setLiveItem] = useState<BankItem | undefined>(sourceItem);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [editingUnit, setEditingUnit] = useState(false);
  const [showUndo, setShowUndo] = useState(sourceItem?.has_previous_version ?? false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClearChat, setConfirmingClearChat] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(false);
  // Chat starts open in single mode, collapsed in queue mode (the teacher
  // wanted scan-and-decide focus). Persists across queue items in the same
  // session.
  const [chatOpen, setChatOpen] = useState(!isQueueMode);
  const { busy, error, setError, run } = useAsyncAction();

  // ── Item sync ────────────────────────────────────────────────────
  // Reset liveItem whenever the source item identity changes (queue
  // advance or initial load) or a fresher version arrives from the
  // parent's reload. Safe from infinite loops because:
  //   - replaceLiveItem updates queueState[queueIndex] in place,
  //     which produces a new sourceItem with the same id and the same
  //     updated_at (we got it from the API response that produced the
  //     new liveItem). Same id + same timestamp → no setLiveItem call.
  //   - When the parent calls onChanged(), the bank list reloads but
  //     the queue snapshot is frozen, so the queue prop never changes
  //     mid-session.
  // The eslint-disable is intentional: we deliberately depend only on
  // the identity + timestamp of the source, not on liveItem itself
  // (which would loop).
  useEffect(() => {
    if (!sourceItem) return;
    if (!liveItem || sourceItem.id !== liveItem.id) {
      setLiveItem(sourceItem);
      setSolutionOpen(false);
      setConfirmingDelete(false);
      setConfirmingClearChat(false);
    } else if (new Date(sourceItem.updated_at).getTime() > new Date(liveItem.updated_at).getTime()) {
      setLiveItem(sourceItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceItem?.id, sourceItem?.updated_at]);

  // Undo affordance auto-hides after 30s
  useEffect(() => {
    if (liveItem?.has_previous_version) setShowUndo(true);
  }, [liveItem?.id, liveItem?.has_previous_version, liveItem?.updated_at]);
  useEffect(() => {
    if (!showUndo) return;
    const t = setTimeout(() => setShowUndo(false), 30000);
    return () => clearTimeout(t);
  }, [showUndo]);

  // ── Pending proposal derivation ──────────────────────────────────
  const pendingIdx = useMemo(() => {
    if (!liveItem) return -1;
    for (let i = liveItem.chat_messages.length - 1; i >= 0; i--) {
      const m = liveItem.chat_messages[i];
      if (m.role === "ai" && m.proposal && !m.accepted && !m.discarded && !m.superseded) {
        return i;
      }
    }
    return -1;
  }, [liveItem]);
  const pendingProposal: BankChatProposal | null =
    pendingIdx >= 0 && liveItem ? liveItem.chat_messages[pendingIdx].proposal! : null;
  const isProposalPending = pendingIdx >= 0;

  // Auto-open chat the moment a proposal lands so the teacher sees the
  // Accept/Discard immediately.
  useEffect(() => {
    if (isProposalPending) setChatOpen(true);
  }, [isProposalPending, pendingIdx]);

  // ── Queue traversal ──────────────────────────────────────────────
  const total = queueState.length;
  const counts = useMemo(() => {
    const out = { approved: 0, rejected: 0, skipped: 0 };
    for (const r of Object.values(resolved)) out[r]++;
    return out;
  }, [resolved]);
  const allResolved = isQueueMode && Object.keys(resolved).length >= total;

  const advanceQueue = () => {
    if (!isQueueMode) return;
    for (let step = 1; step <= total; step++) {
      const next = (queueIndex + step) % total;
      if (!resolved[next]) {
        setQueueIndex(next);
        return;
      }
    }
    // All resolved — fall through, allResolved branch will render the
    // completion screen on the next render
  };

  // Update the current queue item in place (used after manual edits and
  // chat actions so the same review session sees the latest content).
  const replaceLiveItem = (next: BankItem) => {
    setLiveItem(next);
    if (isQueueMode) {
      setQueueState((prev) => prev.map((q, i) => (i === queueIndex ? next : q)));
    }
    onChanged();
  };

  // ── Action handlers ──────────────────────────────────────────────
  const blockIfPending = (): boolean => {
    if (isProposalPending) {
      setError("Accept or discard the AI proposal before doing anything else.");
      return true;
    }
    if (liveItem?.locked) {
      setError("This question is in a published homework. Unpublish it to make changes.");
      return true;
    }
    return false;
  };
  const isLocked = liveItem?.locked ?? false;

  // Fetch units once per course so the header can show a unit picker.
  useEffect(() => {
    if (!liveItem) return;
    let cancelled = false;
    teacher
      .units(liveItem.course_id)
      .then((u) => {
        if (!cancelled) setUnits(u.units);
      })
      .catch(() => {
        /* non-fatal — picker just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [liveItem?.course_id]);

  const saveUnit = (nextUnitId: string | null) =>
    run(async () => {
      if (!liveItem || blockIfPending()) return;
      if (nextUnitId === liveItem.unit_id) {
        setEditingUnit(false);
        return;
      }
      const updated = await teacher.updateBankItem(
        liveItem.id,
        nextUnitId === null ? { clear_unit: true } : { unit_id: nextUnitId },
      );
      replaceLiveItem(updated);
      setEditingUnit(false);
    });

  const unitLabel = (() => {
    if (!liveItem?.unit_id) return "Uncategorized";
    const u = units.find((x) => x.id === liveItem.unit_id);
    if (!u) return "—";
    if (!u.parent_id) return u.name;
    const parent = units.find((x) => x.id === u.parent_id);
    return parent ? `${parent.name} / ${u.name}` : u.name;
  })();

  const saveQuestion = (next: string) =>
    run(async () => {
      if (!liveItem || blockIfPending()) return;
      const q = next.trim();
      if (!q || q === liveItem.question) return;
      const updated = await teacher.updateBankItem(liveItem.id, { question: q });
      replaceLiveItem(updated);
    });

  const saveStep = (idx: number, field: "title" | "description", next: string) =>
    run(async () => {
      if (!liveItem || blockIfPending()) return;
      if (!liveItem.solution_steps) return;
      const updated = liveItem.solution_steps.map((s, i) =>
        i === idx ? { ...s, [field]: next } : s,
      );
      const next_ = await teacher.updateBankItem(liveItem.id, { solution_steps: updated });
      replaceLiveItem(next_);
    });

  const saveFinalAnswer = (next: string) =>
    run(async () => {
      if (!liveItem || blockIfPending()) return;
      if (next === (liveItem.final_answer ?? "")) return;
      const updated = await teacher.updateBankItem(liveItem.id, { final_answer: next });
      replaceLiveItem(updated);
    });

  const sendChat = async (message: string): Promise<boolean> => {
    if (!liveItem) return false;
    if (liveItem.locked) {
      setError("Locked — unpublish the homework using this question first.");
      return false;
    }
    setError(null);
    let ok = false;
    await run(async () => {
      const next = await teacher.sendBankChat(liveItem.id, message);
      replaceLiveItem(next);
      ok = true;
    }, "Chat failed");
    return ok;
  };

  const acceptProposal = () =>
    run(async () => {
      if (!liveItem || pendingIdx < 0) return;
      const next = await teacher.acceptBankChatProposal(liveItem.id, pendingIdx);
      replaceLiveItem(next);
    });

  const discardProposal = () =>
    run(async () => {
      if (!liveItem || pendingIdx < 0) return;
      const next = await teacher.discardBankChatProposal(liveItem.id, pendingIdx);
      replaceLiveItem(next);
    });

  const clearChat = () =>
    run(async () => {
      if (!liveItem) return;
      const next = await teacher.clearBankChat(liveItem.id);
      replaceLiveItem(next);
      setConfirmingClearChat(false);
    });

  const undo = () =>
    run(async () => {
      if (!liveItem) return;
      const next = await teacher.revertBankItem(liveItem.id);
      replaceLiveItem(next);
      setShowUndo(false);
    });

  const approve = () =>
    run(async () => {
      if (!liveItem || blockIfPending()) return;
      await teacher.approveBankItem(liveItem.id);
      // Use replaceLiveItem so queueState stays consistent with liveItem.
      // Even though the stale entry isn't displayed today, keeping the two
      // stores in sync removes a footgun for any future reader of queueState.
      replaceLiveItem({ ...liveItem, status: "approved" });
      if (isQueueMode) {
        setResolved((prev) => ({ ...prev, [queueIndex]: "approved" }));
        advanceQueue();
      }
    });

  const reject = () =>
    run(async () => {
      if (!liveItem || blockIfPending()) return;
      await teacher.rejectBankItem(liveItem.id);
      replaceLiveItem({ ...liveItem, status: "rejected" });
      if (isQueueMode) {
        setResolved((prev) => ({ ...prev, [queueIndex]: "rejected" }));
        advanceQueue();
      }
    });

  const skip = () => {
    setError(null);
    if (!liveItem || blockIfPending() || !isQueueMode) return;
    setResolved((prev) => ({ ...prev, [queueIndex]: "skipped" }));
    advanceQueue();
  };

  const remove = () =>
    run(async () => {
      if (!liveItem) return;
      if (liveItem.locked) {
        setError("Locked — unpublish the homework using this question first.");
        return;
      }
      await teacher.deleteBankItem(liveItem.id);
      if (isQueueMode) {
        // Treat delete like a resolution and advance
        setResolved((prev) => ({ ...prev, [queueIndex]: "rejected" }));
        advanceQueue();
        setConfirmingDelete(false);
      } else {
        onClose();
      }
      onChanged();
    });

  // ── Keyboard shortcuts ───────────────────────────────────────────
  // The action handlers (approve/reject/skip) are recreated on every
  // render and capture their own closures over liveItem. We can't put
  // them in the effect's dep array without re-binding the listener on
  // every render, so we stash the latest copies in a ref the handler
  // reads at call time. This guarantees the keyboard handler always
  // sees the most recent liveItem state, even when liveItem updates
  // without an id change (e.g. after a manual edit or chat accept).
  const handlersRef = useRef({ approve, reject, skip });
  handlersRef.current = { approve, reject, skip };

  useEffect(() => {
    if (allResolved) return;
    const handler = (e: KeyboardEvent) => {
      if (busy) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Most action shortcuts are gated when a proposal is pending
      if (isProposalPending) return;

      if (e.key === "Enter" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        handlersRef.current.approve();
      } else if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        handlersRef.current.reject();
      } else if (e.key === "s" || e.key === "S") {
        if (isQueueMode) {
          e.preventDefault();
          handlersRef.current.skip();
        }
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setChatOpen((v) => !v);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSolutionOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [allResolved, busy, isProposalPending, isQueueMode, onClose]);

  // ── Render: empty queue or completion ────────────────────────────
  if (isQueueMode && total === 0) {
    return <EmptyQueueModal onClose={onClose} />;
  }
  if (allResolved) {
    return <CompletionModal counts={counts} total={total} onClose={onClose} />;
  }
  if (!liveItem) return null;

  // ── Preview computation ──────────────────────────────────────────
  const previewQuestion = pendingProposal?.question ?? liveItem.question;
  const previewSteps = pendingProposal?.solution_steps ?? liveItem.solution_steps;
  const previewAnswer = pendingProposal?.final_answer ?? liveItem.final_answer;
  const questionChanged = pendingProposal?.question != null;
  const stepsChanged = pendingProposal?.solution_steps != null;
  const answerChanged = pendingProposal?.final_answer != null;

  const resolvedCount = Object.keys(resolved).length;
  const progressPct = isQueueMode ? (resolvedCount / total) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-text-primary">Workshop</h2>
            {isQueueMode && (
              <span className="text-xs font-semibold text-text-muted">
                {resolvedCount + 1} / {total}
              </span>
            )}
            <span
              className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
                STATUS_BADGE[liveItem.status] ?? ""
              }`}
            >
              {liveItem.status}
            </span>
            {editingUnit && !isLocked ? (
              <select
                autoFocus
                value={liveItem.unit_id ?? ""}
                onChange={(e) => saveUnit(e.target.value || null)}
                onBlur={() => setEditingUnit(false)}
                disabled={busy}
                className="rounded-[--radius-md] border border-primary bg-bg-base px-2 py-0.5 text-xs text-text-primary focus:outline-none"
              >
                <option value="">Uncategorized</option>
                {units
                  .filter((u) => u.parent_id === null)
                  .flatMap((top) => [
                    <option key={top.id} value={top.id}>
                      {top.name}
                    </option>,
                    ...units
                      .filter((sub) => sub.parent_id === top.id)
                      .map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {top.name} / {sub.name}
                        </option>
                      )),
                  ])}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => !isLocked && setEditingUnit(true)}
                disabled={isLocked}
                title={isLocked ? "Unpublish to move" : "Click to move to a different unit"}
                className="text-xs font-semibold text-text-muted hover:text-primary disabled:cursor-not-allowed disabled:hover:text-text-muted"
              >
                📁 <span className="underline decoration-dotted underline-offset-2">{unitLabel}</span>
              </button>
            )}
            {showUndo && (
              <button
                onClick={undo}
                disabled={busy}
                className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
              >
                ↶ Undo last change
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
            title="Close (Esc)"
            aria-label="Close workshop"
          >
            ✕
          </button>
        </div>

        {/* Lock banner */}
        {isLocked && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            🔒 This question is in published homework
            {liveItem.used_in.length > 0 && ` (${liveItem.used_in.map((u) => u.title).join(", ")})`}
            . Unpublish it to make changes.
          </div>
        )}

        {/* Progress bar (queue mode only) */}
        {isQueueMode && (
          <div className="h-1 bg-bg-subtle">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Two-panel body */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* LEFT — artifact */}
          <div
            className={`flex-1 overflow-y-auto px-6 py-5 transition-all duration-200 ease-out ${
              chatOpen ? "md:border-r md:border-border-light" : ""
            }`}
          >
            {/* Question */}
            <div
              className={`rounded-[--radius-lg] border p-5 transition-colors ${
                questionChanged
                  ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                  : "border-border-light bg-surface"
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted">
                <span>Question</span>
                {questionChanged && (
                  <span className="text-blue-700 dark:text-blue-300">Preview</span>
                )}
              </div>
              <div className="mt-3 text-base leading-relaxed text-text-primary">
                {questionChanged || isProposalPending ? (
                  <MathText text={previewQuestion} />
                ) : (
                  <ClickToEditText
                    value={liveItem.question}
                    multiline
                    onSave={saveQuestion}
                    busy={busy}
                  />
                )}
              </div>
            </div>

            {/* Solution */}
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setSolutionOpen(!solutionOpen)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
              >
                <span>{solutionOpen ? "▾" : "▸"}</span>
                {solutionOpen ? "Hide" : "Show"} solution
                {previewSteps && ` (${previewSteps.length} steps)`}
                {stepsChanged && (
                  <span className="ml-2 rounded-[--radius-pill] bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    Preview
                  </span>
                )}
              </button>

              {solutionOpen && (
                <div className="mt-3 space-y-3">
                  {previewSteps && previewSteps.length > 0 ? (
                    previewSteps.map((s, i) => (
                      <div
                        key={i}
                        className={`rounded-[--radius-lg] border p-4 ${
                          stepsChanged
                            ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                            : "border-border-light bg-surface"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white shadow-sm">
                            {i + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-text-primary">
                              {stepsChanged || isProposalPending ? (
                                <MathText text={s.title} />
                              ) : (
                                <ClickToEditText
                                  value={s.title}
                                  inline
                                  onSave={(next) => saveStep(i, "title", next)}
                                  busy={busy}
                                />
                              )}
                            </div>
                            <div className="mt-2 h-px bg-border-light" />
                            <div className="mt-2 text-xs leading-relaxed text-text-secondary">
                              {stepsChanged || isProposalPending ? (
                                <MathText text={s.description} />
                              ) : (
                                <ClickToEditText
                                  value={s.description}
                                  multiline
                                  onSave={(next) => saveStep(i, "description", next)}
                                  busy={busy}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[--radius-md] bg-bg-subtle p-4 text-xs italic text-text-muted">
                      No solution steps recorded.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Final answer — bumped visual prominence */}
            {previewAnswer !== null && (
              <div
                className={`mt-6 rounded-[--radius-lg] border-2 p-5 ${
                  answerChanged
                    ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                    : "border-primary/40 bg-primary-bg/40"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-primary">
                  <span>Final answer</span>
                  {answerChanged && (
                    <span className="text-blue-700 dark:text-blue-300">Preview</span>
                  )}
                </div>
                <div className="mt-2 text-lg font-bold text-text-primary">
                  {answerChanged || isProposalPending ? (
                    <MathText text={previewAnswer ?? ""} />
                  ) : (
                    <ClickToEditText
                      value={liveItem.final_answer ?? ""}
                      onSave={saveFinalAnswer}
                      busy={busy}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Source + constraint footer */}
            <div className="mt-5 space-y-1 border-t border-border-light pt-3 text-[11px] text-text-muted">
              {liveItem.source_doc_ids && liveItem.source_doc_ids.length > 0 && (
                <div>
                  <span className="font-bold uppercase tracking-wider">Source:</span>{" "}
                  {liveItem.source_doc_ids.length} document
                  {liveItem.source_doc_ids.length === 1 ? "" : "s"}
                </div>
              )}
              {liveItem.generation_prompt && (
                <div>
                  <span className="font-bold uppercase tracking-wider">Constraint:</span>{" "}
                  &ldquo;{liveItem.generation_prompt}&rdquo;
                </div>
              )}
            </div>

            {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
          </div>

          {/* RIGHT — chat panel (slide-in) */}
          <ChatPanel
            item={liveItem}
            pendingIdx={pendingIdx}
            isProposalPending={isProposalPending}
            busy={busy}
            visible={chatOpen}
            confirmingClearChat={confirmingClearChat}
            onClose={() => setChatOpen(false)}
            onSend={sendChat}
            onAccept={acceptProposal}
            onDiscard={discardProposal}
            onStartClear={() => setConfirmingClearChat(true)}
            onConfirmClear={clearChat}
            onCancelClear={() => setConfirmingClearChat(false)}
          />
        </div>

        {/* Footer mode line */}
        <ModeLineFooter
          isQueueMode={isQueueMode}
          isProposalPending={isProposalPending}
          confirmingDelete={confirmingDelete}
          chatOpen={chatOpen}
          busy={busy}
          status={liveItem.status}
          onApprove={approve}
          onReject={reject}
          onSkip={skip}
          onToggleChat={() => setChatOpen((v) => !v)}
          onAcceptProposal={acceptProposal}
          onDiscardProposal={discardProposal}
          onStartDelete={() => setConfirmingDelete(true)}
          onConfirmDelete={remove}
          onCancelDelete={() => setConfirmingDelete(false)}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Mode-line footer — switches content based on the current state. Like
// Vim's status line: tells the teacher what they're doing right now.
// ─────────────────────────────────────────────────────────────────────

function ModeLineFooter({
  isQueueMode,
  isProposalPending,
  confirmingDelete,
  chatOpen,
  busy,
  status,
  onApprove,
  onReject,
  onSkip,
  onToggleChat,
  onAcceptProposal,
  onDiscardProposal,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  isQueueMode: boolean;
  isProposalPending: boolean;
  confirmingDelete: boolean;
  chatOpen: boolean;
  busy: boolean;
  status: string;
  onApprove: () => void;
  onReject: () => void;
  onSkip: () => void;
  onToggleChat: () => void;
  onAcceptProposal: () => void;
  onDiscardProposal: () => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  // Confirming delete takes precedence
  if (confirmingDelete) {
    return (
      <div className="border-t border-border-light bg-red-50/50 px-6 py-3 dark:bg-red-500/5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-red-800 dark:text-red-300">
            Delete this question forever?
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancelDelete}
              className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              disabled={busy}
              className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Yes, delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pending proposal — Accept or Discard is the only way forward
  if (isProposalPending) {
    return (
      <div className="border-t border-blue-200 bg-blue-50 px-6 py-3 dark:border-blue-500/30 dark:bg-blue-500/10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-blue-900 dark:text-blue-200">
              ✨ AI proposed a change
            </div>
            <div className="text-[11px] text-blue-800 dark:text-blue-300">
              Review the preview above, then accept or discard.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onDiscardProposal}
              disabled={busy}
              className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              ✕ Discard
            </button>
            <button
              onClick={onAcceptProposal}
              disabled={busy}
              className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Default: reading mode. Show approve/reject/skip/chat/delete.
  // In single mode, hide Approve/Reject if the question isn't pending
  // (since they've already been resolved).
  const showApproveReject = isQueueMode || status === "pending";

  return (
    <div className="border-t border-border-light px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {showApproveReject && (
          <>
            <FooterButton
              onClick={onReject}
              disabled={busy}
              variant="reject"
              shortcut="X"
              label="Reject"
            />
            {isQueueMode && (
              <FooterButton
                onClick={onSkip}
                disabled={busy}
                variant="neutral"
                shortcut="S"
                label="Skip"
              />
            )}
          </>
        )}
        <FooterButton
          onClick={onToggleChat}
          disabled={busy}
          variant={chatOpen ? "primary-outline" : "neutral"}
          shortcut="C"
          label={chatOpen ? "💬 Hide" : "💬 AI"}
        />
        {showApproveReject && (
          <FooterButton
            onClick={onApprove}
            disabled={busy}
            variant="approve"
            shortcut="↵"
            label="Approve"
            isLast
          />
        )}
        <button
          onClick={onStartDelete}
          disabled={busy}
          title="Delete question"
          aria-label="Delete question"
          className="ml-2 rounded-[--radius-md] border border-red-300 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          🗑
        </button>
      </div>
      <p className="mt-2 hidden text-[10px] text-text-muted md:block">
        ↵ approve · X reject {isQueueMode && "· S skip"} · C chat · ↑↓ toggle solution · Esc close
      </p>
    </div>
  );
}

function FooterButton({
  onClick,
  disabled,
  variant,
  shortcut,
  label,
  isLast,
}: {
  onClick: () => void;
  disabled: boolean;
  variant: "approve" | "reject" | "neutral" | "primary-outline";
  shortcut: string;
  label: string;
  isLast?: boolean;
}) {
  const variantClasses = {
    approve: "bg-green-600 text-white hover:bg-green-700",
    reject: "bg-red-600 text-white hover:bg-red-700",
    neutral: "border border-border-light text-text-secondary hover:bg-bg-subtle",
    "primary-outline": "border border-primary bg-primary-bg/30 text-primary hover:bg-primary-bg/50",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${
        isLast ? "ml-auto" : ""
      } group relative rounded-[--radius-md] px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${variantClasses[variant]}`}
    >
      <span>{label}</span>
      <span className="ml-1.5 hidden font-mono text-[9px] opacity-60 md:inline">{shortcut}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Chat panel — slide-in sidebar
// ─────────────────────────────────────────────────────────────────────

function ChatPanel({
  item,
  pendingIdx,
  isProposalPending,
  busy,
  visible,
  confirmingClearChat,
  onClose,
  onSend,
  onAccept,
  onDiscard,
  onStartClear,
  onConfirmClear,
  onCancelClear,
}: {
  item: BankItem;
  pendingIdx: number;
  isProposalPending: boolean;
  busy: boolean;
  visible: boolean;
  confirmingClearChat: boolean;
  onClose: () => void;
  onSend: (message: string) => Promise<boolean>;
  onAccept: () => void;
  onDiscard: () => void;
  onStartClear: () => void;
  onConfirmClear: () => void;
  onCancelClear: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messages = item.chat_messages;
  const teacherMessageCount = messages.filter((m) => m.role === "teacher").length;
  const atSoftCap = teacherMessageCount >= item.chat_soft_cap;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const ok = await onSend(text);
    if (ok) setDraft("");
  };

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden border-border-light bg-surface transition-[max-height,width] duration-200 ease-out motion-reduce:transition-none ${
        visible
          ? "max-h-[60vh] w-full border-t md:max-h-none md:w-96 md:border-l md:border-t-0"
          : "max-h-0 w-full border-t-0 md:w-0 md:border-l-0"
      }`}
      aria-hidden={!visible}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-light px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base">💬</span>
          <span className="text-sm font-bold text-text-primary">AI Workshop</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold ${atSoftCap ? "text-amber-600" : "text-text-muted"}`}>
            {teacherMessageCount}/{item.chat_soft_cap}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary md:hidden"
            aria-label="Close chat"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto bg-bg-subtle/40 px-4 py-3"
      >
        {messages.length === 0 && <WelcomeMessage />}
        {messages.map((msg, i) => (
          <ChatMessageBubble
            key={i}
            msg={msg}
            isPending={i === pendingIdx}
            busy={busy}
            onAccept={onAccept}
            onDiscard={onDiscard}
          />
        ))}
        {busy && (
          <div className="flex items-center gap-1.5 rounded-[--radius-md] bg-surface p-3 text-xs italic text-text-muted shadow-sm">
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
            </span>
            AI is thinking…
          </div>
        )}
      </div>

      {atSoftCap && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          You&rsquo;ve sent a lot of messages — consider clearing the chat or starting fresh.
        </div>
      )}

      {confirmingClearChat && (
        <div className="flex items-center gap-2 border-t border-border-light bg-bg-subtle px-3 py-2 text-[11px]">
          <span className="font-semibold text-text-primary">Clear chat history?</span>
          <button
            onClick={onConfirmClear}
            disabled={busy}
            className="rounded-[--radius-sm] bg-primary px-2 py-1 font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            Yes
          </button>
          <button
            onClick={onCancelClear}
            className="rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 font-semibold text-text-secondary hover:bg-bg-base"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Input */}
      <form
        className="border-t border-border-light bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={
            isProposalPending
              ? "Accept or discard the proposal first…"
              : "Ask for changes or just chat about this question…"
          }
          className="w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          disabled={busy || isProposalPending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={onStartClear}
            disabled={busy || isProposalPending || messages.length === 0 || confirmingClearChat}
            className="text-[11px] font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Clear chat
          </button>
          <button
            type="submit"
            disabled={busy || isProposalPending || !draft.trim()}
            className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="rounded-[--radius-md] bg-surface p-4 text-xs text-text-secondary shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
          AI
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
          Workshop assistant
        </span>
      </div>
      <p className="text-text-primary">
        Hi! I can revise this question, redo the solution, change the difficulty, or just answer questions about it.
      </p>
      <p className="mt-2 text-[10px] uppercase tracking-wider text-text-muted">
        Try typing one of these or your own:
      </p>
      <ul className="mt-1 space-y-1 text-[11px] italic text-text-muted">
        <li>&ldquo;Make the numbers smaller&rdquo;</li>
        <li>&ldquo;Why did you factor it this way?&rdquo;</li>
        <li>&ldquo;Add a step explaining the discriminant&rdquo;</li>
        <li>&ldquo;Rewrite as a real-world word problem&rdquo;</li>
      </ul>
    </div>
  );
}

function ChatMessageBubble({
  msg,
  isPending,
  busy,
  onAccept,
  onDiscard,
}: {
  msg: BankChatMessage;
  isPending: boolean;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  if (msg.role === "teacher") {
    return (
      <div className="ml-6 whitespace-pre-wrap rounded-[--radius-md] bg-primary px-3 py-2 text-xs text-white shadow-sm">
        {msg.text}
      </div>
    );
  }

  const proposalState = msg.accepted
    ? "accepted"
    : msg.discarded
      ? "discarded"
      : msg.superseded
        ? "superseded"
        : msg.proposal
          ? "pending"
          : null;

  return (
    <div className="rounded-[--radius-md] bg-surface p-3 text-xs text-text-secondary shadow-sm">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-white">
          AI
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">AI</span>
      </div>
      <div className="whitespace-pre-wrap text-text-primary">{msg.text}</div>

      {proposalState && (
        <div className="mt-2">
          {proposalState === "pending" && isPending && (
            <div className="rounded-[--radius-sm] border border-blue-200 bg-blue-50 p-2 dark:border-blue-500/30 dark:bg-blue-500/10">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                Preview shown ←
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={onAccept}
                  disabled={busy}
                  className="flex-1 rounded-[--radius-sm] bg-green-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  ✓ Accept
                </button>
                <button
                  onClick={onDiscard}
                  disabled={busy}
                  className="flex-1 rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                >
                  ✕ Discard
                </button>
              </div>
            </div>
          )}
          {proposalState === "accepted" && (
            <div className="mt-1 text-[10px] font-bold text-green-700 dark:text-green-400">
              ✓ Accepted
            </div>
          )}
          {proposalState === "discarded" && (
            <div className="mt-1 text-[10px] font-bold text-text-muted">✕ Discarded</div>
          )}
          {proposalState === "superseded" && (
            <div className="mt-1 text-[10px] font-bold text-text-muted">
              ↻ Superseded by a newer proposal
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty + completion screens (queue mode only)
// ─────────────────────────────────────────────────────────────────────

function EmptyQueueModal({ onClose }: { onClose: () => void }) {
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

function CompletionModal({
  counts,
  total,
  onClose,
}: {
  counts: { approved: number; rejected: number; skipped: number };
  total: number;
  onClose: () => void;
}) {
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
