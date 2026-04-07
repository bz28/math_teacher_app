"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { FolderIcon } from "@/components/ui/icons";
import type { Collision, ResolutionChoice } from "./types";
import { fileCountInFolder } from "./walk-dropped-folder";

interface CollisionDialogProps {
  open: boolean;
  collisions: Collision[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (choices: Map<string, ResolutionChoice>) => void;
}

const CHOICES: { value: ResolutionChoice; label: string; hint: string }[] = [
  { value: "create", label: "Create new", hint: "Adds a numbered copy" },
  { value: "merge", label: "Merge", hint: "Add files to existing" },
  { value: "skip", label: "Skip", hint: "Don't import" },
];

export function CollisionDialog({
  open,
  collisions,
  busy,
  onCancel,
  onConfirm,
}: CollisionDialogProps) {
  const [choices, setChoices] = useState<Map<string, ResolutionChoice>>(new Map());

  // Reset every time the dialog opens with a new batch of collisions.
  useEffect(() => {
    if (!open) return;
    const next = new Map<string, ResolutionChoice>();
    for (const c of collisions) next.set(c.folder.name, "create");
    setChoices(next);
  }, [open, collisions]);

  const applyToAll = (choice: ResolutionChoice) => {
    const next = new Map<string, ResolutionChoice>();
    for (const c of collisions) next.set(c.folder.name, choice);
    setChoices(next);
  };

  const setFor = (name: string, choice: ResolutionChoice) => {
    setChoices((prev) => {
      const next = new Map(prev);
      next.set(name, choice);
      return next;
    });
  };

  return (
    <Modal open={open} onClose={onCancel} className="max-w-xl">
      <div>
        <h2 className="text-lg font-bold text-text-primary">
          {collisions.length === 1
            ? "A folder with this name already exists"
            : `${collisions.length} folders already exist`}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Choose how to handle each one. You can skip individual folders without
          cancelling the whole import.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-[--radius-md] border border-border-light bg-bg-subtle px-3 py-2">
          <span className="text-xs font-semibold text-text-secondary">Apply to all:</span>
          {CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => applyToAll(c.value)}
              className="rounded-full border border-border-light bg-surface px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {c.label}
            </button>
          ))}
        </div>

        <ul className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto">
          {collisions.map((collision) => {
            const current = choices.get(collision.folder.name) ?? "create";
            const fileCount = fileCountInFolder(collision.folder);
            return (
              <li
                key={collision.folder.name}
                className="rounded-[--radius-md] border border-border-light bg-surface p-3"
              >
                <div className="flex items-center gap-2">
                  <FolderIcon className="h-4 w-4 shrink-0 text-text-muted" />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                    {collision.folder.name}
                  </p>
                  <span className="text-xs text-text-muted">
                    {fileCount} file{fileCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label={`Resolution for ${collision.folder.name}`}
                  className="mt-3 grid grid-cols-3 gap-2"
                >
                  {CHOICES.map((c) => {
                    const active = current === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setFor(collision.folder.name, c.value)}
                        className={[
                          "flex flex-col items-start gap-0.5 rounded-[--radius-sm] border px-3 py-2 text-left transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                          active
                            ? "border-primary bg-primary-bg shadow-sm"
                            : "border-border-light bg-surface hover:border-border-strong hover:bg-bg-subtle",
                        ].join(" ")}
                      >
                        <span
                          className={`text-xs font-bold ${
                            active ? "text-primary" : "text-text-primary"
                          }`}
                        >
                          {c.label}
                        </span>
                        <span className="text-[10px] text-text-muted">{c.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Cancel import
          </button>
          <button
            type="button"
            onClick={() => onConfirm(choices)}
            disabled={busy}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Continue import
          </button>
        </div>
      </div>
    </Modal>
  );
}
