"use client";

import { useState } from "react";

/** Delete — a quiet affordance at the bottom right, with a red inline
 *  confirm to catch accidental clicks. Published homework can't be
 *  deleted until it's unpublished. */
export function DeleteHomework({
  disabled,
  busy,
  onDelete,
}: {
  disabled: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <div className="mt-8 flex justify-end">
      {confirmingDelete ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[color:var(--color-error)] ">
            Delete this homework?
          </span>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-[--radius-md] bg-[color:var(--color-error)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[color:var(--color-error)]/85 disabled:opacity-50"
          >
            Yes, delete
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={disabled}
          title={disabled ? "Unpublish before deleting" : "Delete this homework"}
          className="text-xs font-semibold text-text-muted hover:text-[color:var(--color-error)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🗑 Delete homework
        </button>
      )}
    </div>
  );
}
