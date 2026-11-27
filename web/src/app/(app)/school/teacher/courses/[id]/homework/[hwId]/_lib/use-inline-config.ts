"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  teacher,
  type HomeworkPoints,
  type TeacherRubric,
  type TeacherSection,
} from "@/lib/api";
import { normalizeRubric } from "@/lib/rubric";
import { evenSplit } from "@/lib/points";
import type { SaveState } from "@/components/school/teacher/_pieces/inline-saved-hint";
import type { PointsChange } from "@/components/school/teacher/_pieces/problem-points";
import type { AssignmentProblem, ConfigField, HomeworkDetail } from "./types";

/**
 * The homework page's inline-edited fields (units, due date, late
 * policy, sections, instructions, rubric, points): each change shows at
 * once, saves, and on failure puts back only that field. Each field has
 * its own save state, so a saving units field doesn't block a due date.
 */
export function useInlineConfig({
  hw,
  setHw,
  assignmentId,
  courseSections,
  problems,
  refreshChecklists,
}: {
  hw: HomeworkDetail | null;
  setHw: Dispatch<SetStateAction<HomeworkDetail | null>>;
  assignmentId: string;
  courseSections: TeacherSection[] | null;
  problems: AssignmentProblem[];
  refreshChecklists: () => Promise<void>;
}) {
  // Per-field save state for the inline-edited config block.
  const [saveStates, setSaveStates] = useState<Record<ConfigField, SaveState>>({
    units: "idle",
    dueAt: "idle",
    latePolicy: "idle",
    sections: "idle",
    rubric: "idle",
    description: "idle",
    points: "idle",
  });
  const [saveErrors, setSaveErrors] = useState<Record<ConfigField, string | null>>({
    units: null,
    dueAt: null,
    latePolicy: null,
    sections: null,
    rubric: null,
    description: null,
    points: null,
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
    units: 0, dueAt: 0, latePolicy: 0, sections: 0, rubric: 0, description: 0, points: 0,
  });
  const patchField = async <K extends ConfigField>(
    field: K,
    applyOptimistic: () => void,
    applyRevert: () => void,
    request: () => Promise<void>,
    /** Re-read server state the save changed. Runs only for the newest
     *  call, after the save stands; its failure never undoes the save. */
    afterSave?: (stillNewest: () => boolean) => Promise<void>,
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
      if (afterSave) {
        void afterSave(() => lastCallRef.current[field] === callId).catch(() => undefined);
      }
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

  // A date or sections change moves the section rows on the server (and
  // the homework's own date with them): re-read both, so the due-date
  // dialog never starts from dates that are no longer there.
  // One sequence for both fields: a date save and a sections save each
  // write the same two values, so only the newest re-read of either lands.
  const dueReadRef = useRef(0);
  const refreshDueDates = async (stillNewest: () => boolean) => {
    const seq = ++dueReadRef.current;
    const fresh = await teacher.assignment(assignmentId);
    if (!stillNewest() || seq !== dueReadRef.current) return;
    setHw((h) =>
      h ? { ...h, due_at: fresh.due_at, section_due_dates: fresh.section_due_dates } : h,
    );
  };

  const onChangeDueAt = (next: string | null) => {
    if (!hw) return;
    const prev = hw.due_at;
    const prevSections = hw.section_due_dates;
    void patchField(
      "dueAt",
      // Exact, not a guess: this picker only shows while every section
      // shares the one date, and the server moves them all to it.
      () =>
        setHw((h) =>
          h
            ? {
                ...h,
                due_at: next,
                section_due_dates: h.section_due_dates.map((d) => ({ ...d, due_at: next })),
              }
            : h,
        ),
      () => setHw((h) => (h ? { ...h, due_at: prev, section_due_dates: prevSections } : h)),
      () =>
        teacher
          .updateAssignment(
            assignmentId,
            next === null ? { clear_due_at: true } : { due_at: next },
          )
          .then(() => undefined),
      refreshDueDates,
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
    const prevNames = hw.section_names;
    // section_names has to move with section_ids. The header reads the
    // names and the Configuration summary reads the ids; patching only
    // one leaves them describing different selections on the same
    // screen — which is how the header ended up promising "All
    // sections" at the moment a teacher narrowed it to one.
    const nextNames = next
      .map((id) => courseSections?.find((s) => s.id === id)?.name)
      .filter((n): n is string => typeof n === "string");
    void patchField(
      "sections",
      () =>
        setHw((h) =>
          h ? { ...h, section_ids: next, section_names: nextNames } : h,
        ),
      () =>
        setHw((h) =>
          h ? { ...h, section_ids: prev, section_names: prevNames } : h,
        ),
      () => teacher.assignToSections(assignmentId, next).then(() => undefined),
      refreshDueDates,
    );
  };

  const onChangeDescription = (next: string) => {
    if (!hw) return;
    // Trim + collapse-to-null so all-whitespace doesn't leave a phantom
    // empty block on the student page. Backend mirrors this.
    const cleaned = next.trim();
    const stored: string | null = cleaned.length > 0 ? cleaned : null;
    if (stored === (hw.description ?? null)) return;
    const prev = hw.description;
    void patchField(
      "description",
      () => setHw((h) => (h ? { ...h, description: stored } : h)),
      () => setHw((h) => (h ? { ...h, description: prev } : h)),
      () =>
        teacher
          .updateAssignment(assignmentId, { description: stored ?? "" })
          .then(() => undefined),
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
          // Skipped or restored class rules change the checklists' links.
          .then(() => refreshChecklists().catch(() => undefined)),
    );
  };

  // Points save like the other inline fields: shown at once, reverted if
  // the server says no. The server also re-adds any saved grades.
  const onChangePoints = (change: PointsChange) => {
    if (!hw) return;
    const prev = hw.points;
    const next: HomeworkPoints =
      "total_points" in change
        ? {
            total: Math.max(change.total_points, problems.length),
            custom: false,
            by_problem: Object.fromEntries(
              evenSplit(change.total_points, problems.length).map((n, i) => [
                problems[i].bank_item_id,
                n,
              ]),
            ),
          }
        : {
            total: Object.values(change.problem_points).reduce((a, b) => a + b, 0),
            custom: true,
            by_problem: change.problem_points,
          };
    void patchField(
      "points",
      () => setHw((h) => (h ? { ...h, points: next } : h)),
      () => setHw((h) => (h ? { ...h, points: prev } : h)),
      // New points resize the graph checklists.
      () =>
        teacher
          .updateAssignment(assignmentId, change)
          .then(() => refreshChecklists().catch(() => undefined)),
    );
  };

  const onChangeProblemPoints = (problemId: string, n: number) => {
    if (!hw) return;
    onChangePoints({ problem_points: { ...hw.points.by_problem, [problemId]: n } });
  };

  return {
    saveStates,
    saveErrors,
    onChangeUnits,
    onChangeDueAt,
    onChangeLatePolicy,
    onChangeSections,
    onChangeDescription,
    onChangeRubric,
    onChangePoints,
    onChangeProblemPoints,
  };
}
