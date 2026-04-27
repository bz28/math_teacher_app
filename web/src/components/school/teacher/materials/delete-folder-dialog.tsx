"use client";

import { Modal } from "@/components/ui/modal";
import { AlertTriangleIcon, XIcon } from "@/components/ui/icons";

interface DeleteFolderDialogProps {
  open: boolean;
  folderName: string;
  documentCount: number;
  questionCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteFolderDialog({
  open,
  folderName,
  documentCount,
  questionCount,
  busy,
  onClose,
  onConfirm,
}: DeleteFolderDialogProps) {
  if (!open) return null;
  const blocked = documentCount > 0 || questionCount > 0;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-3 px-1 pt-1 text-center">
        {blocked ? (
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30"
          >
            <AlertTriangleIcon className="h-7 w-7" strokeWidth={2.5} />
          </span>
        ) : (
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"
          >
            <XIcon className="h-7 w-7" strokeWidth={2.5} />
          </span>
        )}
        <h2 className="text-lg font-bold tracking-tight text-text-primary">
          {blocked
            ? `Can’t delete “${folderName}” yet`
            : `Delete “${folderName}”?`}
        </h2>
        <p className="text-sm leading-relaxed text-text-secondary">
          {blocked
            ? `Move ${formatBlockedParts(documentCount, questionCount)} out of this unit before deleting it.`
            : "This folder is empty and will be removed."}
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        {blocked ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-all duration-150 ease-out hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Got it
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-[--radius-md] bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all duration-150 ease-out hover:bg-red-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

// Mirrors the backend's 400 message format in
// api/routes/teacher_units.py so the user sees the same wording whether
// the gate fires client-side or server-side.
function formatBlockedParts(documents: number, questions: number): string {
  const parts: string[] = [];
  if (documents > 0) parts.push(`${documents} document${documents === 1 ? "" : "s"}`);
  if (questions > 0) parts.push(`${questions} question${questions === 1 ? "" : "s"}`);
  return parts.join(" and ");
}
