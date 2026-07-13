import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useToast } from "../lib/toast";

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
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Single-flight guard: Enter triggers commit, then the input
  // losing focus fires onBlur which would call commit again. The
  // ref lets a second commit short-circuit during an in-flight save.
  const committingRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Keep draft in sync if the underlying value changes while not
  // editing AND no save is in flight. The busy guard prevents a
  // parent reload (triggered by an unrelated field) from clobbering
  // the user's just-committed retry context.
  useEffect(() => {
    if (!editing && !busy) setDraft(value);
  }, [value, editing, busy]);

  const commit = async () => {
    if (committingRef.current) return;
    committingRef.current = true;
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      setEditing(false);
      committingRef.current = false;
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      // Surface the failure via the themed toast (matches sibling
      // field handlers in LeadDetail); silently reverting hides 422s
      // like an invalid email from the operator.
      toast((e as Error).message);
      setDraft(value);
      setEditing(false);
    } finally {
      setBusy(false);
      committingRef.current = false;
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
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      style={{
        // inline-block keeps the hover swatch confined to the
        // content box — without it, an EditableText sitting inside
        // a tall line-height container (e.g. an <h1>) renders the
        // background across the entire line-box vertically.
        display: "inline-block",
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
