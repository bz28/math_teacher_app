"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { FolderIcon, FolderOpenIcon } from "@/components/ui/icons";
import type { Destination } from "./types";

interface MoveDialogProps {
  open: boolean;
  title: string;
  currentUnitId: string | null;
  destinations: Destination[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (target: string | null) => void;
}

export function MoveDialog({
  open,
  title,
  currentUnitId,
  destinations,
  busy,
  onClose,
  onConfirm,
}: MoveDialogProps) {
  const candidates = destinations.filter((d) => d.id !== currentUnitId);
  const [target, setTarget] = useState<string | null>(candidates[0]?.id ?? null);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-lg font-bold text-text-primary">{title}</h2>
      <p className="mt-1 text-xs text-text-muted">
        Pick a destination folder. Use the arrow keys to navigate.
      </p>
      <div
        role="listbox"
        aria-label="Destination folder"
        className="mt-4 max-h-72 overflow-y-auto rounded-[--radius-md] border border-border-light"
      >
        {candidates.length === 0 ? (
          <p className="p-3 text-xs text-text-muted">No other destinations available.</p>
        ) : (
          candidates.map((d) => {
            const isSub = d.label.includes(" / ");
            const selected = target === d.id;
            return (
              <button
                key={d.id ?? "uncategorized"}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setTarget(d.id)}
                onDoubleClick={() => onConfirm(d.id)}
                className={`flex w-full items-center gap-2 border-b border-border-light px-3 py-2 text-left text-sm last:border-b-0 ${
                  selected
                    ? "bg-primary-bg font-semibold text-primary"
                    : "text-text-secondary hover:bg-bg-subtle"
                }`}
              >
                {isSub ? (
                  <FolderOpenIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <FolderIcon className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{d.label}</span>
              </button>
            );
          })
        )}
      </div>
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
          disabled={busy || candidates.length === 0}
          onClick={() => onConfirm(target)}
          className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
        >
          Move
        </button>
      </div>
    </Modal>
  );
}
