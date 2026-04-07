"use client";

import { useState } from "react";

/**
 * Click-to-edit title for the workshop modal header. Plain text only
 * (no LaTeX rendering — title is a concept label, not math). Saves on
 * blur or Enter, cancels on Escape.
 */
export function InlineTitleEdit({
  value,
  onSave,
  busy,
}: {
  value: string;
  onSave: (next: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !busy && setEditing(true)}
        disabled={busy}
        title="Click to edit title"
        className="min-w-0 flex-1 truncate rounded-[--radius-sm] text-left text-base font-bold text-text-primary decoration-text-muted/30 decoration-dotted underline-offset-4 hover:bg-primary-bg/20 hover:underline hover:decoration-primary/40 disabled:cursor-default"
      >
        {value || (
          <span className="italic text-text-muted">Add a concept title…</span>
        )}
      </button>
    );
  }

  return (
    <InlineTitleEditor
      initial={value}
      onCommit={(next) => {
        onSave(next);
        setEditing(false);
      }}
      onCancel={() => setEditing(false)}
    />
  );
}

function InlineTitleEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      autoFocus
      maxLength={120}
      placeholder="Add a concept title…"
      className="min-w-0 flex-1 rounded-[--radius-sm] border border-primary bg-bg-base px-2 py-1 text-base font-bold text-text-primary focus:outline-none"
    />
  );
}
