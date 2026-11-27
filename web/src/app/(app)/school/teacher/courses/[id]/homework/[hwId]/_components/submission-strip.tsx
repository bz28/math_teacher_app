"use client";

import { useState } from "react";
import Link from "next/link";
import type { SubmissionsInboxRow } from "@/lib/api";

// ────────────────────────────────────────────────────────────────────
// Submission strip — slim "X of Y submitted · Z to grade →" line that
// sits between the published-lock banner and the pending-review card.
// Single-section HWs deep-link directly to the grading queue; multi-
// section HWs expand inline into a section picker so the teacher
// chooses which queue to enter rather than us guessing.
// ────────────────────────────────────────────────────────────────────
export function SubmissionStrip({
  courseId,
  assignmentId,
  rows,
}: {
  courseId: string;
  assignmentId: string;
  rows: SubmissionsInboxRow[];
}) {
  const [open, setOpen] = useState(false);

  const totalStudents = rows.reduce((s, r) => s + r.total_students, 0);
  const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);
  // "To review" = submissions whose grade isn't out yet OR has been
  // edited since publish. `to_grade` counts only graded-but-unpublished
  // (per teacher_assignments.py:985-994), so the truly-ungraded would
  // be silently dropped if we used it directly. `submitted - published`
  // captures both ungraded + to_grade in one expression; `+ dirty`
  // adds back the published-but-edited subset that needs a republish
  // click before students see the latest. Flagged is reported
  // separately as an integrity signal, not a grading-pipeline state.
  const totalToReview = rows.reduce(
    (s, r) => s + (r.submitted - r.published) + r.dirty,
    0,
  );
  const totalFlagged = rows.reduce((s, r) => s + r.flagged, 0);

  const parts: string[] =
    totalSubmitted === 0
      ? [`Waiting for first submission`]
      : [`${totalSubmitted} of ${totalStudents} submitted`];
  if (totalToReview > 0) parts.push(`${totalToReview} to review`);
  if (totalFlagged > 0) parts.push(`⚑ ${totalFlagged} flagged`);
  const summary = parts.join(" · ");

  const reviewHref = (sectionId: string) =>
    `/school/teacher/courses/${courseId}/homework/${assignmentId}/sections/${sectionId}/review`;

  // Single-section HW: one click goes straight to the grading queue.
  if (rows.length === 1) {
    return (
      <Link
        href={reviewHref(rows[0].section_id)}
        className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-4 py-2.5 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:bg-[color:var(--color-surface-alt-2)]"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">View submissions →</span>
      </Link>
    );
  }

  // Multi-section: expandable inline picker so the teacher picks the
  // section to grade rather than landing in a default they didn't ask
  // for. Counts live on each row so the choice is informed.
  return (
    <div className="mt-4 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)]"
      >
        <span>{summary}</span>
        <span className="shrink-0 text-primary">
          {open ? "Hide sections ▴" : "View submissions →"}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border-light border-t border-border-light bg-surface">
          {rows.map((r) => {
            const toReview = (r.submitted - r.published) + r.dirty;
            return (
              <Link
                key={r.section_id}
                href={reviewHref(r.section_id)}
                className="flex items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-[color:var(--color-surface-alt-2)]"
              >
                <span className="font-semibold text-text-primary">
                  {r.section_name}
                </span>
                <span className="text-text-muted">
                  {r.submitted} of {r.total_students} submitted
                  {toReview > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-semibold text-primary">
                        {toReview} to review →
                      </span>
                    </>
                  )}
                  {r.flagged > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-semibold text-[color:var(--color-error)]">
                        ⚑ {r.flagged}
                      </span>
                    </>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
