"use client";

import { useEffect, useState } from "react";
import type { TeacherDocument } from "@/lib/api";
import { UnitMultiSelect } from "./unit-multi-select";
import { SectionMultiSelect } from "./section-multi-select";

/**
 * Shared wizard step components used by the New Homework and New
 * Practice creation flows. Both flows collect identical metadata for
 * the scratch path (title, units, due, late policy, sections, count,
 * topic hint, source docs); factoring the two steps here keeps the
 * UI strictly in lockstep while letting each modal wrap them in its
 * own orchestration.
 */

export const LATE_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "penalty_per_day", label: "10% per day" },
  { value: "no_credit", label: "No credit after due" },
];

export const QUANTITY_CHIPS = [5, 10, 15, 20] as const;

// ────────────────────────────────────────────────────────────────────
// Step — Details (title, units, due, late policy, sections)
// ────────────────────────────────────────────────────────────────────

export function AssignmentDetailsStep({
  title,
  onTitleChange,
  courseId,
  unitIds,
  onUnitIdsChange,
  dueAt,
  onDueAtChange,
  latePolicy,
  onLatePolicyChange,
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
  dueAt: string;
  onDueAtChange: (v: string) => void;
  latePolicy: string;
  onLatePolicyChange: (v: string) => void;
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
          Pick one. Multi-select for midterms or review sets that span topics.
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-bold text-text-primary">
            Due date <span className="font-normal text-text-muted">· optional</span>
          </label>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => onDueAtChange(e.target.value)}
            disabled={disabled}
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-text-primary">Late policy</label>
          <select
            value={latePolicy}
            onChange={(e) => onLatePolicyChange(e.target.value)}
            disabled={disabled}
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          >
            {LATE_POLICY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

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
// Step — Problems (count, topic hint, source docs)
// ────────────────────────────────────────────────────────────────────

export function AssignmentProblemsStep({
  count,
  onCountChange,
  topicHint,
  onTopicHintChange,
  docs,
  docsLoaded,
  selectedDocs,
  onToggleDoc,
  disabled,
  helperText,
}: {
  count: number;
  onCountChange: (v: number) => void;
  topicHint: string;
  onTopicHintChange: (v: string) => void;
  docs: TeacherDocument[];
  docsLoaded: boolean;
  selectedDocs: Set<string>;
  onToggleDoc: (id: string) => void;
  disabled: boolean;
  helperText: string;
}) {
  // Local draft so the teacher can transiently clear the input (e.g.
  // delete "5" and type "12") without the controlled value snapping
  // back mid-edit. Commit to parent on any valid parse, fall back to
  // the last committed count on blur if left empty.
  const [countDraft, setCountDraft] = useState(String(count));
  useEffect(() => {
    setCountDraft(String(count));
  }, [count]);

  const clamp = (v: number) => Math.min(50, Math.max(1, Math.round(v)));

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
      setCountDraft(String(count));
    } else {
      setCountDraft(String(clamp(v)));
    }
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
              onClick={() => onCountChange(n)}
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
          <input
            type="number"
            value={countDraft}
            min={1}
            max={50}
            onChange={(e) => handleCountChange(e.target.value)}
            onBlur={handleCountBlur}
            disabled={disabled}
            className="w-20 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Topic hint <span className="font-normal text-text-muted">· optional</span>
        </label>
        <input
          type="text"
          value={topicHint}
          onChange={(e) => onTopicHintChange(e.target.value)}
          placeholder="e.g. Focus on word problems with real-world contexts"
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-text-primary">
          Source material <span className="font-normal text-text-muted">· optional</span>
        </label>
        {!docsLoaded ? (
          <p className="mt-2 text-[11px] text-text-muted">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="mt-2 text-[11px] text-text-muted">
            No documents in this course. Upload images in the Materials tab to
            ground generated problems in your own content.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {docs.map((d) => {
              const on = selectedDocs.has(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onToggleDoc(d.id)}
                  disabled={disabled}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    on
                      ? "bg-primary text-white"
                      : "bg-bg-subtle text-text-primary hover:bg-bg-base"
                  } disabled:opacity-50`}
                >
                  {d.filename}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
