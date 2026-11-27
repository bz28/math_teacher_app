"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { BankPicker, bankSelectionNote } from "./bank-picker";

/**
 * The homework page's "Add from bank": the course's approved questions,
 * minus the ones already on the homework, added to the end in the order
 * picked. No generation, no second review.
 */
export function AddFromBankDialog({
  courseId,
  homeworkUnitIds,
  existingIds,
  onAdd,
  onClose,
}: {
  courseId: string;
  homeworkUnitIds: string[];
  /** The homework's problems, in order: left out of the list and kept
   *  ahead of the new ones. */
  existingIds: string[];
  onAdd: (bankItemIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const { busy, error, run } = useAsyncAction();
  const titleId = useId();
  const n = selected.length;

  const add = () =>
    run(async () => {
      await onAdd([...existingIds, ...selected]);
      onClose();
    }, "Couldn’t add these questions");

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      labelledById={titleId}
      className="flex max-h-[88vh] max-w-2xl flex-col p-0"
    >
      <div className="flex items-center gap-3 border-b border-border-light px-6 py-4">
        <h2 id={titleId} className="font-serif text-xl leading-tight text-text-primary">
          Add from question bank
        </h2>
        <span className="rounded-[--radius-sm] bg-bg-subtle px-2 py-0.5 text-xs text-text-muted">
          approved only
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <BankPicker
          courseId={courseId}
          homeworkUnitIds={homeworkUnitIds}
          excludeIds={existingIds}
          selected={selected}
          onChange={setSelected}
          disabled={busy}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3.5">
        <span className="text-xs text-text-muted">
          {error ? (
            <span role="alert" className="font-semibold text-[color:var(--color-error)]">
              {error}
            </span>
          ) : (
            bankSelectionNote(n)
          )}
        </span>
        <button
          type="button"
          onClick={add}
          disabled={busy || n === 0}
          className="shrink-0 whitespace-nowrap rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Adding…" : `Add ${n} problem${n === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}
