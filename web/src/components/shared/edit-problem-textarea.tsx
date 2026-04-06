"use client";

/**
 * Inline editor for a problem's LaTeX text. Used in both the upload modal
 * and the problem queue. Auto-grows with content (rows scale to line count),
 * uses monospace for easy LaTeX scanning, and exits on Escape.
 */
interface EditProblemTextareaProps {
  value: string;
  onChange: (text: string) => void;
  onDone: () => void;
}

export function EditProblemTextarea({
  value,
  onChange,
  onDone,
}: EditProblemTextareaProps) {
  return (
    <div className="w-full">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        rows={Math.max(4, value.split("\n").length + 1)}
        autoFocus
        spellCheck={false}
        className="w-full resize-y rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2.5 font-mono text-sm leading-relaxed text-text-primary outline-none focus:border-primary"
      />
      <p className="mt-1 text-[11px] text-text-muted">
        Edit the LaTeX directly. Press{" "}
        <kbd className="rounded bg-card px-1 font-mono">Esc</kbd> to finish.
      </p>
    </div>
  );
}
