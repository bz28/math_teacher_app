import type { ReactNode } from "react";
import {
  ReportProblemTrigger,
  type ReportProblemContext,
} from "@/components/school/teacher/report-problem";
import type { TeacherSubmissionDetail } from "@/lib/api";
import type { RosterEntry } from "../_lib/types";
import { StudentWorkThumbButton } from "./pinned-work";

/**
 * The submission header's actions: the pages thumbnail (below xl), Grade
 * with AI, the review state and its Approve / Undo, the advance-or-
 * publish slot, and Report. Every value is derived by the panel; this
 * only lays them out.
 */
export function ReviewActions({
  detail,
  reportBase,
  offerAiGrade,
  aiGrading,
  onGradeWithAi,
  savingGrade,
  regrading,
  marking,
  handGraded,
  approved,
  allGraded,
  gradedProblemCount,
  totalProblems,
  graphGate,
  onMarkReviewed,
  onUnmarkReviewed,
  nextStudent,
  onSelectNext,
  toReleaseTotal,
  onPublish,
  published,
}: {
  detail: TeacherSubmissionDetail;
  reportBase: ReportProblemContext;
  offerAiGrade: boolean;
  aiGrading: boolean;
  onGradeWithAi: () => void;
  savingGrade: boolean;
  regrading: boolean;
  marking: boolean;
  /** No AI grade ever landed: every score is the teacher's own. */
  handGraded: boolean;
  approved: boolean;
  allGraded: boolean;
  gradedProblemCount: number;
  totalProblems: number;
  /** "Check N graph items first" while any is undecided, else null. */
  graphGate: string | null;
  onMarkReviewed: () => void;
  onUnmarkReviewed: () => void;
  nextStudent: RosterEntry | null;
  onSelectNext: () => void;
  toReleaseTotal: number;
  onPublish: () => void;
  published: boolean;
}): ReactNode {
  return (
    <>
      {/* Wraps on a phone rather than refusing to shrink. These four
          controls measured 484px wide inside a 390px viewport, so
          `shrink-0` alone pushed the grading header sideways — on the
          screen a teacher is most likely to open between classes.
          The no-shrink guarantee still holds from md: up, where there
          is room for a single row. */}
      <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:shrink-0">
        {/* Submitted pages stay one click away — promoted to the
            page header so they're findable without scrolling to
            the problems card. Lightbox markup lives inside the
            button component. The gap-3 (vs the default gap-2
            elsewhere in the strip) buys breathing room between
            this modal-popping affordance and the adjacent "Next
            student →" navigation, since teachers click Next
            student rapidly and we don't want the View work button
            absorbing accidental hits. */}
        {/* Hidden on the wide (xl) layout, where the pinned work rail
            keeps the photo glanceable; shown below xl where the rail
            unpins. */}
        {detail.files && detail.files.length > 0 && (
          <span className="xl:hidden">
            <StudentWorkThumbButton
              files={detail.files}
              studentName={detail.student_name}
            />
          </span>
        )}
        {/* Review state. `reviewed_at` means the teacher stands behind
            the grade. An AI grade needs her explicit Approve ✓ — a
            deliberate act, enabled only once every problem carries a
            grade (you can't vouch for a half-graded submission) — with
            an Undo path to walk it back. A hand grade has nothing to
            approve, so it only shows progress until every problem is
            scored, then reads Approved. */}
        {/* Grade with AI — first grading only. Offered on work nobody
            has graded in any form (no AI grade, no hand score, not
            even one problem), with readable work; the server enforces
            the same rule — which also requires the student to have
            confirmed the reading (flagged work is graded by hand). The
            grade lands as a
            suggestion she still approves. Solid because, on an
            ungraded submission, it is the one thing to do here. */}
        {(offerAiGrade || aiGrading) && (
          <button
            type="button"
            onClick={onGradeWithAi}
            disabled={aiGrading || savingGrade}
            aria-busy={aiGrading}
            title={
              aiGrading
                ? "The AI is grading this submission"
                : "Have the AI suggest a grade — you review it before students see anything"
            }
            className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {aiGrading ? (
              <>
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
                />
                Grading…
              </>
            ) : (
              "Grade with AI"
            )}
          </button>
        )}
        {/* "0/N graded" says nothing the AI button beside it doesn't. */}
        {handGraded && !approved && totalProblems > 0 && !offerAiGrade && !aiGrading && (
          <span
            className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-border-light bg-[color:var(--color-surface-alt-2)] px-2.5 py-1 text-[11px] font-bold text-text-muted tabular-nums"
            title="Score every problem to finish grading this submission"
          >
            {gradedProblemCount}/{totalProblems} graded
          </span>
        )}
        {!handGraded && !approved && totalProblems > 0 && (
          <>
            <span
              className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-border-light bg-[color:var(--color-surface-alt-2)] px-2.5 py-1 text-[11px] font-bold text-text-muted tabular-nums"
              title={
                allGraded
                  ? "Every problem is graded — approve when you're ready"
                  : "Grade every problem before you can approve this submission"
              }
            >
              {!allGraded
                ? `Not reviewed · ${gradedProblemCount}/${totalProblems} graded`
                : graphGate ?? "Not reviewed"}
            </span>
            <button
              type="button"
              onClick={onMarkReviewed}
              disabled={marking || savingGrade || regrading || !allGraded || graphGate !== null}
              title={
                regrading
                  ? "Regrading — approve once the new grade lands"
                  : savingGrade
                    ? "Saving your grade edit — approve once it finishes"
                    : !allGraded
                      ? `Grade every problem first (${gradedProblemCount} of ${totalProblems} graded)`
                      : graphGate
                        ? `${graphGate}: mark each one Shown or Missing on its problem`
                        : "Approve — mark this submission reviewed"
              }
              className="rounded-[--radius-md] border border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10 px-3.5 py-1.5 text-xs font-bold text-[color:var(--color-success)] transition-colors hover:border-[color:var(--color-success)]/60 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {marking ? "Approving…" : "Approve ✓"}
            </button>
          </>
        )}
        {approved && (
          <>
            <span className="inline-flex items-center gap-1 rounded-[--radius-pill] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-2.5 py-1 text-[11px] font-bold text-[color:var(--color-success)]">
              <span aria-hidden>✓</span>
              Approved
            </span>
            {/* Undo only makes sense for an approval she clicked; a hand
                grade would just re-stamp itself on the next save. */}
            {!handGraded && (
              <button
                type="button"
                onClick={onUnmarkReviewed}
                disabled={marking || savingGrade || regrading}
                title={
                  regrading
                    ? "Regrading — the approval will clear when the new grade lands"
                    : savingGrade
                      ? "Saving your grade edit — undo once it finishes"
                      : "Undo approval — return this submission to not reviewed"
                }
                className="rounded-[--radius-md] border border-border-light bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {marking ? "Undoing…" : "Undo"}
              </button>
            )}
          </>
        )}
        {/* Advance-or-publish. While there's a next unreleased submitter,
            this is the rapid "Next student →" advance. On the LAST one —
            nextStudent null but grades still unreleased HW-wide — the dead
            "No more students" button was the exact moment the teacher wants
            to Publish, so we surface an affirmative publish CTA in the same
            slot (reuses the header's publish gate: straight-through when
            everything's approved + unflagged, else opens the confirm).
            When nothing's left to release, a quiet "all caught up" state —
            but only claim that when THIS submission is itself released; if
            it's the last one and still unpublished-because-ungraded (e.g. a
            skipped-unreadable that needs hand-grading), a neutral terminal
            label avoids contradicting the "grade this by hand" callout. */}
        {nextStudent ? (
          <button
            type="button"
            onClick={onSelectNext}
            className="rounded-[--radius-md] border border-primary/30 bg-primary-bg px-3.5 py-1.5 text-xs font-bold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
          >
            Next student →
          </button>
        ) : toReleaseTotal > 0 ? (
          <button
            type="button"
            onClick={onPublish}
            title={`You're on the last student — publish ${toReleaseTotal} ${toReleaseTotal === 1 ? "grade" : "grades"}`}
            className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
          >
            <span aria-hidden>✓</span>
            Last one — publish {toReleaseTotal}{" "}
            {toReleaseTotal === 1 ? "grade" : "grades"} →
          </button>
        ) : published ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-3.5 py-1.5 text-xs font-bold text-[color:var(--color-success)]"
            title="Every submission reviewed and published"
          >
            <span aria-hidden>✓</span>
            All caught up
          </span>
        ) : (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3.5 py-1.5 text-xs font-bold text-text-muted"
            title="No other students to review — grade this one to finish"
          >
            No more students
          </span>
        )}
        {/* Whole-submission report — "it misread the page", "wrong
            student's work", anything not tied to one problem. Per-
            problem reports sit on each AI verdict below. Quiet muted
            styling so it never competes with Approve / Next student,
            but labelled — an icon alone wasn't found when needed. */}
        <ReportProblemTrigger
          label="Report"
          context={{
            ...reportBase,
            labels: [detail.assignment_title, detail.student_name, "Whole submission"],
          }}
        />
      </div>
    </>
  );
}
