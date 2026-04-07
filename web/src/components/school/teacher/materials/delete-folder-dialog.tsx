"use client";

import { Modal } from "@/components/ui/modal";
import { XIcon } from "@/components/ui/icons";

interface DeleteFolderDialogProps {
  open: boolean;
  folderName: string;
  fileCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteFolderDialog({
  open,
  folderName,
  fileCount,
  busy,
  onClose,
  onConfirm,
}: DeleteFolderDialogProps) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-3 px-1 pt-1 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"
        >
          <XIcon className="h-7 w-7" strokeWidth={2.5} />
        </span>
        <h2 className="text-lg font-bold tracking-tight text-text-primary">
          Delete &ldquo;{folderName}&rdquo;?
        </h2>
        <p className="text-sm leading-relaxed text-text-secondary">
          {fileCount === 0
            ? "This folder is empty and will be removed."
            : `This will also delete ${fileCount} file${fileCount === 1 ? "" : "s"} inside it. This cannot be undone.`}
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
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
      </div>
    </Modal>
  );
}
