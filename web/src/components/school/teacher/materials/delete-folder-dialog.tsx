"use client";

import { Modal } from "@/components/ui/modal";

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
      <h2 className="text-lg font-bold text-text-primary">
        Delete &ldquo;{folderName}&rdquo;?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {fileCount === 0
          ? "This folder is empty and will be removed."
          : `This will also delete ${fileCount} file${fileCount === 1 ? "" : "s"} inside it. This cannot be undone.`}
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-[--radius-md] border border-border-light px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-[--radius-md] bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
