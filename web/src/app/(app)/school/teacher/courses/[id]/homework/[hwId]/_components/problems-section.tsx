"use client";

import { MAX_TOTAL_POINTS } from "@/lib/points";
import type { TeacherRubric } from "@/lib/api";
import type { SaveState } from "@/components/school/teacher/_pieces/inline-saved-hint";
import { GradingSetupCard } from "@/components/school/teacher/_pieces/grading-setup-card";
import {
  PointsTotalBar,
  type PointsChange,
} from "@/components/school/teacher/_pieces/problem-points";
import type { AssignmentProblem, ConfigField, HomeworkDetail } from "../_lib/types";
import { ProblemRow } from "./problem-row";
import { ProblemsAwaitingNote, ProblemsEmptyHero } from "./problems-heroes";

/**
 * Problems & grading — the hero of the homework page. Holds every
 * grading decision for a homework: what each problem is worth, its
 * answer key, and the rules for every problem. Practice is ungraded, so
 * it keeps a plain problem list.
 */
export function ProblemsSection({
  hw,
  problems,
  courseId,
  assignmentId,
  graded,
  isPublished,
  awaitingProblems,
  saveStates,
  saveErrors,
  onChangePoints,
  onChangeProblemPoints,
  onChangeRubric,
  onGenerate,
  onAddFromBank,
  onRemoveProblems,
  onEditProblem,
  checklistsLookedAgain,
  onChecklistChanged,
  reveal,
}: {
  hw: HomeworkDetail;
  problems: AssignmentProblem[];
  courseId: string;
  assignmentId: string;
  graded: boolean;
  isPublished: boolean;
  /** Problems are being generated or wait in the review queue: the
   *  banner above is the call to action, so an empty list stays quiet. */
  awaitingProblems: boolean;
  saveStates: Record<ConfigField, SaveState>;
  saveErrors: Record<ConfigField, string | null>;
  onChangePoints: (change: PointsChange) => void;
  onChangeProblemPoints: (problemId: string, n: number) => void;
  onChangeRubric: (patch: Partial<TeacherRubric>) => void;
  onGenerate: () => void;
  /** Put the course's approved questions on this homework. Absent for a
   *  practice set, whose problems are its own generated versions. */
  onAddFromBank?: () => void;
  /** Absent for a practice set: its problems are its own versions, not a
   *  list this page rewrites. */
  onRemoveProblems?: () => void;
  onEditProblem: (bankItemId: string) => void;
  checklistsLookedAgain: boolean;
  onChecklistChanged: () => Promise<void>;
  /** Opens one problem's Grading ▾; `n` makes a repeat request fire again. */
  reveal: { bankItemId: string; n: number } | null;
}) {
  return (
    <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light pb-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          {graded ? "Problems & grading" : "Problems"} · {problems.length}
        </h2>
        <div className="flex items-center gap-2">
          {onAddFromBank && (
            <button
              type="button"
              onClick={onAddFromBank}
              disabled={isPublished}
              title={isPublished ? "Unpublish to add problems" : "Add questions you already approved"}
              className="rounded-[--radius-md] border border-primary/40 bg-primary-bg/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-bg/60 disabled:opacity-50"
            >
              Add from bank
            </button>
          )}
          <button
            type="button"
            onClick={onGenerate}
            disabled={isPublished}
            title={isPublished ? "Unpublish to generate more" : "Generate with AI"}
            className="rounded-[--radius-md] border border-primary/40 bg-primary-bg/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-bg/60 disabled:opacity-50"
          >
            ✨ Generate more
          </button>
          {onRemoveProblems && (
            <button
              type="button"
              onClick={onRemoveProblems}
              disabled={isPublished || problems.length === 0}
              title={
                isPublished
                  ? "Unpublish to remove problems"
                  : problems.length === 0
                    ? "Nothing to remove"
                    : "Remove problems from this homework in bulk"
              }
              className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-[color:var(--color-error-border)] hover:text-[color:var(--color-error)] disabled:opacity-50 disabled:hover:border-border-light disabled:hover:text-text-secondary"
            >
              Remove problems
            </button>
          )}
        </div>
      </div>

      {/* State-driven body */}
      {problems.length === 0 ? (
        awaitingProblems ? (
          <ProblemsAwaitingNote />
        ) : (
          <ProblemsEmptyHero disabled={isPublished} onGenerate={onGenerate} />
        )
      ) : (
        <>
          {graded && (
            <PointsTotalBar
              points={hw.points}
              problemCount={problems.length}
              isPublished={isPublished}
              saveState={saveStates.points}
              saveError={saveErrors.points}
              onChange={onChangePoints}
            />
          )}
          <ul className="mt-3 space-y-2">
            {problems.map((p) => (
              <ProblemRow
                key={`${p.bank_item_id}-${p.position}`}
                problem={p}
                points={graded ? (hw.points.by_problem[p.bank_item_id] ?? null) : null}
                onPointsChange={(n) => onChangeProblemPoints(p.bank_item_id, n)}
                validatePoints={(n) => {
                  if (n < 1) return "At least 1 point.";
                  const others = hw.points.total - (hw.points.by_problem[p.bank_item_id] ?? 0);
                  return others + n > MAX_TOTAL_POINTS
                    ? `The homework would be worth more than ${MAX_TOTAL_POINTS}.`
                    : null;
                }}
                onEdit={
                  isPublished
                    ? undefined
                    : () => onEditProblem(p.bank_item_id)
                }
                checklist={hw.graph_checklists?.[p.bank_item_id]}
                checklistLookedAgain={checklistsLookedAgain}
                onChecklistChanged={onChecklistChanged}
                reveal={reveal?.bankItemId === p.bank_item_id ? reveal.n : undefined}
                published={isPublished}
              />
            ))}
          </ul>
        </>
      )}

      {/* The rules for every problem. Hidden for practice:
          practice is ungraded, no rubric feeds the grader. */}
      {graded && (
        <GradingSetupCard
          embedded
          rubric={hw.rubric}
          saveState={saveStates.rubric}
          saveError={saveErrors.rubric}
          onChange={onChangeRubric}
          copyFromAssignmentId={assignmentId}
          courseId={courseId}
        />
      )}
    </section>
  );
}
