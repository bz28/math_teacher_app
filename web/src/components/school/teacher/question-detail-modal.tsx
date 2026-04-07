"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankChatMessage,
  type BankChatProposal,
  type BankItem,
} from "@/lib/api";
import { ClickToEditText } from "@/components/school/shared/click-to-edit-text";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { STATUS_BADGE } from "./bank-styles";

const SUGGESTION_CHIPS = [
  "Make it harder",
  "Add a step to the solution",
  "Rewrite as a word problem",
];

/**
 * Two-panel workshop modal: artifact on the left, persistent chat
 * sidebar on the right. Preview-before-commit — proposals never write
 * to the live row until the teacher hits Accept. While a proposal is
 * pending, all other content actions are gated.
 */
export function QuestionDetailModal({
  item: initialItem,
  onClose,
  onChanged,
}: {
  item: BankItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [liveItem, setLiveItem] = useState<BankItem>(initialItem);
  const [showUndo, setShowUndo] = useState(initialItem.has_previous_version);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClearChat, setConfirmingClearChat] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(false);
  // Mobile-only: the chat is hidden behind a 💬 floating button by default.
  // On md+ the chat is always visible as the right column.
  const [chatOpenMobile, setChatOpenMobile] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();

  // If the parent reloads the bank list and a fresher version of this item
  // arrives, prefer the fresher updated_at. We don't blindly replace because
  // mid-chat we may have a more recent local copy than the parent list.
  useEffect(() => {
    if (initialItem.id !== liveItem.id) {
      setLiveItem(initialItem);
    } else if (
      new Date(initialItem.updated_at).getTime() >
      new Date(liveItem.updated_at).getTime()
    ) {
      setLiveItem(initialItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem]);

  useEffect(() => {
    setShowUndo(liveItem.has_previous_version);
  }, [liveItem.id, liveItem.has_previous_version, liveItem.updated_at]);

  // Auto-hide undo after 30s
  useEffect(() => {
    if (!showUndo) return;
    const t = setTimeout(() => setShowUndo(false), 30000);
    return () => clearTimeout(t);
  }, [showUndo]);

  // Pending proposal: latest AI message with a proposal that isn't
  // accepted/discarded/superseded. Memoized.
  const pendingIdx = useMemo(() => {
    for (let i = liveItem.chat_messages.length - 1; i >= 0; i--) {
      const m = liveItem.chat_messages[i];
      if (m.role === "ai" && m.proposal && !m.accepted && !m.discarded && !m.superseded) {
        return i;
      }
    }
    return -1;
  }, [liveItem.chat_messages]);
  const pendingProposal: BankChatProposal | null =
    pendingIdx >= 0 ? liveItem.chat_messages[pendingIdx].proposal! : null;
  const isProposalPending = pendingIdx >= 0;

  // Auto-open the mobile chat drawer the moment a proposal lands so the
  // teacher doesn't have to hunt for the Accept/Discard buttons.
  useEffect(() => {
    if (isProposalPending) setChatOpenMobile(true);
  }, [isProposalPending, pendingIdx]);

  // Manual edits and content-changing actions are blocked while a proposal
  // is pending — the teacher must Accept or Discard first.
  const blockIfPending = (): boolean => {
    if (isProposalPending) {
      setError("Accept or discard the AI proposal before editing.");
      return true;
    }
    return false;
  };

  const replaceItem = (next: BankItem) => {
    setLiveItem(next);
    onChanged();
  };

  const saveQuestion = (next: string) =>
    run(async () => {
      if (blockIfPending()) return;
      const q = next.trim();
      if (!q || q === liveItem.question) return;
      const updated = await teacher.updateBankItem(liveItem.id, { question: q });
      replaceItem(updated);
      setShowUndo(true);
    });

  const saveStep = (idx: number, field: "title" | "description", next: string) =>
    run(async () => {
      if (blockIfPending()) return;
      if (!liveItem.solution_steps) return;
      const updatedSteps = liveItem.solution_steps.map((s, i) =>
        i === idx ? { ...s, [field]: next } : s,
      );
      const updated = await teacher.updateBankItem(liveItem.id, {
        solution_steps: updatedSteps,
      });
      replaceItem(updated);
      setShowUndo(true);
    });

  const saveFinalAnswer = (next: string) =>
    run(async () => {
      if (blockIfPending()) return;
      if (next === (liveItem.final_answer ?? "")) return;
      const updated = await teacher.updateBankItem(liveItem.id, { final_answer: next });
      replaceItem(updated);
      setShowUndo(true);
    });

  // Returns true on success so ChatPanel can preserve the draft on failure.
  const sendChat = async (message: string): Promise<boolean> => {
    setError(null);
    let ok = false;
    await run(async () => {
      const next = await teacher.sendBankChat(liveItem.id, message);
      replaceItem(next);
      ok = true;
    }, "Chat failed");
    return ok;
  };

  const acceptProposal = () =>
    run(async () => {
      if (pendingIdx < 0) return;
      const next = await teacher.acceptBankChatProposal(liveItem.id, pendingIdx);
      replaceItem(next);
      setShowUndo(true);
    });

  const discardProposal = () =>
    run(async () => {
      if (pendingIdx < 0) return;
      const next = await teacher.discardBankChatProposal(liveItem.id, pendingIdx);
      replaceItem(next);
    });

  const clearChat = () =>
    run(async () => {
      const next = await teacher.clearBankChat(liveItem.id);
      replaceItem(next);
      setConfirmingClearChat(false);
    });

  const undo = () =>
    run(async () => {
      const next = await teacher.revertBankItem(liveItem.id);
      replaceItem(next);
      setShowUndo(false);
    });

  const approve = () =>
    run(async () => {
      if (blockIfPending()) return;
      await teacher.approveBankItem(liveItem.id);
      setLiveItem({ ...liveItem, status: "approved" });
      onChanged();
    });

  const reject = () =>
    run(async () => {
      if (blockIfPending()) return;
      await teacher.rejectBankItem(liveItem.id);
      setLiveItem({ ...liveItem, status: "rejected" });
      onChanged();
    });

  const remove = () =>
    run(async () => {
      await teacher.deleteBankItem(liveItem.id);
      onClose();
      onChanged();
    });

  // Compute the artifact view: if a proposal is pending, show the
  // proposed values for the changed fields (but mark them as preview).
  const previewQuestion = pendingProposal?.question ?? liveItem.question;
  const previewSteps = pendingProposal?.solution_steps ?? liveItem.solution_steps;
  const previewAnswer = pendingProposal?.final_answer ?? liveItem.final_answer;
  const questionChanged = pendingProposal?.question != null;
  const stepsChanged = pendingProposal?.solution_steps != null;
  const answerChanged = pendingProposal?.final_answer != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-text-primary">Question</h2>
            <span
              className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
                STATUS_BADGE[liveItem.status] ?? ""
              }`}
            >
              {liveItem.status}
            </span>
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
          >
            ✕
          </button>
        </div>

        {/* Two-panel body */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* LEFT — artifact */}
          <div className="flex-1 overflow-y-auto border-r border-border-light px-6 py-5">
            {/* Question */}
            <div
              className={`rounded-[--radius-lg] border p-4 transition-colors ${
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
              <div className="mt-2 text-sm">
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
                Solution {previewSteps && `(${previewSteps.length} steps)`}
                {stepsChanged && (
                  <span className="ml-2 rounded-[--radius-pill] bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    Preview
                  </span>
                )}
              </button>

              {solutionOpen && (
                <div className="mt-3 space-y-2">
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
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
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
                            <div className="mt-1.5 h-px bg-border-light" />
                            <div className="mt-2 text-xs text-text-secondary">
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

            {/* Final answer */}
            {previewAnswer !== null && (
              <div
                className={`mt-6 rounded-[--radius-lg] border-2 p-4 ${
                  answerChanged
                    ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/10"
                    : "border-primary/30 bg-primary-bg/30"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-primary">
                  <span>Final answer</span>
                  {answerChanged && (
                    <span className="text-blue-700 dark:text-blue-300">Preview</span>
                  )}
                </div>
                <div className="mt-2 text-base font-semibold text-text-primary">
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

            {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
          </div>

          {/* RIGHT — chat panel.
              On md+ it's always inline as the right column.
              On mobile it slides up from the bottom as a drawer when
              chatOpenMobile is true (auto-opens when a proposal lands). */}
          <div
            className={`
              ${chatOpenMobile
                ? "fixed inset-x-0 bottom-0 z-30 max-h-[75vh] flex-col overflow-hidden border-t border-border-light bg-surface shadow-2xl rounded-t-[--radius-xl] flex md:relative md:inset-auto md:max-h-none md:rounded-none md:border-none md:shadow-none md:flex"
                : "hidden md:flex"
              }
              md:max-w-sm md:flex-shrink-0
            `}
          >
            {/* Mobile-only drawer header with a close button. Hidden on md+ */}
            <div className="flex items-center justify-between border-b border-border-light px-4 py-2 md:hidden">
              <span className="text-sm font-bold text-text-primary">💬 Workshop</span>
              <button
                type="button"
                onClick={() => setChatOpenMobile(false)}
                className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
              >
                ✕
              </button>
            </div>

            <ChatPanel
              item={liveItem}
              pendingIdx={pendingIdx}
              isProposalPending={isProposalPending}
              busy={busy}
              confirmingClearChat={confirmingClearChat}
              onSend={sendChat}
              onAccept={acceptProposal}
              onDiscard={discardProposal}
              onStartClear={() => setConfirmingClearChat(true)}
              onConfirmClear={clearChat}
              onCancelClear={() => setConfirmingClearChat(false)}
            />
          </div>

          {/* Mobile-only floating action button to open the workshop drawer. */}
          {!chatOpenMobile && (
            <button
              type="button"
              onClick={() => setChatOpenMobile(true)}
              className="fixed bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-primary-dark md:hidden"
            >
              💬 Workshop
              {liveItem.chat_messages.length > 0 && (
                <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-bold">
                  {liveItem.chat_messages.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border-light px-6 py-3">
          {liveItem.status === "pending" && (
            <>
              <button
                onClick={approve}
                disabled={busy || isProposalPending}
                title={isProposalPending ? "Resolve the AI proposal first" : undefined}
                className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Approve
              </button>
              <button
                onClick={reject}
                disabled={busy || isProposalPending}
                title={isProposalPending ? "Resolve the AI proposal first" : undefined}
                className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                ✕ Reject
              </button>
            </>
          )}
          {confirmingDelete ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-red-700">Delete?</span>
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="ml-auto rounded-[--radius-md] border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  item,
  pendingIdx,
  isProposalPending,
  busy,
  confirmingClearChat,
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
  confirmingClearChat: boolean;
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

  // Auto-scroll to bottom on new message
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
    <div className="flex w-full min-h-0 flex-col">
      {/* Desktop-only header (mobile uses the drawer header above) */}
      <div className="hidden items-center justify-between border-b border-border-light px-4 py-2.5 md:flex">
        <div className="flex items-center gap-2">
          <span className="text-base">💬</span>
          <span className="text-sm font-bold text-text-primary">Workshop</span>
        </div>
        <span className={`text-[10px] font-semibold ${atSoftCap ? "text-amber-600" : "text-text-muted"}`}>
          {teacherMessageCount}/{item.chat_soft_cap}
        </span>
      </div>

      {/* Sticky pending-proposal banner */}
      {isProposalPending && (
        <div className="border-b border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="text-[11px] font-bold text-blue-900 dark:text-blue-200">
            ✨ AI proposed a change
          </div>
          <div className="mt-0.5 text-[10px] text-blue-800 dark:text-blue-300">
            Review the preview on the left, then accept or discard to continue.
          </div>
          <div className="mt-2 flex gap-1.5">
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
        {busy && <div className="text-xs italic text-text-muted">AI is thinking…</div>}
      </div>

      {/* Suggestion chips on first open */}
      {messages.length === 0 && !isProposalPending && (
        <div className="flex flex-wrap gap-1.5 border-t border-border-light px-4 py-2">
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => {
                void onSend(chip);
              }}
              disabled={busy}
              className="rounded-[--radius-pill] border border-border-light bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary/30 hover:text-primary disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {atSoftCap && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          You&rsquo;ve sent a lot of messages — consider clearing the chat or starting fresh.
        </div>
      )}

      {/* Inline confirm for clear chat (replaces a window.confirm) */}
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
              ? "Accept or discard the AI's proposal to keep chatting…"
              : "Ask for changes, ask a question, or just chat about this problem…"
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
    <div className="rounded-[--radius-md] bg-surface p-3 text-xs text-text-secondary shadow-sm">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">AI</div>
      Hi! Ask me anything about this question. I can rewrite it, redo the solution,
      change the difficulty, turn it into a word problem, or just answer questions
      about it. Try one of the suggestions below or type your own.
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
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">AI</div>
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
