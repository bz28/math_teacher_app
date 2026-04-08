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
      <h2 className="text-lg font-bold tracking-tight text-text-primary">{title}</h2>
      <p className="mt-1.5 text-xs text-text-muted">
        Pick a destination folder. Use the arrow keys to navigate.
      </p>
      <div
        role="listbox"
        aria-label="Destination folder"
        className="mt-4 max-h-72 space-y-1 overflow-y-auto rounded-[--radius-md] border border-border-light bg-bg-subtle p-2"
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
                className={`relative flex w-full items-center gap-2 rounded-[--radius-sm] px-3 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  selected
                    ? "bg-primary-bg font-semibold text-primary"
                    : "text-text-secondary hover:bg-surface"
                }`}
              >
                {selected && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary"
                  />
                )}
                {isSub ? (
                  <FolderOpenIcon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      selected ? "text-primary" : "text-text-muted"
                    }`}
                  />
                ) : (
                  <FolderIcon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      selected ? "text-primary" : "text-text-muted"
                    }`}
                  />
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
          className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || candidates.length === 0}
          onClick={() => onConfirm(target)}
          className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-all duration-150 ease-out hover:bg-primary-dark hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
        >
          Move
        </button>
      </div>
    </Modal>
  );
}
