"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { MathText } from "@/components/shared/math-text";

/**
 * Click-to-edit text. Renders MathText by default, becomes a textarea
 * (multiline) or input (single-line) when clicked. Saves on blur or
 * Enter (single-line) or Cmd/Ctrl+Enter (multiline). Escape cancels.
 *
 * The editor sub-components own the draft state internally and are
 * mounted fresh each time the user enters edit mode (via the
 * `editing` boolean), so we don't need an effect to sync draft from
 * props — it's seeded from `value` at mount and lives only as long
 * as the editor is open.
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

  const handleSave = (next: string) => {
    onSave(next);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`group ${inline ? "inline" : "block w-full"} cursor-text rounded-[--radius-sm] text-left text-text-primary decoration-text-muted/30 decoration-dotted underline-offset-4 transition-colors hover:bg-primary-bg/20 hover:underline hover:decoration-primary/40 focus-visible:bg-primary-bg/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
        title="Click to edit"
        aria-label="Click to edit text"
        disabled={busy}
      >
        <MathText text={value || " "} />
      </button>
    );
  }

  // Editor is mounted fresh for each edit session, so its draft state is
  // safely seeded from `value` once at mount with no need for a sync effect.
  const cancel = () => setEditing(false);

  if (multiline) {
    return <MultilineEditor initialValue={value} onCommit={handleSave} onCancel={cancel} />;
  }
  return <SingleLineEditor initialValue={value} onCommit={handleSave} onCancel={cancel} />;
}

function SingleLineEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft);
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
function MultilineEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Cap at ~16 lines so a runaway response doesn't take over the screen
    el.style.height = `${Math.min(el.scrollHeight, 384)}px`;
  }, [draft]);

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit(draft);
        }
      }}
      rows={2}
      className="w-full resize-none overflow-hidden rounded-[--radius-md] border border-primary bg-bg-base px-2 py-1 text-sm text-text-primary focus:outline-none"
      autoFocus
    />
  );
}
