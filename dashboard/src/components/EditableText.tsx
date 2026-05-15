import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Click-to-edit text primitive. Shows `value` as plain text until the
 * user clicks, then swaps in an input pre-filled with the current
 * value. Saves on blur or Enter; cancels on Escape; reverts to plain
 * text either way.
 *
 * The save is fire-and-forget — `onSave` returns a Promise so the
 * caller can persist via the API; the input stays editable until the
 * promise resolves. If save throws, the prior value is restored.
 */
export function EditableText({
  value,
  onSave,
  placeholder,
  inputType = "text",
  display,
  inputStyle,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  inputType?: "text" | "email";
  /** How to render the value when not editing. Defaults to the
   *  string itself wrapped in nothing. */
  display?: (value: string) => React.ReactNode;
  /** Styling for the inline input. */
  inputStyle?: CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Keep draft in sync if the underlying value changes while not
  // editing (e.g., parent reloaded after a different field updated).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setDraft(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") cancel();
        }}
        style={{
          font: "inherit",
          color: "inherit",
          padding: "1px 6px",
          margin: "-1px -6px",
          border: "1px solid var(--rule-strong)",
          borderRadius: 3,
          background: "var(--surface)",
          outline: "none",
          minWidth: 120,
          ...inputStyle,
        }}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{
        cursor: "text",
        padding: "1px 6px",
        margin: "-1px -6px",
        borderRadius: 3,
        transition: "background 0.1s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      title="Click to edit"
    >
      {display ? display(value) : value}
    </span>
  );
}
