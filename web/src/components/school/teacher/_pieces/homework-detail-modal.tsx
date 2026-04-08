"use client";

import { useEffect, useRef, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { teacher, type TeacherAssignment } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { BankPicker } from "./bank-picker";
import { UnitMultiSelect } from "./unit-multi-select";
import { SectionMultiSelect } from "./section-multi-select";
import { InlineSavedHint, type SaveState } from "./inline-saved-hint";

interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
  difficulty: string;
}

const LATE_POLICY_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "penalty_per_day", label: "10% per day" },
  { value: "no_credit", label: "No credit after due" },
];

// The four inline-editable config fields. Each has its own SaveState
// so a saving units field doesn't block a separate due-date edit.
type ConfigField = "units" | "dueAt" | "latePolicy" | "sections";

/**
 * Detail modal for an existing homework. v2: full lifecycle config
 * (units, due date, late policy, sections) inline-editable, fat
 * problem cards matching the question bank visual, publish gating
 * tooltip listing what's missing, Submissions placeholder for the
 * future grading view.
 *
 * Reused from question-bank-tab so the Used-in pills can open
 * homework directly without navigation.
 */
export function HomeworkDetailModal({
  courseId,
  assignmentId,
  onClose,
  onChanged,
}: {
  courseId: string;
  assignmentId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [hw, setHw] = useState<(TeacherAssignment & { content: unknown }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingProblems, setEditingProblems] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();

  // Per-field save state for the inline-edited config block.
  const [saveStates, setSaveStates] = useState<Record<ConfigField, SaveState>>({
    units: "idle",
    dueAt: "idle",
    latePolicy: "idle",
    sections: "idle",
  });
  const [saveErrors, setSaveErrors] = useState<Record<ConfigField, string | null>>({
    units: null,
    dueAt: null,
    latePolicy: null,
    sections: null,
  });

  const reload = async () => {
    setLoading(true);
    try {
      const a = await teacher.assignment(assignmentId);
      setHw(a);
      setTitleDraft(a.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load homework");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const problems: AssignmentProblem[] =
    hw?.content && typeof hw.content === "object" && "problems" in hw.content
      ? ((hw.content as { problems: AssignmentProblem[] }).problems ?? [])
      : [];

  const isPublished = hw?.status === "published";

  const saveTitle = () =>
    run(async () => {
      const t = titleDraft.trim();
      if (!t) {
        setError("Title cannot be empty");
        return;
      }
      if (t === hw?.title) {
        setEditingTitle(false);
        return;
      }
      await teacher.updateAssignment(assignmentId, { title: t });
      setEditingTitle(false);
      await reload();
      onChanged();
    });

  const saveProblems = (newPicked: string[]) =>
    run(async () => {
      if (newPicked.length === 0) {
        setError("Pick at least one question");
        return;
      }
      await teacher.updateAssignment(assignmentId, { bank_item_ids: newPicked });
      setEditingProblems(false);
      await reload();
      onChanged();
    });

  const remove = () =>
    run(async () => {
      await teacher.deleteAssignment(assignmentId);
      onClose();
      onChanged();
    });

  const publish = () =>
    run(async () => {
      await teacher.publishAssignment(assignmentId);
      await reload();
      onChanged();
    });

  const unpublish = () =>
    run(async () => {
      await teacher.unpublishAssignment(assignmentId);
      await reload();
      onChanged();
    });

  // Inline auto-save runner. Optimistic — bumps the local hw state
  // immediately so the UI feels instant, then PATCHes. On failure,
  // reverts and surfaces the error against the field. The most recent
  // call wins (debounced via ref) — useful for the date picker which
  // can fire many onChange events.
  const lastCallRef = useRef<Record<ConfigField, number>>({
    units: 0, dueAt: 0, latePolicy: 0, sections: 0,
  });
  const patchField = async <K extends ConfigField>(
    field: K,
    optimistic: (prev: TeacherAssignment) => TeacherAssignment,
    request: () => Promise<void>,
  ) => {
    if (!hw) return;
    const callId = ++lastCallRef.current[field];
    const prevHw = hw;
    setHw({ ...optimistic(hw), content: hw.content });
    setSaveStates((s) => ({ ...s, [field]: "saving" }));
    setSaveErrors((s) => ({ ...s, [field]: null }));
    try {
      await request();
      // If a newer call superseded us, drop our result silently.
      if (lastCallRef.current[field] !== callId) return;
      setSaveStates((s) => ({ ...s, [field]: "saved" }));
      onChanged();
    } catch (e) {
      if (lastCallRef.current[field] !== callId) return;
      setHw(prevHw);
      setSaveStates((s) => ({ ...s, [field]: "error" }));
      setSaveErrors((s) => ({
        ...s,
        [field]: e instanceof Error ? e.message : "Save failed",
      }));
    }
  };

  const onChangeUnits = (next: string[]) => {
    if (next.length === 0) {
      setSaveStates((s) => ({ ...s, units: "error" }));
      setSaveErrors((s) => ({ ...s, units: "At least one unit is required" }));
      return;
    }
    void patchField(
      "units",
      (prev) => ({ ...prev, unit_ids: next }),
      () => teacher.updateAssignment(assignmentId, { unit_ids: next }).then(() => undefined),
    );
  };

  const onChangeDueAt = (next: string | null) => {
    void patchField(
      "dueAt",
      (prev) => ({ ...prev, due_at: next }),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            next === null ? { clear_due_at: true } : { due_at: next },
          )
          .then(() => undefined),
    );
  };

  const onChangeLatePolicy = (next: string) => {
    void patchField(
      "latePolicy",
      (prev) => ({ ...prev, late_policy: next }),
      () =>
        teacher
          .updateAssignment(assignmentId, { late_policy: next })
          .then(() => undefined),
    );
  };

  const onChangeSections = (next: string[]) => {
    void patchField(
      "sections",
      (prev) => ({ ...prev, section_ids: next }),
      () => teacher.assignToSections(assignmentId, next).then(() => undefined),
    );
  };

  // Publish gating — list of missing requirements with concrete fixes.
  const missingForPublish: string[] = [];
  if (hw) {
    if (problems.length === 0) missingForPublish.push("at least one problem");
    if (hw.unit_ids.length === 0) missingForPublish.push("a unit");
    if (hw.section_ids.length === 0) missingForPublish.push("a section");
  }
  const canPublish = !isPublished && missingForPublish.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border-light px-6 py-3">
          {hw && (
            <span
              className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
                isPublished
                  ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-500/10"
              }`}
            >
              {hw.status}
            </span>
          )}
          {editingTitle ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveTitle();
              }}
            >
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                autoFocus
                maxLength={300}
                className="flex-1 rounded-[--radius-md] border border-primary bg-bg-base px-3 py-1.5 text-sm font-bold text-text-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-[--radius-sm] bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingTitle(false);
                  setTitleDraft(hw?.title ?? "");
                }}
                className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              disabled={loading || isPublished}
              title={isPublished ? "Unpublish to edit" : "Click to edit"}
              className="flex-1 cursor-text text-left text-base font-bold text-text-primary hover:text-primary disabled:cursor-default disabled:hover:text-text-primary"
            >
              {hw?.title ?? "Loading…"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading || !hw ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : editingProblems ? (
            <EditProblemsView
              courseId={courseId}
              currentBankIds={problems.map((p) => p.bank_item_id)}
              onCancel={() => setEditingProblems(false)}
              onSave={saveProblems}
              busy={busy}
            />
          ) : (
            <>
              {isPublished && (
                <div className="mb-5 rounded-[--radius-md] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  🔒 This homework is published. Students can see it and the
                  questions inside are locked. Unpublish it to edit.
                </div>
              )}

              {/* Configuration block */}
              <ConfigBlock
                hw={hw}
                courseId={courseId}
                disabled={isPublished}
                saveStates={saveStates}
                saveErrors={saveErrors}
                onChangeUnits={onChangeUnits}
                onChangeDueAt={onChangeDueAt}
                onChangeLatePolicy={onChangeLatePolicy}
                onChangeSections={onChangeSections}
              />

              {/* Problems block */}
              <div className="mt-6">
                <div className="flex items-baseline justify-between border-b border-border-light pb-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Problems · {problems.length}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingProblems(true)}
                    disabled={isPublished}
                    title={isPublished ? "Unpublish to edit" : ""}
                    className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline"
                  >
                    ✏ Edit problems
                  </button>
                </div>

                {problems.length === 0 ? (
                  <p className="mt-4 text-xs italic text-text-muted">
                    No problems on this homework. Click Edit problems to add some.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {problems.map((p) => (
                      <ProblemRow key={`${p.bank_item_id}-${p.position}`} problem={p} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        {!editingProblems && hw && (
          <div className="flex items-center justify-between gap-2 border-t border-border-light px-6 py-3">
            <div className="flex items-center gap-2">
              {isPublished ? (
                <button
                  type="button"
                  onClick={unpublish}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={publish}
                  disabled={busy || !canPublish}
                  title={
                    canPublish
                      ? "Publish — locks the questions in the bank"
                      : `Missing: ${missingForPublish.join(", ")}`
                  }
                  className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Publish ▸
                </button>
              )}
              <button
                type="button"
                disabled
                title="Coming soon"
                className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-muted disabled:opacity-50"
              >
                ⚙ Submissions
              </button>
            </div>
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-700">
                  Delete this homework?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Yes, delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={isPublished}
                title={isPublished ? "Unpublish before deleting" : ""}
                className="rounded-[--radius-md] border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                🗑 Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Configuration block ──

function ConfigBlock({
  hw,
  courseId,
  disabled,
  saveStates,
  saveErrors,
  onChangeUnits,
  onChangeDueAt,
  onChangeLatePolicy,
  onChangeSections,
}: {
  hw: TeacherAssignment;
  courseId: string;
  disabled: boolean;
  saveStates: Record<ConfigField, SaveState>;
  saveErrors: Record<ConfigField, string | null>;
  onChangeUnits: (next: string[]) => void;
  onChangeDueAt: (next: string | null) => void;
  onChangeLatePolicy: (next: string) => void;
  onChangeSections: (next: string[]) => void;
}) {
  return (
    <div className="space-y-5 rounded-[--radius-md] border border-border-light bg-bg-base/30 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
        Configuration
      </div>

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

      {/* Due date */}
      <Field
        label="Due date"
        saveState={saveStates.dueAt}
        saveError={saveErrors.dueAt}
      >
        <DueDatePicker
          value={hw.due_at}
          onChange={onChangeDueAt}
          disabled={disabled}
        />
      </Field>

      {/* Late policy */}
      <Field
        label="Late policy"
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
                    : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle"
                }`}
              >
                {active && <span className="mr-1">✓</span>}
                {opt.label}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Sections */}
      <Field
        label="Sections"
        hint={
          hw.section_ids.length === 0
            ? "No sections assigned — required to publish"
            : undefined
        }
        saveState={saveStates.sections}
        saveError={saveErrors.sections}
      >
        <SectionMultiSelect
          courseId={courseId}
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
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
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
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
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
        className="rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
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
        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
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

// ── Problem row ──
//
// Fat card with the math-rendered question as the focal element.
// Mirrors approved-tree's ProblemCard but read-only (clicking does
// nothing — editing happens via the Edit problems button).
function ProblemRow({ problem }: { problem: AssignmentProblem }) {
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
          {problem.position}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] leading-snug text-text-primary">
            <MathText text={problem.question} />
          </div>
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {problem.difficulty}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit problems sub-view ──

function EditProblemsView({
  courseId,
  currentBankIds,
  onCancel,
  onSave,
  busy,
}: {
  courseId: string;
  currentBankIds: string[];
  onCancel: () => void;
  onSave: (next: string[]) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(currentBankIds);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Edit problems
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(picked)}
            disabled={busy}
            className="rounded-[--radius-sm] bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <BankPicker courseId={courseId} picked={picked} onChange={setPicked} />
    </div>
  );
}
