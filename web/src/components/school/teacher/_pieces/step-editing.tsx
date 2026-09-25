"use client";

import { useRef, useState } from "react";

/**
 * Structural editing for Workshop solution steps: the per-step
 * move/delete cluster, the "Add step" trigger, and the inline draft a
 * new step is written in. Text edits of existing steps stay on
 * ClickToEditText in the modal; everything here changes the list's
 * shape, and the modal persists the whole array through one helper.
 */

const ICON_BASE =
  "flex h-7 w-7 items-center justify-center rounded-[--radius-md] text-text-muted transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " +
  "disabled:pointer-events-none disabled:opacity-30";
const ICON_BTN = `${ICON_BASE} hover:bg-bg-subtle hover:text-text-primary`;

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const UP = "M8 12.5V3.5M4 7.5l4-4 4 4";
const DOWN = "M8 3.5v9M4 8.5l4 4 4-4";
const TRASH = "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5";

export function StepControls({
  index,
  count,
  busy,
  confirmingDelete,
  onMove,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  index: number;
  count: number;
  busy: boolean;
  confirmingDelete: boolean;
  onMove: (dir: -1 | 1) => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const n = index + 1;
  if (confirmingDelete) {
    return (
      <div
        className="flex shrink-0 items-center gap-1.5"
        role="group"
        aria-label={`Confirm deleting step ${n}`}
        onKeyDown={(e) => {
          // Esc backs out of the confirm — without stopping it here the
          // workshop's window-level Esc handler would close the modal.
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancelDelete();
          }
        }}
      >
        <span className="text-[11px] font-semibold text-text-secondary">Delete step {n}?</span>
        <button
          type="button"
          data-step-delete-confirm
          onClick={onConfirmDelete}
          disabled={busy}
          className="rounded-[--radius-md] border border-red-300 px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onCancelDelete}
          autoFocus
          className="rounded-[--radius-md] px-2 py-0.5 text-[11px] font-semibold text-text-muted hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Keep
        </button>
      </div>
    );
  }
  return (
    <div
      className="-mr-1 -mt-1 flex shrink-0 items-center opacity-60 transition-opacity group-hover/step:opacity-100 group-focus-within/step:opacity-100"
      role="group"
      aria-label={`Step ${n} actions`}
    >
      <button
        type="button"
        data-step-move={`up-${index}`}
        onClick={() => onMove(-1)}
        disabled={busy || index === 0}
        className={ICON_BTN}
        aria-label={`Move step ${n} up`}
        title="Move up"
      >
        <Icon d={UP} />
      </button>
      <button
        type="button"
        data-step-move={`down-${index}`}
        onClick={() => onMove(1)}
        disabled={busy || index === count - 1}
        className={ICON_BTN}
        aria-label={`Move step ${n} down`}
        title="Move down"
      >
        <Icon d={DOWN} />
      </button>
      <button
        type="button"
        onClick={onStartDelete}
        disabled={busy}
        className={`${ICON_BASE} hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-300`}
        aria-label={`Delete step ${n}`}
        title="Delete step"
      >
        <Icon d={TRASH} />
      </button>
    </div>
  );
}

export function AddStepButton({
  onClick,
  busy,
  label = "Add step",
}: {
  onClick: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <button
      data-step-add
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-center justify-center gap-1.5 rounded-[--radius-lg] border border-dashed border-border px-4 py-2.5 text-xs font-semibold text-text-muted transition-colors hover:border-primary/50 hover:bg-primary-bg/20 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
    >
      <span aria-hidden="true" className="text-sm leading-none">+</span>
      {label}
    </button>
  );
}

/**
 * A step that doesn't exist yet. Nothing is persisted until the teacher
 * commits, so cancelling (or committing blank) leaves the item exactly
 * as it was — no placeholder "New step" to clean up afterwards.
 */
export function StepDraft({
  number,
  busy,
  onCommit,
  onCancel,
}: {
  number: number;
  busy: boolean;
  onCommit: (step: { title: string; description: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const empty = !title.trim() && !description.trim();

  const commit = () => {
    if (busy) return;
    if (empty) {
      onCancel();
      return;
    }
    onCommit({ title: title.trim(), description: description.trim() });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  const fieldClass =
    "w-full rounded-[--radius-md] border border-border-light bg-bg-base px-2.5 py-1.5 text-text-primary " +
    "placeholder:text-text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div
      className="rounded-[--radius-lg] border border-dashed border-primary/50 bg-primary-bg/10 p-4"
      role="group"
      aria-label={`New step ${number}`}
      // Esc anywhere in the draft (including its buttons) cancels the
      // draft. Stopped here so the workshop's window-level Esc doesn't
      // also close the whole modal.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary/60 bg-surface text-xs font-bold text-primary">
          {number}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                descRef.current?.focus();
                return;
              }
              onKeyDown(e);
            }}
            placeholder="Step title, like “Factor the quadratic”"
            aria-label={`Step ${number} title`}
            data-step-draft-title
            maxLength={200}
            autoFocus
            className={`${fieldClass} text-sm font-semibold`}
          />
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What the student does in this step. Math like $x^2 - 5x + 6$ renders."
            aria-label={`Step ${number} explanation`}
            rows={3}
            className={`${fieldClass} resize-y text-xs leading-relaxed`}
          />
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <span className="text-[11px] text-text-muted">
              <kbd className="font-sans">⌘</kbd>/<kbd className="font-sans">Ctrl</kbd>+Enter to add, Esc to cancel
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-[--radius-md] px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Cancel
              </button>
              <button
                type="button"
                data-step-draft-submit
                onClick={commit}
                disabled={busy || empty}
                className="rounded-[--radius-md] bg-primary px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
              >
                Add step {number}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
