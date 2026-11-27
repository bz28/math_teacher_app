"use client";

import Link from "next/link";
import type { SubmissionsInboxRow } from "@/lib/api";
import { StatusPill } from "@/components/school/teacher/_pieces/status-pill";

/** Grades in this section waiting on the teacher before students see
 *  them: graded and never published, or published and edited since —
 *  the section's share of the review page's "Publish N grades". */
export function toApproveCount(r: SubmissionsInboxRow): number {
  return r.to_grade + r.dirty;
}

/** Show the band once any section has turned-in work; before that the
 *  slim "waiting for first submission" strip says all there is to say. */
export function hasTurnedInWork(rows: SubmissionsInboxRow[] | null): boolean {
  return !!rows && rows.some((r) => r.submitted > 0);
}

/** The homework page's lead once work comes in: one row per section,
 *  what's waiting on the teacher there (counted as the review page
 *  counts it), and a way straight into that section's review page,
 *  which opens on the first student who needs her. */
export function SectionReviewBand({
  courseId,
  assignmentId,
  rows,
}: {
  courseId: string;
  assignmentId: string;
  rows: SubmissionsInboxRow[];
}) {
  const sorted = [...rows].sort((a, b) =>
    a.section_name.localeCompare(b.section_name, undefined, { numeric: true }),
  );
  // The first section with something waiting gets the primary button —
  // that's where her next decision is.
  const leadId = sorted.find((r) => toApproveCount(r) + r.flagged > 0)?.section_id;

  return (
    <section
      aria-label="Review by section"
      className="mt-5 overflow-hidden rounded-[--radius-lg] border border-border bg-surface shadow-sm"
    >
      <h2 className="border-b border-border-light px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        Turned-in work
      </h2>
      <ul>
        {sorted.map((r, i) => {
          const toApprove = toApproveCount(r);
          const waiting = toApprove + r.flagged > 0;
          const lead = r.section_id === leadId;
          return (
            <li
              key={r.section_id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${
                i === 0 ? "" : "border-t border-border-light"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-text-primary">{r.section_name}</p>
                <p className="mt-0.5 text-[12px] text-text-muted">
                  {r.submitted === 0
                    ? `Nothing turned in yet · ${r.total_students} students`
                    : `${r.submitted} of ${r.total_students} turned in`}
                  {r.submitted > 0 && !waiting && " · all grades published"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.flagged > 0 && (
                  <StatusPill tone="red" icon="⚑" label={`${r.flagged} flagged`} />
                )}
                {toApprove > 0 && <StatusPill tone="amber" label={`${toApprove} to approve`} />}
              </div>
              <Link
                href={`/school/teacher/courses/${courseId}/homework/${assignmentId}/sections/${r.section_id}/review`}
                aria-label={`Review ${r.section_name}`}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-[--radius-sm] px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  lead
                    ? "bg-primary text-white hover:bg-primary-dark"
                    : "border border-border bg-surface text-text-primary hover:border-primary/40 hover:text-primary"
                }`}
              >
                {waiting || r.submitted === 0 ? "Review" : "Open"}
                <span aria-hidden>→</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
