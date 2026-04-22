"use client";

import { useState } from "react";
import type { TeacherRubric } from "@/lib/api";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";
import { GradingPreview } from "@/components/school/teacher/_pieces/grading-preview";

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

// Null-sentinel buffer per field: null means "show the external value",
// a string means "user is actively typing in this field". Lifted into
// the parent card so the live preview pane can read the same values the
// teacher sees in the textareas.
type DraftMap = Record<RubricFieldName, string | null>;

const INITIAL_DRAFTS: DraftMap = {
  full_credit: null,
  partial_credit: null,
  common_mistakes: null,
  notes: null,
};

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
  const [drafts, setDrafts] = useState<DraftMap>(INITIAL_DRAFTS);
  // The rubric save state is a single flag for the whole card. Tracking
  // which field most recently triggered a save lets us render the
  // "Saving…" / "✓ Saved" hint next to THAT field's label — closer to
  // the teacher's eye line than a panel-top hint.
  const [lastEdited, setLastEdited] = useState<RubricFieldName | null>(null);

  const externalFor = (field: RubricFieldName): string => {
    if (field === "full_credit")
      return rubric?.full_credit ?? GRADING_SETUP_DEFAULTS.full_credit;
    if (field === "partial_credit")
      return rubric?.partial_credit ?? GRADING_SETUP_DEFAULTS.partial_credit;
    if (field === "common_mistakes") return rubric?.common_mistakes ?? "";
    return rubric?.notes ?? "";
  };

  const displayed = (field: RubricFieldName): string =>
    drafts[field] ?? externalFor(field);

  const handleDraftChange = (field: RubricFieldName, text: string) => {
    setDrafts((d) => ({ ...d, [field]: text }));
  };

  const commitField = (field: RubricFieldName) => {
    const draft = drafts[field];
    if (draft === null) return; // user didn't touch this field
    const committed = draft;
    setDrafts((d) => ({ ...d, [field]: null }));
    const external = externalFor(field);
    if (committed === external) return;
    setLastEdited(field);
    // Empty string → undefined so normalizeRubric in the parent drops
    // the field (unset rather than "" stored).
    onChange({
      [field]: committed.length > 0 ? committed : undefined,
    } as Partial<TeacherRubric>);
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

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="space-y-4">
          <PrimaryField
            id="rubric-full-credit"
            label="Full credit"
            value={displayed("full_credit")}
            onDraftChange={(v) => handleDraftChange("full_credit", v)}
            onBlur={() => commitField("full_credit")}
            rightSlot={hintFor("full_credit")}
          />
          <PrimaryField
            id="rubric-partial-credit"
            label="Partial credit"
            value={displayed("partial_credit")}
            onDraftChange={(v) => handleDraftChange("partial_credit", v)}
            onBlur={() => commitField("partial_credit")}
            rightSlot={hintFor("partial_credit")}
          />
          <OptionalField
            id="rubric-common-mistakes"
            label="Common mistakes"
            placeholder={COMMON_MISTAKES_PLACEHOLDER}
            value={displayed("common_mistakes")}
            onDraftChange={(v) => handleDraftChange("common_mistakes", v)}
            onBlur={() => commitField("common_mistakes")}
            rightSlot={hintFor("common_mistakes")}
          />
          <OptionalField
            id="rubric-notes"
            label="Notes"
            placeholder={NOTES_PLACEHOLDER}
            value={displayed("notes")}
            onDraftChange={(v) => handleDraftChange("notes", v)}
            onBlur={() => commitField("notes")}
            rightSlot={hintFor("notes")}
          />
        </div>
        <GradingPreview
          fullCredit={displayed("full_credit")}
          partialCredit={displayed("partial_credit")}
          commonMistakes={displayed("common_mistakes")}
          notes={displayed("notes")}
        />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Primary field — Full credit / Partial credit. Pre-filled with a
// default the teacher can accept verbatim or edit. Larger textarea +
// stronger label weight than OptionalField. Controlled — parent owns
// the buffer.
// ────────────────────────────────────────────────────────────────────

function PrimaryField({
  id,
  label,
  value,
  onDraftChange,
  onBlur,
  rightSlot,
}: {
  id: string;
  label: string;
  value: string;
  onDraftChange: (text: string) => void;
  onBlur: () => void;
  rightSlot?: React.ReactNode;
}) {
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
        value={value}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onBlur}
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
  onDraftChange,
  onBlur,
  rightSlot,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onDraftChange: (text: string) => void;
  onBlur: () => void;
  rightSlot?: React.ReactNode;
}) {
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
        value={value}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={2}
        className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
      />
    </div>
  );
}
