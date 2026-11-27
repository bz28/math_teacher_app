"use client";

import { useState } from "react";
import type { TeacherDocument } from "@/lib/api";
import type { PendingUpload } from "@/hooks/use-document-uploads";
import { UnitMultiSelect } from "./unit-multi-select";
import { SectionMultiSelect } from "./section-multi-select";
import { SourceMaterialPicker } from "./source-material-picker";
import { DueDateChips } from "./due-date-chips";

/**
 * Shared wizard step components used by the New Homework and New
 * Practice creation flows. Both flows collect identical metadata for
 * the scratch path (title, units, due, sections, count,
 * focus hint, source docs); factoring the two steps here keeps the
 * UI strictly in lockstep while letting each modal wrap them in its
 * own orchestration.
 */

export const LATE_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Accept any time, no penalty" },
  { value: "penalty_per_day", label: "−10% per day after due" },
  { value: "no_credit", label: "Closed after due date" },
];

export const QUANTITY_CHIPS = [5, 10, 15, 20] as const;

// ────────────────────────────────────────────────────────────────────
// Step — Details (title, units, due, sections)
// ────────────────────────────────────────────────────────────────────

export function AssignmentDetailsStep({
  title,
  onTitleChange,
  courseId,
  unitIds,
  onUnitIdsChange,
  unitHint,
  due,
  sectionIds,
  onSectionIdsChange,
  disabled,
  titlePlaceholder,
  sectionsHint,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  courseId: string;
  unitIds: string[];
  onUnitIdsChange: (v: string[]) => void;
  /** Why the units are already picked ("The only unit in this course"). */
  unitHint?: string;
  /** Due date. Graded work only — practice has no due date. */
  due?: {
    dueAt: string;
    onDueAtChange: (v: string) => void;
  };
  sectionIds: string[];
  onSectionIdsChange: (v: string[]) => void;
  disabled: boolean;
  titlePlaceholder: string;
  sectionsHint: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-bold text-text-primary">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus
          maxLength={300}
          placeholder={titlePlaceholder}
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Units <span className="font-normal text-text-muted">· required</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          {unitHint ?? "Pick one. Multi-select for midterms or review sets that span units."}
        </p>
        <div className="mt-2">
          <UnitMultiSelect
            courseId={courseId}
            selected={unitIds}
            onChange={onUnitIdsChange}
            disabled={disabled}
          />
        </div>
      </div>

      {due && (
        <div>
          <span className="block text-sm font-bold text-text-primary">
            Due <span className="font-normal text-text-muted">· 11:59 PM unless you change it</span>
          </span>
          <div className="mt-2">
            {/* AI grading is queued until the due date passes; with no due
                date nothing ever triggers it, so the teacher must press
                "Grade N ungraded" on the grading page. Say so here, where
                the choice is made — it's the first-week trap otherwise. */}
            <DueDateChips
              value={due.dueAt}
              onChange={due.onDueAtChange}
              disabled={disabled}
              noneHint="No due date? Submissions wait until you press Grade ungraded on the grading page."
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Sections <span className="font-normal text-text-muted">· optional</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">{sectionsHint}</p>
        <div className="mt-2">
          <SectionMultiSelect
            courseId={courseId}
            selected={sectionIds}
            onChange={onSectionIdsChange}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Step — Problems (count, focus hint, source docs)
// ────────────────────────────────────────────────────────────────────

export function AssignmentProblemsStep({
  count,
  onCountChange,
  topicHint,
  onTopicHintChange,
  courseId,
  unitIds,
  docs,
  docsLoaded,
  selectedDocs,
  onToggleDoc,
  pending,
  onFilesSelected,
  onRetryPending,
  onDismissPending,
  disabled,
  helperText,
  extraControls,
}: {
  count: number;
  onCountChange: (v: number) => void;
  topicHint: string;
  onTopicHintChange: (v: string) => void;
  courseId: string;
  /** Step-1 unit selection — the picker auto-expands these groups. */
  unitIds: string[];
  docs: TeacherDocument[];
  docsLoaded: boolean;
  selectedDocs: Set<string>;
  onToggleDoc: (id: string) => void;
  /** Inline-upload state owned by the parent so it survives Back→Continue. */
  pending: PendingUpload[];
  onFilesSelected: (files: File[]) => void;
  onRetryPending: (item: PendingUpload) => void;
  onDismissPending: (id: string) => void;
  disabled: boolean;
  helperText: string;
  /** Optional controls rendered between Focus and the source-material
   *  picker. The HW wizard slots its advanced generation params here;
   *  the practice flow leaves it undefined. */
  extraControls?: React.ReactNode;
}) {
  // Local draft so the teacher can transiently clear the input (e.g.
  // delete "5" and type "12") without the controlled value snapping
  // back mid-edit. Empty whenever the committed count matches a preset
  // chip — the chip already shows that value, so doubling it in the
  // input reads as a bug. Step 3 mounts/unmounts on Back/Continue, so
  // the initial value derives correctly from the latest committed
  // count without needing a sync effect.
  const isPreset = (QUANTITY_CHIPS as readonly number[]).includes(count);
  const [countDraft, setCountDraft] = useState(isPreset ? "" : String(count));

  const clamp = (v: number) => Math.min(50, Math.max(1, Math.round(v)));
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const noMaterials = docsLoaded && docs.length === 0 && pending.length === 0;

  const handleCountChange = (raw: string) => {
    setCountDraft(raw);
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) {
      onCountChange(clamp(v));
    }
  };

  const handleCountBlur = () => {
    const v = parseInt(countDraft, 10);
    if (Number.isNaN(v)) {
      // Empty/invalid — fall back to the current count, but stay
      // blank when that count is one of the chips (the chip is
      // already showing it).
      setCountDraft(
        (QUANTITY_CHIPS as readonly number[]).includes(count)
          ? ""
          : String(count),
      );
      return;
    }
    setCountDraft(String(clamp(v)));
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-text-muted">{helperText}</p>
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">How many problems?</label>
        <div className="mt-2 flex items-center gap-2">
          {QUANTITY_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onCountChange(n);
                // Clear the input so the chip and the custom field
                // don't both display the same number.
                setCountDraft("");
              }}
              disabled={disabled}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                count === n
                  ? "bg-primary text-white"
                  : "bg-bg-subtle text-text-primary hover:bg-bg-base"
              } disabled:opacity-50`}
            >
              {n}
            </button>
          ))}
          <span className="text-[11px] text-text-muted">or</span>
          <input
            type="number"
            value={countDraft}
            min={1}
            max={50}
            placeholder="custom"
            aria-label="Custom problem count"
            onChange={(e) => handleCountChange(e.target.value)}
            onBlur={handleCountBlur}
            disabled={disabled}
            className="w-20 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Focus <span className="font-normal text-text-muted">· optional</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          Tell the AI what to emphasize.
        </p>
        <input
          type="text"
          value={topicHint}
          onChange={(e) => onTopicHintChange(e.target.value)}
          placeholder="e.g. word problems, real-world contexts, no calculators"
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>

      {extraControls}

      {noMaterials && !materialsOpen ? (
        // The course has no materials yet: one quiet line instead of an
        // empty picker, opened when she wants to add some.
        <div className="flex items-center gap-3 rounded-[--radius-md] border border-dashed border-border-light px-3 py-2 text-xs">
          <span className="font-bold text-text-primary">Source material</span>
          <span className="flex-1 text-text-muted">
            None in this course yet · the AI writes from the unit
          </span>
          <button
            type="button"
            onClick={() => setMaterialsOpen(true)}
            disabled={disabled}
            className="inline-flex min-h-8 items-center font-semibold text-primary hover:underline disabled:opacity-50"
          >
            Add materials
          </button>
        </div>
      ) : (
        <SourceMaterialPicker
          courseId={courseId}
          docs={docs}
          docsLoaded={docsLoaded}
          selectedDocs={selectedDocs}
          unitIds={unitIds}
          onToggleDoc={onToggleDoc}
          pending={pending}
          onFilesSelected={onFilesSelected}
          onRetryPending={onRetryPending}
          onDismissPending={onDismissPending}
          disabled={disabled}
        />
      )}
    </div>
  );
}
