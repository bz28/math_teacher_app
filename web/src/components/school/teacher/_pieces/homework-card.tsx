"use client";

import type { TeacherAssignment } from "@/lib/api";
import { ProgressBar } from "./progress-bar";

export type HomeworkBucket =
  | "needsGrading"
  | "dueThisWeek"
  | "upcoming"
  | "completed";

/**
 * Lifecycle-aware homework card. Rendering varies by bucket:
 *
 * - **upcoming (draft):** Title, DRAFT badge, due date, sections, problem count, variation warnings
 * - **upcoming (published):** Title, unit label, due date, sections, submission + grading bars
 * - **dueThisWeek:** Same as published but more prominent
 * - **needsGrading:** Title, unit, overdue indicator, bars, avg score
 * - **completed:** Dense single line — title, unit, due date, avg score
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
        {isDraft && (
          <span className="shrink-0 rounded-full border border-text-muted/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
            draft
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
        {unitLabel && unitLabel !== "Uncategorized" && (
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

      {/* Draft-specific: problem count + variation warnings */}
      {isDraft && (
        <div className="mt-1 text-[11px] text-text-muted">
          {hw.problem_count} {hw.problem_count === 1 ? "problem" : "problems"}
          {needsVariationsCount !== null && needsVariationsCount > 0 && (
            <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">
              · {needsVariationsCount} need variation
              {needsVariationsCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {/* Published: progress bars */}
      {!isDraft && hw.total_students > 0 && (
        <div className="mt-2 space-y-1">
          <ProgressBar
            label="Submitted"
            current={hw.submitted}
            total={hw.total_students}
            color="blue"
          />
          <ProgressBar
            label="Graded"
            current={hw.graded}
            total={hw.submitted}
            color="green"
          />
        </div>
      )}

      {/* Needs grading: avg score */}
      {bucket === "needsGrading" && hw.avg_score !== null && (
        <div className="mt-1.5 text-[11px] font-semibold text-text-secondary">
          Avg score: {Math.round(hw.avg_score)}%
        </div>
      )}
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
  const dueLabel = hw.due_at ? formatDueShort(hw.due_at) : "—";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-[--radius-md] px-3 py-2 text-left text-sm transition-colors hover:bg-bg-subtle"
    >
      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
        {hw.title}
      </span>
      {unitLabel && unitLabel !== "Uncategorized" && (
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

// ── Date helpers ──

function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return `Due ${date}`;
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Due ${date}, ${time}`;
}

/** Shorter format for completed rows: "Apr 11" or "Apr 11, 2025". */
function formatDueShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** How many full days past due. Returns 0 if not overdue. */
function daysOverdue(iso: string): number {
  const due = new Date(iso).getTime();
  const now = Date.now();
  if (now <= due) return 0;
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
}
