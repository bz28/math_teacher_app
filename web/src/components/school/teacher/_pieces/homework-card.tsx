"use client";

import type { TeacherAssignment } from "@/lib/api";
import { formatDate, formatDue } from "@/lib/utils";
import { StatusPill } from "./status-pill";

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
  // Outstanding submissions = submitted but not yet graded. Headline
  // signal for the NEEDS GRADING bucket: surface as a pill on the
  // title row so a teacher can scan a stack of cards and pick the one
  // with the largest queue without clicking in.
  const ungraded = Math.max(0, hw.submitted - hw.graded);
  // Submitted-vs-enrolled context, shown ahead of every review/publish
  // state so "ready to publish" or a published pill never reads as
  // class-complete while students still owe work (a 3-of-28 HW is not
  // "done"). In needsGrading a fully-published HW is always partial — a
  // complete one is routed to the completed bucket.
  const submittedLabel =
    hw.submitted >= hw.total_students
      ? `all ${hw.submitted} submitted`
      : `${hw.submitted} of ${hw.total_students} submitted`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`block w-full rounded-[--radius-lg] border bg-surface p-4 text-left transition-all hover:-translate-y-px hover:shadow-sm ${
        bucket === "needsGrading"
          ? "border-[color:var(--color-error-border)] hover:border-[color:var(--color-error)]"
          : bucket === "dueThisWeek"
            ? "border-[color:var(--color-info-border)] hover:border-[color:var(--color-info)]"
            : "border-border-light hover:border-primary/40"
      }`}
    >
      {/* Title row — keeps publish state pill, surfaces the headline
          attention pill (to-grade or overdue) so the eye lands on it
          before reading metadata. */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-base font-bold text-text-primary">
          {hw.title}
        </h3>
        {bucket === "needsGrading" && ungraded > 0 && (
          <StatusPill
            tone="amber"
            label={`${ungraded} to grade`}
          />
        )}
        {overdueDays > 0 && (
          <StatusPill
            tone="red"
            label={overdueDays === 1 ? "1 day overdue" : `${overdueDays} days overdue`}
          />
        )}
        {isDraft ? (
          <span className="shrink-0 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-border-light)] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-text-secondary)]">
            draft
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-success)]">
            published
          </span>
        )}
      </div>

      {/* Meta row: unit · due date · sections. Overdue label is now
          carried by the title-row pill, so this row stays short and
          scannable. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
        {unitLabel && (
          <>
            <span className="font-medium text-text-secondary">{unitLabel}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className={hw.due_at ? "" : "italic"}>{dueLabel}</span>
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
        {/* Review/publish progress — the honest teacher-workload signal.
            AI grading auto-sets final_score on submit, so "graded" is
            near-always true and useless here; we key off the direct
            SubmissionGrade lifecycle flags instead. Every branch leads
            with submitted-vs-enrolled so a partial HW never reads as
            class-complete:
              - published === submitted → all grades released to students
                ("Grades published" pill).
              - to_review > 0 → submissions still awaiting the teacher's
                review (reviewed_at IS NULL).
              - else → everything reviewed, ready for the teacher to
                publish. */}
        {bucket === "needsGrading" && hw.submitted > 0 && (
          <span className="ml-1 font-semibold text-text-secondary">
            · {submittedLabel}
            {hw.published === hw.submitted ? (
              <span className="ml-1.5 align-middle">
                <StatusPill tone="green" label="Grades published" />
              </span>
            ) : hw.to_review > 0 ? (
              <> · {hw.to_review} to review</>
            ) : (
              <> · ready to publish</>
            )}
          </span>
        )}
        {hw.pending_review > 0 && (
          <span className="ml-1 font-semibold text-[color:var(--color-warning-dark)] ">
            · {hw.pending_review} need{hw.pending_review === 1 ? "s" : ""} your approval
          </span>
        )}
        {isDraft && needsVariationsCount !== null && needsVariationsCount > 0 && (
          <span className="ml-1 font-semibold text-[color:var(--color-warning-dark)] ">
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
