"use client";

import { useState } from "react";
import { sectionTargetLabel } from "@/lib/utils";
import {
  type TeacherAssignment,
  type TeacherSection,
} from "@/lib/api";
import { UnitMultiSelect } from "@/components/school/teacher/_pieces/unit-multi-select";
import { SectionMultiSelect } from "@/components/school/teacher/_pieces/section-multi-select";
import { InlineSavedHint, type SaveState } from "@/components/school/teacher/_pieces/inline-saved-hint";
import type { ConfigField } from "../_lib/types";

// What each late policy does (api/core/late_policy.py). The hint is
// shown under the picker for the selected one, so the label stays short.
const LATE_POLICY_OPTIONS: { value: string; label: string; hint: string }[] = [
  {
    value: "none",
    label: "Accept any time, no penalty",
    hint: "Late work is accepted and marked late. Nothing comes off the score.",
  },
  {
    value: "penalty_per_day",
    label: "−10% per day late",
    hint:
      "Late work takes 10% off the score for each day late, and any part of a day counts: " +
      "85% turned in a day late is 76.5%, and it takes all of it at 10 days. It shows as its own line on each grade, and you can " +
      "waive it per student.",
  },
  {
    value: "no_credit",
    label: "Closed after due date",
    hint:
      "Students can't turn it in after the due date. Work already turned in keeps its grade — " +
      "late work is marked late, never zeroed. Without a due date it never closes.",
  },
];

// ────────────────────────────────────────────────────────────────────
// Compact one-line summary of the HW's configuration — shows in the
// collapsed Settings accordion so teachers can see the gist without
// expanding. Keep it dense; this is a scan line, not a form.
// ────────────────────────────────────────────────────────────────────
export function configSummary(
  hw: TeacherAssignment,
  courseSectionCount: number | null,
  dueBySection = false,
): string {
  const parts: string[] = [];
  parts.push(`${hw.unit_ids.length} unit${hw.unit_ids.length === 1 ? "" : "s"}`);
  // Practice has no deadline concept — skip the due-date part
  // entirely rather than show "No due date" on every practice card.
  if (hw.type !== "practice") {
    if (hw.due_at && dueBySection) {
      parts.push("Due by section");
    } else if (hw.due_at) {
      const d = new Date(hw.due_at);
      parts.push(
        `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      );
    } else {
      parts.push("No due date");
    }
  }
  parts.push(
    hw.section_ids.length > 0
      ? `${hw.section_ids.length} section${hw.section_ids.length === 1 ? "" : "s"}`
      : sectionTargetLabel({
          selectedNames: [],
          status: hw.status,
          courseSectionCount,
        }).label,
  );
  return parts.join(" · ");
}

// ────────────────────────────────────────────────────────────────────
// Collapsible — lightweight accordion wrapper for the Settings card.
// `defaultOpen` is captured into state at mount so it doesn't flip
// when the teacher toggles it manually.
// ────────────────────────────────────────────────────────────────────
export function CollapsibleSection({
  label,
  summary,
  defaultOpen,
  children,
}: {
  label: string;
  summary?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            {label}
          </span>
          {summary && !open && (
            <span className="text-xs text-text-secondary">{summary}</span>
          )}
        </div>
        <span className="text-xs text-text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-border-light p-5">{children}</div>
      )}
    </div>
  );
}

// ── Configuration block ──

export function ConfigBlock({
  hw,
  courseId,
  courseSections,
  disabled,
  saveStates,
  saveErrors,
  dueDateInputRef,
  onChangeUnits,
  onChangeDueAt,
  onChangeLatePolicy,
  onChangeSections,
  dueBySection,
  onOpenDueDates,
}: {
  hw: TeacherAssignment;
  courseId: string;
  courseSections: TeacherSection[] | null;
  disabled: boolean;
  saveStates: Record<ConfigField, SaveState>;
  saveErrors: Record<ConfigField, string | null>;
  dueDateInputRef?: React.Ref<HTMLInputElement>;
  onChangeUnits: (next: string[]) => void;
  onChangeDueAt: (next: string | null) => void;
  onChangeLatePolicy: (next: string) => void;
  onChangeSections: (next: string[]) => void;
  /** Sections have different dates: one picker here would overwrite
   *  them, so the dialog edits them instead. */
  dueBySection: boolean;
  onOpenDueDates: () => void;
}) {
  return (
    <div className="space-y-5 rounded-[--radius-md] border border-border-light bg-surface/30 p-4">
      {/* Units */}
      <Field
        label="Units"
        required
        hint={
          saveStates.units === "idle" && hw.unit_ids.length === 0
            ? "Required — at least one unit"
            : undefined
        }
        saveState={saveStates.units}
        saveError={saveErrors.units}
      >
        <UnitMultiSelect
          courseId={courseId}
          selected={hw.unit_ids}
          onChange={onChangeUnits}
          disabled={disabled}
        />
      </Field>

      {/* Due date — hidden for practice: practice is ungraded and
          has no deadline concept. */}
      {hw.type !== "practice" && (
        <Field
          label="Due date"
          saveState={saveStates.dueAt}
          saveError={saveErrors.dueAt}
        >
          {dueBySection ? (
            <p className="text-sm text-text-secondary">
              Different per section.{" "}
              <button
                type="button"
                onClick={onOpenDueDates}
                className="font-semibold text-primary hover:underline"
              >
                Change
              </button>
            </p>
          ) : (
            <DueDatePicker
              value={hw.due_at}
              onChange={onChangeDueAt}
              disabled={disabled}
              inputRef={dueDateInputRef}
            />
          )}
        </Field>
      )}

      {/* Late policy — hidden for practice: nothing can be late
          when there's no due date. */}
      {hw.type !== "practice" && (
        <Field
          label="Late policy"
          hint={LATE_POLICY_OPTIONS.find((o) => o.value === hw.late_policy)?.hint}
          saveState={saveStates.latePolicy}
          saveError={saveErrors.latePolicy}
        >
          <div className="flex flex-wrap gap-1.5">
            {LATE_POLICY_OPTIONS.map((opt) => {
              const active = hw.late_policy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeLatePolicy(opt.value)}
                  disabled={disabled}
                  className={`rounded-[--radius-pill] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary bg-primary text-white"
                      : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-[color:var(--color-surface-alt-2)]"
                  }`}
                >
                  {active && <span className="mr-1">✓</span>}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {/* Sections */}
      <Field
        label="Sections"
        hint={
          hw.section_ids.length > 0 || hw.status === "published"
            ? undefined
            : "Leave empty to publish to every section in this course"
        }
        saveState={saveStates.sections}
        saveError={saveErrors.sections}
      >
        <SectionMultiSelect
          courseId={courseId}
          sections={courseSections}
          selected={hw.section_ids}
          onChange={onChangeSections}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  saveState,
  saveError,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  saveState: SaveState;
  saveError: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          {label}
          {required && (
            <span className="ml-1 font-normal normal-case text-text-muted/70">· required</span>
          )}
        </span>
        <InlineSavedHint state={saveState} errorMessage={saveError} />
      </div>
      {children}
      {hint && saveState === "idle" && (
        <p className="mt-1 text-[10px] text-text-muted">{hint}</p>
      )}
    </div>
  );
}

// Native datetime-local picker. The browser handles localization and
// the mobile experience. Returns null when cleared.
function DueDatePicker({
  value,
  onChange,
  disabled,
  inputRef,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  // Snapshot "now" once at mount so the render stays pure (Date.now()
  // in render trips react-hooks/purity). The modal is short-lived
  // enough that a stale snapshot is fine — the warning is informational
  // and the only edge case is "user picks a future date that becomes
  // past while the modal stays open for hours," which we don't care
  // about.
  const [now] = useState(() => Date.now());
  // datetime-local needs YYYY-MM-DDTHH:mm — drop the timezone suffix.
  const localValue = value ? toLocalDatetimeInputValue(value) : "";
  const isPast = value !== null && new Date(value).getTime() < now;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="datetime-local"
        value={localValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onChange(null);
            return;
          }
          // Parse the local-time string back to an ISO with the
          // browser's local timezone offset baked in.
          const d = new Date(v);
          if (Number.isNaN(d.getTime())) return;
          onChange(d.toISOString());
        }}
        disabled={disabled}
        className="rounded-[--radius-md] border border-border-light bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[11px] font-semibold text-text-muted hover:text-text-primary"
        >
          Clear
        </button>
      )}
      {isPast && !disabled && (
        <span className="text-[10px] font-semibold text-[color:var(--color-warning-dark)]">
          ⚠ in the past
        </span>
      )}
    </div>
  );
}

function toLocalDatetimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
