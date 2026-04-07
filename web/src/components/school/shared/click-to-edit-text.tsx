"use client";

import { useEffect, useState } from "react";
import { MathText } from "@/components/shared/math-text";

/**
 * Click-to-edit text. Renders MathText by default, becomes a textarea
 * (multiline) or input (single-line) when clicked. Saves on blur or
 * Enter (single-line) or Cmd/Ctrl+Enter (multiline). Escape cancels.
 */
export function ClickToEditText({
  value,
  multiline,
  inline,
  onSave,
  busy,
}: {
  value: string;
  multiline?: boolean;
  inline?: boolean;
  onSave: (next: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`group ${inline ? "inline" : "block w-full"} cursor-text text-left text-text-primary hover:rounded-[--radius-sm] hover:bg-primary-bg/20 hover:px-1 hover:-mx-1`}
        title="Click to edit"
        disabled={busy}
      >
        <MathText text={value || " "} />
      </button>
    );
  }

  const commit = () => {
    onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit();
          }
        }}
        rows={Math.max(2, Math.min(8, draft.split("\n").length + 1))}
        className="w-full rounded-[--radius-md] border border-primary bg-bg-base px-2 py-1 text-sm text-text-primary focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className="w-full rounded-[--radius-sm] border border-primary bg-bg-base px-2 py-0.5 text-sm text-text-primary focus:outline-none"
      autoFocus
    />
  );
}
