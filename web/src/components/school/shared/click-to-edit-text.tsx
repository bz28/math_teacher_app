"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
    return <AutoResizingTextarea value={draft} setDraft={setDraft} commit={commit} cancel={cancel} />;
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

/**
 * Textarea that grows with its content via measured scrollHeight instead of
 * a per-keystroke `\n` count. Avoids rendering jank on long content and
 * matches the behavior of Notion / Linear / GitHub multiline editors.
 */
function AutoResizingTextarea({
  value,
  setDraft,
  commit,
  cancel,
}: {
  value: string;
  setDraft: (next: string) => void;
  commit: () => void;
  cancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Cap at ~16 lines so a runaway response doesn't take over the screen
    el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
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
      rows={2}
      className="w-full resize-none overflow-hidden rounded-[--radius-md] border border-primary bg-bg-base px-2 py-1 text-sm text-text-primary focus:outline-none"
      autoFocus
    />
  );
}
