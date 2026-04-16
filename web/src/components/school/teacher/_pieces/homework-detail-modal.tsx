"use client";

import { useEffect, useRef, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type GradingMode,
  type TeacherAssignment,
  type TeacherRubric,
} from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { BankPicker } from "./bank-picker";
import { UnitMultiSelect } from "./unit-multi-select";
import { SectionMultiSelect } from "./section-multi-select";
import { InlineSavedHint, type SaveState } from "./inline-saved-hint";
import { SubmissionsPanel } from "./submissions-panel";

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

const GRADING_MODE_OPTIONS: { value: GradingMode; label: string; hint: string }[] = [
  { value: "answer_only", label: "Answer only", hint: "Just grade the final number/expression" },
  { value: "answer_and_work", label: "Answer + work", hint: "Both matter; partial credit for correct method" },
  { value: "method_focused", label: "Method-focused", hint: "Approach matters more than the final answer" },
  { value: "custom", label: "Custom", hint: "I'll describe the criteria below" },
];

// The five inline-editable config fields. Each has its own SaveState
// so a saving units field doesn't block a separate due-date edit.
type ConfigField = "units" | "dueAt" | "latePolicy" | "sections" | "rubric";

/** Collapse a partial rubric into a normalized dict. Drops empty-string
 *  values so the stored shape stays tight — but keeps explicit nulls
 *  on grading_mode since "unset" is a meaningful state. */
function normalizeRubric(r: TeacherRubric): TeacherRubric {
  const out: TeacherRubric = {};
  if (r.grading_mode) out.grading_mode = r.grading_mode;
  const s = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  if (s(r.full_credit)) out.full_credit = s(r.full_credit);
  if (s(r.partial_credit)) out.partial_credit = s(r.partial_credit);
  if (s(r.common_mistakes)) out.common_mistakes = s(r.common_mistakes);
  if (s(r.notes)) out.notes = s(r.notes);
  return out;
}

function isRubricEmpty(r: TeacherRubric | null | undefined): boolean {
  if (!r) return true;
  return Object.keys(normalizeRubric(r)).length === 0;
}

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
  const [hw, setHw] = useState<
    (TeacherAssignment & { content: unknown; rubric: TeacherRubric | null }) | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingProblems, setEditingProblems] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showingSubmissions, setShowingSubmissions] = useState(false);
  // Confirm dialog for "publish without due date" — common mistake we
  // catch with a soft confirm rather than blocking, because no-due-date
  // HWs are a real legitimate use case (in-class, untimed practice).
  const [confirmingNoDueDate, setConfirmingNoDueDate] = useState(false);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAsyncAction();

  // Per-field save state for the inline-edited config block.
  const [saveStates, setSaveStates] = useState<Record<ConfigField, SaveState>>({
    units: "idle",
    dueAt: "idle",
    latePolicy: "idle",
    sections: "idle",
    rubric: "idle",
  });
  const [saveErrors, setSaveErrors] = useState<Record<ConfigField, string | null>>({
    units: null,
    dueAt: null,
    latePolicy: null,
    sections: null,
    rubric: null,
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
      setConfirmingNoDueDate(false);
      await reload();
      onChanged();
    });

  // Click handler for the Publish button. If the HW has no due date,
  // intercept and show a soft confirm — most "no due date" publishes
  // are mistakes, but it IS a valid choice (in-class work, ongoing
  // practice). Click "Publish anyway" in the confirm to proceed.
  const handlePublishClick = () => {
    if (hw && hw.due_at === null) {
      setConfirmingNoDueDate(true);
      return;
    }
    publish();
  };

  const unpublish = () =>
    run(async () => {
      await teacher.unpublishAssignment(assignmentId);
      await reload();
      onChanged();
    });

  // Inline auto-save runner. Optimistic — applies the change to the
  // local hw state immediately, fires the PATCH, and on failure
  // restores ONLY this field (via the caller-supplied applyRevert).
  //
  // Per-field revert (vs replacing the whole hw object) is important:
  // if two fields are edited concurrently and the second succeeds
  // before the first fails, a whole-hw revert would wipe out the
  // second's optimistic update. Field-scoped revert leaves the
  // unrelated success intact.
  //
  // Per-field lastCallRef gives last-write-wins for rapid-fire edits
  // to the same field (the date picker can fire many onChanges).
  const lastCallRef = useRef<Record<ConfigField, number>>({
    units: 0, dueAt: 0, latePolicy: 0, sections: 0, rubric: 0,
  });
  const patchField = async <K extends ConfigField>(
    field: K,
    applyOptimistic: () => void,
    applyRevert: () => void,
    request: () => Promise<void>,
  ) => {
    const callId = ++lastCallRef.current[field];
    applyOptimistic();
    setSaveStates((s) => ({ ...s, [field]: "saving" }));
    setSaveErrors((s) => ({ ...s, [field]: null }));
    try {
      await request();
      // If a newer call for this field superseded us, drop silently.
      if (lastCallRef.current[field] !== callId) return;
      setSaveStates((s) => ({ ...s, [field]: "saved" }));
      onChanged();
    } catch (e) {
      if (lastCallRef.current[field] !== callId) return;
      applyRevert();
      setSaveStates((s) => ({ ...s, [field]: "error" }));
      setSaveErrors((s) => ({
        ...s,
        [field]: e instanceof Error ? e.message : "Save failed",
      }));
    }
  };

  const onChangeUnits = (next: string[]) => {
    if (!hw) return;
    if (next.length === 0) {
      setSaveStates((s) => ({ ...s, units: "error" }));
      setSaveErrors((s) => ({ ...s, units: "At least one unit is required" }));
      return;
    }
    const prev = hw.unit_ids;
    void patchField(
      "units",
      () => setHw((h) => (h ? { ...h, unit_ids: next } : h)),
      () => setHw((h) => (h ? { ...h, unit_ids: prev } : h)),
      () =>
        teacher.updateAssignment(assignmentId, { unit_ids: next }).then(() => undefined),
    );
  };

  const onChangeDueAt = (next: string | null) => {
    if (!hw) return;
    const prev = hw.due_at;
    void patchField(
      "dueAt",
      () => setHw((h) => (h ? { ...h, due_at: next } : h)),
      () => setHw((h) => (h ? { ...h, due_at: prev } : h)),
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
    if (!hw) return;
    const prev = hw.late_policy;
    void patchField(
      "latePolicy",
      () => setHw((h) => (h ? { ...h, late_policy: next } : h)),
      () => setHw((h) => (h ? { ...h, late_policy: prev } : h)),
      () =>
        teacher
          .updateAssignment(assignmentId, { late_policy: next })
          .then(() => undefined),
    );
  };

  const onChangeSections = (next: string[]) => {
    if (!hw) return;
    const prev = hw.section_ids;
    void patchField(
      "sections",
      () => setHw((h) => (h ? { ...h, section_ids: next } : h)),
      () => setHw((h) => (h ? { ...h, section_ids: prev } : h)),
      () => teacher.assignToSections(assignmentId, next).then(() => undefined),
    );
  };

  const onChangeRubric = (patch: Partial<TeacherRubric>) => {
    if (!hw) return;
    const prev = hw.rubric;
    const merged = normalizeRubric({ ...(prev ?? {}), ...patch });
    // No-op if nothing actually changed — prevents a save round-trip
    // when a textarea blurs with unchanged content.
    if (JSON.stringify(merged) === JSON.stringify(normalizeRubric(prev ?? {}))) return;
    // If the teacher cleared every field, null the server-side rubric
    // so it reflects "no rubric authored" rather than `{}` (which the
    // server happily persists but is semantically different).
    const empty = Object.keys(merged).length === 0;
    const next: TeacherRubric | null = empty ? null : merged;
    void patchField(
      "rubric",
      () => setHw((h) => (h ? { ...h, rubric: next } : h)),
      () => setHw((h) => (h ? { ...h, rubric: prev } : h)),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            empty ? { clear_rubric: true } : { rubric: merged },
          )
          .then(() => undefined),
    );
  };

  // Publish gating — list of missing requirements with concrete fixes.
  // Sections are NOT required: the backend fans out to every section
  // in the course when the teacher publishes with an empty list. The
  // picker is for exclusions ("Period 5 doesn't get this yet"), not
  // the happy path.
  const missingForPublish: string[] = [];
  if (hw) {
    if (problems.length === 0) missingForPublish.push("at least one problem");
    if (hw.unit_ids.length === 0) missingForPublish.push("a unit");
  }
  const canPublish = !isPublished && missingForPublish.length === 0;

  return (
    <>
    {showingSubmissions && (
      <SubmissionsPanel
        assignmentId={assignmentId}
        onClose={() => setShowingSubmissions(false)}
      />
    )}
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
                dueDateInputRef={dueDateInputRef}
                onChangeUnits={onChangeUnits}
                onChangeDueAt={onChangeDueAt}
                onChangeLatePolicy={onChangeLatePolicy}
                onChangeSections={onChangeSections}
              />

              {/* Rubric block — collapsed by default when empty so it
                  doesn't crowd the top of the modal. Rubric edits are
                  allowed even on published HWs (intentionally — see
                  backend grade_submission handler notes). */}
              <div className="mt-4">
                <RubricBlock
                  rubric={hw.rubric}
                  saveState={saveStates.rubric}
                  saveError={saveErrors.rubric}
                  onChange={onChangeRubric}
                />
              </div>

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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-light px-6 py-3">
            {confirmingNoDueDate ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  ⚠ Publish without a due date? Students will see this as
                  &ldquo;no due date&rdquo;.
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingNoDueDate(false);
                      // Focus the date input + scroll it into view so the
                      // teacher can fix it without hunting.
                      setTimeout(() => {
                        dueDateInputRef.current?.focus();
                        dueDateInputRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }, 0);
                    }}
                    disabled={busy}
                    className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
                  >
                    Add due date
                  </button>
                  <button
                    type="button"
                    onClick={publish}
                    disabled={busy}
                    className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Publish anyway
                  </button>
                </div>
              </div>
            ) : (
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
                    onClick={handlePublishClick}
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
                  onClick={() => setShowingSubmissions(true)}
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-primary hover:text-primary"
                >
                  ⚙ Submissions
                </button>
              </div>
            )}
            {/* Right side hidden while the no-due-date confirm is up
                so the two confirms don't compete for the row. */}
            {!confirmingNoDueDate &&
              (confirmingDelete ? (
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
              ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

// ── Configuration block ──

function ConfigBlock({
  hw,
  courseId,
  disabled,
  saveStates,
  saveErrors,
  dueDateInputRef,
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
  dueDateInputRef?: React.Ref<HTMLInputElement>;
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
          inputRef={dueDateInputRef}
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
            ? "Leave empty to publish to every section in this course"
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
// Read-only — clicking does nothing; editing happens via the Edit
// problems button at the top of this modal.
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

// ── Rubric block ──
//
// Collapsible grading rubric editor. Empty rubric → collapsed with a
// prompt; non-empty rubric → expanded by default. Each text field
// saves on blur via onChange({field: value}); grading_mode saves
// immediately on chip click. The parent handler merges the patch into
// the existing rubric and normalizes (empty string = unset, all empty
// = clear rubric entirely).
function RubricBlock({
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
  const [expanded, setExpanded] = useState(() => !isRubricEmpty(rubric));

  return (
    <div className="rounded-[--radius-md] border border-border-light bg-bg-base/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Grading rubric
          </span>
          <InlineSavedHint state={saveState} errorMessage={saveError} />
          {!expanded && isRubricEmpty(rubric) && (
            <span className="text-[11px] text-text-muted">· none yet — click to add</span>
          )}
        </div>
        <span className="text-xs text-text-muted">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && (
        <div className="space-y-4 border-t border-border-light p-4">
          {/* Grading mode chips */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Grading mode
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {GRADING_MODE_OPTIONS.map((opt) => {
                const active = rubric?.grading_mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      // Click the active chip to unset — `undefined`
                      // flows through normalizeRubric and drops the
                      // grading_mode key server-side.
                      onChange({ grading_mode: active ? undefined : opt.value })
                    }
                    title={active ? "Click to unset" : opt.hint}
                    className={`rounded-[--radius-pill] border px-2.5 py-1 text-xs font-semibold transition-colors ${
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
          </div>

          <RubricField
            label="Full credit"
            placeholder="e.g. Correct answer AND shown work"
            value={rubric?.full_credit}
            onCommit={(v) => onChange({ full_credit: v })}
          />
          <RubricField
            label="Partial credit"
            placeholder="e.g. Right setup, arithmetic error"
            value={rubric?.partial_credit}
            onCommit={(v) => onChange({ partial_credit: v })}
          />
          <RubricField
            label="Common mistakes"
            hint="optional — help the AI grader catch specific errors"
            placeholder="e.g. Mixing up slope and y-intercept"
            value={rubric?.common_mistakes}
            onCommit={(v) => onChange({ common_mistakes: v })}
          />
          <RubricField
            label="Notes"
            hint="optional — anything else the AI grader should know"
            placeholder=""
            value={rubric?.notes}
            onCommit={(v) => onChange({ notes: v })}
          />
        </div>
      )}
    </div>
  );
}

function RubricField({
  label,
  hint,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  value: string | undefined;
  onCommit: (next: string) => void;
}) {
  // Local state for in-progress typing; commit on blur so we don't
  // round-trip the API on every keystroke.
  const [draft, setDraft] = useState(value ?? "");
  // Keep local state in sync when the server-side value changes (e.g.
  // another tab saved, or the HW reloaded). Guard against clobbering
  // active typing via a ref to the last committed value.
  const lastCommittedRef = useRef(value ?? "");
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      lastCommittedRef.current = value ?? "";
      setDraft(value ?? "");
    }
  }, [value]);

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {label}
        {hint && (
          <span className="ml-1 font-normal normal-case text-text-muted/70">· {hint}</span>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== lastCommittedRef.current) {
            lastCommittedRef.current = draft;
            onCommit(draft);
          }
        }}
        placeholder={placeholder}
        rows={2}
        className="mt-1.5 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
      />
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
