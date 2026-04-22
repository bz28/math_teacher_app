"use client";

import { useState } from "react";
import type { TeacherRubric } from "@/lib/api";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";

// Default rubric text shown pre-filled in the two primary fields.
//
// KEEP IN SYNC with api/core/grading_ai.py::_build_rubric_block defaults.
// When the teacher doesn't edit, the stored rubric stays null and the
// backend falls back to this same text — so what the teacher sees here
// is exactly what the AI grader applies.
export const GRADING_SETUP_DEFAULTS = {
  full_credit:
    "Correct final answer. Mathematically equivalent forms (e.g. 1/2 and 0.5) count as correct. Work shown when the problem asks for it.",
  partial_credit:
    "Right approach with an arithmetic or sign error — typically around 60%. Multiple errors or unfinished work — around 30%.",
} as const;

const COMMON_MISTAKES_PLACEHOLDER =
  "e.g. Sign errors when distributing; flipping the inequality direction when multiplying by negatives.";
const NOTES_PLACEHOLDER = "Anything else the AI grader should know.";

type RubricFieldName =
  | "full_credit"
  | "partial_credit"
  | "common_mistakes"
  | "notes";

export function GradingSetupCard({
  rubric,
  saveState,
  saveError,
  onChange,
}: {
  rubric: TeacherRubric | null;
  saveState: SaveState;
  saveError: string | null;
  onChange: (patch: Partial<TeacherRubric>) => void;
}) {
  // The rubric save state is a single flag for the whole card, but the
  // teacher is always editing one field at a time. Tracking which field
  // most recently triggered a save lets us render the "Saving…" / "✓
  // Saved" hint next to THAT field's label — closer to the teacher's
  // eye line than a panel-top hint.
  const [lastEdited, setLastEdited] = useState<RubricFieldName | null>(null);

  const commitField = (field: RubricFieldName, text: string) => {
    setLastEdited(field);
    // Empty string → undefined so normalizeRubric in the parent drops
    // the field (unset rather than "" stored).
    onChange({ [field]: text.length > 0 ? text : undefined });
  };

  const hintFor = (field: RubricFieldName) =>
    lastEdited === field ? (
      <InlineSavedHint state={saveState} errorMessage={saveError} />
    ) : null;

  return (
    <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      <header className="border-b border-border-light pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
          Grading setup
        </h2>
        <p className="mt-1 text-xs text-text-secondary">
          Tell the AI how to grade. We&apos;ve filled in sensible defaults
          — edit to match how you grade.
        </p>
      </header>

      <div className="mt-4 space-y-4">
        <PrimaryField
          id="rubric-full-credit"
          label="Full credit"
          defaultText={GRADING_SETUP_DEFAULTS.full_credit}
          value={rubric?.full_credit}
          onCommit={(v) => commitField("full_credit", v)}
          rightSlot={hintFor("full_credit")}
        />
        <PrimaryField
          id="rubric-partial-credit"
          label="Partial credit"
          defaultText={GRADING_SETUP_DEFAULTS.partial_credit}
          value={rubric?.partial_credit}
          onCommit={(v) => commitField("partial_credit", v)}
          rightSlot={hintFor("partial_credit")}
        />
        <OptionalField
          id="rubric-common-mistakes"
          label="Common mistakes"
          placeholder={COMMON_MISTAKES_PLACEHOLDER}
          value={rubric?.common_mistakes}
          onCommit={(v) => commitField("common_mistakes", v)}
          rightSlot={hintFor("common_mistakes")}
        />
        <OptionalField
          id="rubric-notes"
          label="Notes"
          placeholder={NOTES_PLACEHOLDER}
          value={rubric?.notes}
          onCommit={(v) => commitField("notes", v)}
          rightSlot={hintFor("notes")}
        />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Primary field — Full credit / Partial credit. Pre-filled with a
// default the teacher can accept verbatim or edit. Larger textarea +
// stronger label weight than OptionalField.
// ────────────────────────────────────────────────────────────────────

function PrimaryField({
  id,
  label,
  defaultText,
  value,
  onCommit,
  rightSlot,
}: {
  id: string;
  label: string;
  defaultText: string;
  value: string | undefined;
  onCommit: (text: string) => void;
  rightSlot?: React.ReactNode;
}) {
  // Null-sentinel buffer pattern: null means "show the external
  // value"; a string means "user is actively typing". Same pattern
  // used by the feedback textarea on the review page.
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  // When value is unset, fall back to defaultText so the teacher sees
  // the starter copy in the field (not a placeholder-only ghost).
  const external = value ?? defaultText;
  const draft = editBuffer ?? external;

  const handleBlur = () => {
    if (editBuffer === null) return;
    const committed = editBuffer;
    setEditBuffer(null);
    if (committed !== external) onCommit(committed);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[11px] font-bold uppercase tracking-wider text-text-primary"
        >
          {label}
        </label>
        {rightSlot}
      </div>
      <textarea
        id={id}
        value={draft}
        onChange={(e) => setEditBuffer(e.target.value)}
        onBlur={handleBlur}
        rows={3}
        className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm leading-relaxed text-text-primary focus:border-primary focus:outline-none"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Optional field — Common mistakes / Notes. Blank by default with a
// guiding placeholder. Smaller + muted label vs PrimaryField.
// ────────────────────────────────────────────────────────────────────

function OptionalField({
  id,
  label,
  placeholder,
  value,
  onCommit,
  rightSlot,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string | undefined;
  onCommit: (text: string) => void;
  rightSlot?: React.ReactNode;
}) {
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const external = value ?? "";
  const draft = editBuffer ?? external;

  const handleBlur = () => {
    if (editBuffer === null) return;
    const committed = editBuffer;
    setEditBuffer(null);
    if (committed !== external) onCommit(committed);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[10px] font-bold uppercase tracking-wider text-text-muted"
        >
          {label}
        </label>
        {rightSlot}
      </div>
      <textarea
        id={id}
        value={draft}
        onChange={(e) => setEditBuffer(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={2}
        className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
      />
    </div>
  );
}
