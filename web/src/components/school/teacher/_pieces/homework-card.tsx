"use client";

import type { TeacherAssignment } from "@/lib/api";
import { formatDate, formatDue } from "@/lib/utils";

export type HomeworkBucket =
  | "needsGrading"
  | "dueThisWeek"
  | "upcoming"
  | "completed";

/**
 * Lifecycle-aware homework card. Surfaces two things — publish state
 * (DRAFT badge vs. no badge) and problem count — on every non-completed
 * bucket. Submission progress lives on the Submissions tab; AI grading
 * makes "N graded" track "N submitted" one-for-one, so a graded bar here
 * is always-100% noise. Avg score still renders on needsGrading /
 * completed because it's a meaningful quality signal independent of
 * submission counts.
 *
 * Variant per bucket:
 * - **upcoming (draft):** Title, DRAFT badge, due, sections, problem count, variation warnings
 * - **upcoming (published):** Title, unit, due, sections, problem count
 * - **dueThisWeek:** Same but with a blue accent border
 * - **needsGrading:** Title, unit, overdue indicator, problem count, avg score
 * - **completed:** Dense single line — title, unit, due, avg
 */
export function HomeworkCard({
  hw,
  bucket,
  unitLabel,
  needsVariationsCount,
  onOpen,
}: {
  hw: TeacherAssignment;
  bucket: HomeworkBucket;
  /** Pre-resolved unit label string (e.g. "Unit 5: Quadratics"). */
  unitLabel: string;
  needsVariationsCount: number | null;
  onOpen: () => void;
}) {
  if (bucket === "completed") {
    return <CompletedRow hw={hw} unitLabel={unitLabel} onOpen={onOpen} />;
  }

  const isDraft = hw.status !== "published";
  const dueLabel = hw.due_at ? formatDue(hw.due_at) : "No due date";
  const sectionLabel =
    hw.section_names.length > 0
      ? hw.section_names.join(", ")
      : "No sections";
  const overdueDays = bucket === "needsGrading" && hw.due_at ? daysOverdue(hw.due_at) : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`block w-full rounded-[--radius-lg] border bg-surface p-4 text-left transition-all hover:-translate-y-px hover:shadow-sm ${
        bucket === "needsGrading"
          ? "border-red-200 hover:border-red-300 dark:border-red-500/30 dark:hover:border-red-500/50"
          : bucket === "dueThisWeek"
            ? "border-blue-200 hover:border-blue-300 dark:border-blue-500/30 dark:hover:border-blue-500/50"
            : "border-border-light hover:border-primary/40"
      }`}
    >
      {/* Title row */}
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-bold text-text-primary">
          {hw.title}
        </h3>
        {isDraft ? (
          <span className="shrink-0 rounded-full border border-text-muted/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
            draft
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-green-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white dark:bg-green-500">
            published
          </span>
        )}
        {overdueDays > 0 && (
          <span className="shrink-0 text-[11px] font-semibold text-red-600 dark:text-red-400">
            {overdueDays === 1 ? "1 day ago" : `${overdueDays} days ago`}
          </span>
        )}
      </div>

      {/* Meta row: unit · due date · sections */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
        {unitLabel && (
          <>
            <span className="font-medium text-text-secondary">{unitLabel}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className={hw.due_at ? "" : "italic"}>
          {overdueDays > 0 ? (
            <span className="text-red-600 dark:text-red-400">Overdue</span>
          ) : (
            dueLabel
          )}
        </span>
        <span aria-hidden>·</span>
        <span className={hw.section_names.length === 0 ? "italic" : ""}>
          {sectionLabel}
        </span>
      </div>

      {/* Problem count + optional nudges. "N need approval" mirrors
          the amber banner on the HW detail page — a pre-publish action
          the teacher owes the HW. Variation warnings and avg score
          stay one-liners so the card doesn't balloon. */}
      <div className="mt-1 text-[11px] text-text-muted">
        {hw.problem_count} {hw.problem_count === 1 ? "problem" : "problems"}
        {hw.pending_review > 0 && (
          <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
            · {hw.pending_review} need{hw.pending_review === 1 ? "s" : ""} your approval
          </span>
        )}
        {isDraft && needsVariationsCount !== null && needsVariationsCount > 0 && (
          <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
            · {needsVariationsCount} need variation
            {needsVariationsCount === 1 ? "" : "s"}
          </span>
        )}
        {bucket === "needsGrading" && hw.avg_score !== null && (
          <span className="ml-1 font-semibold text-text-secondary">
            · Avg score {Math.round(hw.avg_score)}%
          </span>
        )}
      </div>
    </button>
  );
}

/** Dense single-line row for the COMPLETED bucket. */
function CompletedRow({
  hw,
  unitLabel,
  onOpen,
}: {
  hw: TeacherAssignment;
  unitLabel: string;
  onOpen: () => void;
}) {
  const dueLabel = hw.due_at ? (formatDate(hw.due_at) ?? "—") : "—";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-[--radius-md] px-3 py-2 text-left text-sm transition-colors hover:bg-bg-subtle"
    >
      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
        {hw.title}
      </span>
      {unitLabel && (
        <span className="hidden shrink-0 text-[11px] text-text-muted sm:inline">
          {unitLabel}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-text-muted">{dueLabel}</span>
      {hw.avg_score !== null && (
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-text-secondary">
          {Math.round(hw.avg_score)}%
        </span>
      )}
    </button>
  );
}

/** How many full days past due. Returns 0 if not overdue. */
function daysOverdue(iso: string): number {
  const due = new Date(iso).getTime();
  const now = Date.now();
  if (now <= due) return 0;
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
}
