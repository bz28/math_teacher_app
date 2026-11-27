"use client";

import { useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { InlineSavedHint, type SaveState } from "@/components/school/teacher/_pieces/inline-saved-hint";

// ────────────────────────────────────────────────────────────────────
// Instructions block — student-visible notes the teacher writes for
// the homework (e.g. "Show all work, no calculators"). Click-to-edit
// textarea that autosaves on blur. Empty state shows a quiet "+ Add
// instructions for students" affordance so teachers who don't need
// it aren't visually nagged. Renders LaTeX inline so formulas like
// $a + b\sqrt{c}$ display correctly.
// ────────────────────────────────────────────────────────────────────
export function InstructionsBlock({
  value,
  saveState,
  saveError,
  onChange,
}: {
  value: string | null;
  saveState: SaveState;
  saveError: string | null;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  // Tracks whether commit() just fired a save we're awaiting. Lets us
  // keep the textarea (and the teacher's typed text) on save-error,
  // and close it only on save-success — without this gate we'd either
  // close on every "saved" (breaking re-edits) or never close at all.
  const [committing, setCommitting] = useState(false);

  // React to the parent's saveState resolving AFTER a commit. On
  // "saved" we close the editor — but ONLY if the teacher hasn't
  // typed more characters since they blurred (draft would diverge
  // from value). When draft has moved past what we just saved, we
  // leave the editor open so the next blur can pick up the newer
  // text — losing those keystrokes on slow networks would surprise
  // the teacher. On "error" we always leave editing=true so the
  // typed text is retained for retry. Transitions while !committing
  // are ignored so a sibling field's save (e.g. units) can't close
  // our editor.
  //
  // Render-time state derivation rather than useEffect: avoids the
  // cascading-render lint, and the guard runs once per transition
  // because we flip committing=false in the same pass.
  if (committing && (saveState === "saved" || saveState === "error")) {
    setCommitting(false);
    if (
      saveState === "saved"
      && draft.trim() === (value ?? "").trim()
    ) {
      setEditing(false);
    }
  }

  const startEditing = () => {
    // Snapshot the current value into draft when entering edit mode.
    // We don't keep draft synced with value while idle (would risk
    // yanking text out from under a teacher whose committed text
    // hasn't propagated yet), so do the sync here, on user intent.
    setDraft(value ?? "");
    setEditing(true);
  };

  const cancel = () => {
    // Revert local edits and close — escape hatch for a stuck
    // save-error loop or a teacher who decided not to change anything
    // after all. Skips the save entirely so a previous error doesn't
    // re-fire.
    setDraft(value ?? "");
    setEditing(false);
    setCommitting(false);
  };

  const commit = () => {
    if (draft.trim() === (value ?? "").trim()) {
      setEditing(false);
      return;
    }
    onChange(draft);
    setCommitting(true);
    // editing stays true — the guard above closes it on save-success
    // when draft hasn't diverged from the saved value.
  };

  if (!editing) {
    if (!value) {
      return (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              Instructions for students
            </span>
            <span className="text-[11px] font-normal normal-case tracking-normal text-text-muted">
              · optional
            </span>
          </div>
          <button
            type="button"
            onClick={startEditing}
            className="block w-full rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-3 py-2 text-left text-sm text-text-muted transition-colors hover:border-primary/40 hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary"
          >
            + Add instructions students will see (e.g. &ldquo;Show all
            work, no calculators.&rdquo;)
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3 group">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Instructions for students
          </span>
          <InlineSavedHint state={saveState} errorMessage={saveError} />
        </div>
        {/* role=button instead of <button> because MathText can render
            display-math as a <div> for $$...$$ inputs, and a <div>
            inside a <button> is invalid HTML (hydration warnings,
            inconsistent click targets). The role+tabIndex+keyboard
            handlers reproduce native button semantics for keyboard
            and screen-reader users. */}
        <div
          role="button"
          tabIndex={0}
          onClick={startEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              startEditing();
            }
          }}
          className="block w-full cursor-pointer rounded-[--radius-md] border border-border-light bg-surface/50 px-3 py-2 text-left text-sm text-text-primary transition-colors hover:border-primary/40 hover:bg-[color:var(--color-surface-alt-2)]"
          title="Click to edit"
        >
          <div className="whitespace-pre-wrap">
            <MathText text={value} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Instructions for students
        </span>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Esc cancels the edit and reverts. preventDefault stops the
          // browser from also blurring (which would re-trigger commit).
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        autoFocus
        rows={3}
        maxLength={2000}
        placeholder='e.g. "Show all work and circle final answers. No calculators."'
        className="w-full rounded-[--radius-md] border border-primary bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
        <span>Visible to students. Supports inline LaTeX like $x^2$.</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            // mousedown preventDefault stops the textarea from blurring
            // (and re-firing commit) before our click handler runs;
            // keeps cancel a true escape rather than a hidden save.
            onMouseDown={(e) => e.preventDefault()}
            onClick={cancel}
            className="font-semibold text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <span className="tabular-nums">{draft.length}/2000</span>
        </div>
      </div>
    </div>
  );
}
