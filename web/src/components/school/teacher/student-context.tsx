"use client";

import Link from "next/link";
import { formatDate } from "@/lib/utils";
import type { StudentContext } from "@/lib/api";
import { studentReviewHref } from "@/lib/review-deep-link";
import { studentHistoryHref } from "@/lib/student-history-href";

/** The student's other courses with this teacher, one click to each
 *  history. Nothing when there are none. */
export function OtherCourses({
  studentId,
  courses,
}: {
  studentId: string;
  courses: StudentContext["other_courses"];
}) {
  if (courses.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[13px] text-text-muted">
      <span>Also in your</span>
      {courses.map((c, i) => (
        <span key={c.section_id}>
          <Link
            href={studentHistoryHref(c.course_id, c.section_id, studentId)}
            className="font-semibold text-text-secondary underline decoration-border-light underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary/50"
          >
            {c.course_name}
          </Link>
          <span className="text-text-muted"> ({c.section_name})</span>
          {i < courses.length - 1 && <span aria-hidden>,</span>}
        </span>
      ))}
    </p>
  );
}

/** Each understanding check the student finished in this course: what
 *  the conversation showed, in its summary, and a way to read it. For the
 *  teacher only, and never a verdict — no score, no badge: the check
 *  raises a question for the teacher to look into, it doesn't answer it. */
export function UnderstandingChecks({
  courseId,
  studentId,
  checks,
}: {
  courseId: string;
  studentId: string;
  checks: StudentContext["understanding_checks"];
}) {
  if (checks.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="understanding-checks">
      <h2
        id="understanding-checks"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary"
      >
        Understanding checks
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        What each conversation showed, for you only. Read the conversation before drawing a conclusion.
      </p>
      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <li
            key={c.assignment_id}
            className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <span className="text-sm font-bold text-text-primary">{c.assignment_title}</span>
                <span className="ml-2 text-xs text-text-muted">{formatDate(c.submitted_at)}</span>
              </div>
              <Link
                href={studentReviewHref(courseId, c.assignment_id, c.section_id, studentId)}
                className="shrink-0 text-xs font-semibold text-primary hover:underline"
              >
                Read the conversation
              </Link>
            </div>
            <p className="mt-1.5 font-serif text-[15px] leading-relaxed text-text-secondary">{c.summary}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
