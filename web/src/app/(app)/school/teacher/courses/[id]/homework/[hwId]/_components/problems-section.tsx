"use client";

import { generatingLabel } from "@/lib/generation-progress";
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
import { ProblemsEmptyHero, ProblemsGeneratingHero } from "./problems-heroes";

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
  generation,
  saveStates,
  saveErrors,
  onChangePoints,
  onChangeProblemPoints,
  onChangeRubric,
  onGenerate,
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
  /** The generation jobs feeding this homework, summed. */
  generation: { active: boolean; requested: number; produced: number; reading: boolean };
  saveStates: Record<ConfigField, SaveState>;
  saveErrors: Record<ConfigField, string | null>;
  onChangePoints: (change: PointsChange) => void;
  onChangeProblemPoints: (problemId: string, n: number) => void;
  onChangeRubric: (patch: Partial<TeacherRubric>) => void;
  onGenerate: () => void;
  onRemoveProblems: () => void;
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
          <button
            type="button"
            onClick={onGenerate}
            disabled={isPublished}
            title={isPublished ? "Unpublish to generate more" : "Generate with AI"}
            className="rounded-[--radius-md] border border-primary/40 bg-primary-bg/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-bg/60 disabled:opacity-50"
          >
            ✨ Generate more
          </button>
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
        </div>
      </div>

      {/* State-driven body */}
      {generation.active && problems.length === 0 ? (
        <ProblemsGeneratingHero
          requestedCount={generation.requested}
          producedCount={generation.produced}
          reading={generation.reading}
        />
      ) : problems.length === 0 ? (
        <ProblemsEmptyHero
          disabled={isPublished}
          onGenerate={onGenerate}
        />
      ) : (
        <>
          {/* Inline generating strip when we already have
              problems but the teacher kicked off more.
              role=status announces the live count to screen
              readers, mirroring the empty-state hero. */}
          {generation.active && (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 flex items-center gap-3 rounded-[--radius-md] border border-primary/30 bg-primary-bg/30 px-3 py-2 text-xs text-text-primary dark:border-primary/40 dark:bg-primary/10"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              <span>
                <span className="font-semibold">
                  {generatingLabel(generation.requested, generation.reading, "more")}
                  {generation.produced > 0 && generation.requested > 0
                    ? ` · ${generation.produced} of ${generation.requested} ready`
                    : ""}
                </span>{" "}
                <span className="text-text-secondary">new ones land in the review queue when ready.</span>
              </span>
            </div>
          )}
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
