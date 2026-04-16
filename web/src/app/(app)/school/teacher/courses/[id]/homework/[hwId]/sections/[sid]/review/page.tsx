"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";

/**
 * Grading review workspace: one HW × one section.
 *
 * Route: /school/teacher/courses/[id]/homework/[hwId]/sections/[sid]/review
 *
 * Two-pane layout — left is the full section roster (every enrolled
 * student, whether they've submitted or not), right is the selected
 * student's work. Students who haven't submitted are visible in the
 * list with a "Not submitted" marker so the teacher can spot missing
 * work at a glance.
 *
 * 8b-1 (this commit) is read-only — teachers can scrub through
 * students and see their work. 8b-2 adds the per-problem
 * Full/Partial/Zero grading controls and the Publish-all-grades flow.
 */
type RosterEntry = {
  student_id: string;
  student_name: string;
  student_email: string;
  /** Present if the student has submitted; null if they haven't. */
  submission: TeacherSubmissionRow | null;
};

export default function HomeworkSectionReviewPage({
  params,
}: {
  params: Promise<{ id: string; hwId: string; sid: string }>;
}) {
  const { id: courseId, hwId: assignmentId, sid: sectionId } = use(params);
  const backHref = `/school/teacher/courses/${courseId}?tab=submissions`;

  const [hwTitle, setHwTitle] = useState<string>("");
  const [sectionName, setSectionName] = useState<string>("");
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load HW + section roster + submissions and merge into one list:
  // every enrolled student in this section, with their submission if
  // they've turned one in.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      teacher.assignment(assignmentId),
      teacher.section(courseId, sectionId),
      teacher.submissions(assignmentId),
    ])
      .then(([a, s, subs]) => {
        if (cancelled) return;
        setError(null);
        setHwTitle(a.title);
        setSectionName(s.name);
        // Join submissions to roster by student_id. Email would work
        // today but breaks silently if a student ever changes their
        // account email after submitting — the submission still
        // carries the old email and would vanish from the view.
        const submissionByStudent = new Map<string, TeacherSubmissionRow>();
        for (const r of subs.submissions) {
          if (r.section_id !== sectionId || r.is_preview) continue;
          submissionByStudent.set(r.student_id, r);
        }
        const merged: RosterEntry[] = s.students
          .map((st) => ({
            student_id: st.id,
            student_name: st.name || st.email,
            student_email: st.email,
            submission: submissionByStudent.get(st.id) ?? null,
          }))
          .sort((a, b) => a.student_name.localeCompare(b.student_name));
        setRoster(merged);
        // Auto-select the first submitter that still needs review.
        // If everyone's published, fall back to the first submitter;
        // if no one has submitted, leave selection empty (the right
        // pane shows a tidy "nothing to review here" state).
        const firstUnpublished = merged.find(
          (e) => e.submission !== null && e.submission.grade_published_at === null,
        );
        const firstSubmitter = merged.find((e) => e.submission !== null);
        const pick = firstUnpublished ?? firstSubmitter;
        if (pick) setSelectedStudentId(pick.student_id);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load submissions");
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, courseId, sectionId]);

  const selectedEntry = useMemo(
    () =>
      roster
        ? (roster.find((e) => e.student_id === selectedStudentId) ?? null)
        : null,
    [roster, selectedStudentId],
  );
  const selectedSubmissionId = selectedEntry?.submission?.id ?? null;

  // Fetch submission detail only when the selected student actually
  // has a submission. Non-submitters render a "Not submitted" card
  // instead — nothing to fetch. Clear previous detail + prior error
  // synchronously on switch so the render never shows stale work or
  // carries over a stale red banner from a failed fetch.
  useEffect(() => {
    if (!selectedSubmissionId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    teacher
      .submissionDetail(selectedSubmissionId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load submission");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSubmissionId]);

  const pageTitle = useMemo(() => {
    if (!hwTitle && !sectionName) return "Reviewing…";
    const parts = [hwTitle, sectionName].filter(Boolean);
    return parts.join(" · ");
  }, [hwTitle, sectionName]);

  const submittedCount = roster?.filter((e) => e.submission).length ?? 0;
  const totalRoster = roster?.length ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10">
      <div className="pt-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-primary"
        >
          ← Back to submissions
        </Link>
      </div>

      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-text-primary">
        {pageTitle}
      </h1>

      {error && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}

      {roster === null && !error && (
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      )}

      {roster !== null && roster.length === 0 && (
        <div className="mt-6 rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-10 text-center">
          <p className="text-sm font-bold text-text-primary">
            No students in this section yet
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Invite students from the Sections tab, then publish homework.
          </p>
        </div>
      )}

      {roster !== null && roster.length > 0 && (
        <div className="mt-5 grid gap-5 md:grid-cols-[280px_1fr]">
          {/* Student list */}
          <aside className="self-start rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
            <div className="border-b border-border-light px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Students · {submittedCount}/{totalRoster} submitted
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {roster.map((e) => (
                <StudentRow
                  key={e.student_id}
                  entry={e}
                  selected={e.student_id === selectedStudentId}
                  onSelect={() => setSelectedStudentId(e.student_id)}
                />
              ))}
            </div>
          </aside>

          {/* Detail */}
          <section className="min-w-0">
            {!selectedEntry && (
              <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-10 text-center text-sm text-text-muted">
                Pick a student on the left to see their work.
              </div>
            )}
            {selectedEntry && !selectedEntry.submission && (
              <NotSubmittedCard entry={selectedEntry} />
            )}
            {selectedEntry?.submission && detailLoading && !detail && (
              <p className="text-sm text-text-muted">Loading student work…</p>
            )}
            {detail && selectedEntry?.submission && (
              <SubmissionDetailPanel
                detail={detail}
                row={selectedEntry.submission}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty state for a student who hasn't turned in work. No grading
// path from here — we can't grade missing work. 8b-2 may add a
// "mark as missing" action; not needed for v1.
// ────────────────────────────────────────────────────────────────────

function NotSubmittedCard({ entry }: { entry: RosterEntry }) {
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-bold text-text-primary">{entry.student_name}</h2>
      <p className="text-xs text-text-muted">{entry.student_email}</p>
      <div className="mt-5 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle/60 px-6 py-10 text-center">
        <p className="text-sm font-bold text-text-primary">Not submitted</p>
        <p className="mt-1 text-xs text-text-muted">
          This student hasn&apos;t turned in this homework yet.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Student list row — the clickable link to a specific submission.
// ────────────────────────────────────────────────────────────────────

function StudentRow({
  entry,
  selected,
  onSelect,
}: {
  entry: RosterEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const sub = entry.submission;
  const statusLabel = rowStatusLabel(entry);
  const mutedName = sub === null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 border-b border-border-light px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 ${
        selected ? "bg-primary-bg/40" : "hover:bg-bg-subtle"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`truncate font-semibold ${
            mutedName ? "text-text-muted" : "text-text-primary"
          }`}
        >
          {entry.student_name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${statusLabel.dotClass}`}
          />
          {statusLabel.text}
          {sub?.is_late && (
            <span className="ml-1 font-semibold text-red-600 dark:text-red-400">
              · late
            </span>
          )}
        </div>
      </div>
      {sub?.final_score != null && (
        <span
          className={`shrink-0 text-xs font-bold ${
            sub.grade_published_at
              ? "text-green-700 dark:text-green-400"
              : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {Math.round(sub.final_score)}%
        </span>
      )}
      {sub?.integrity_overview?.overall_badge === "unlikely" && (
        <span
          className="shrink-0 text-[11px] font-bold text-red-600 dark:text-red-400"
          role="img"
          aria-label="Integrity flag: unlikely the student did this work"
          title="Integrity flag: unlikely the student did this work"
        >
          🔴
        </span>
      )}
      {sub?.integrity_overview?.overall_badge === "uncertain" && (
        <span
          className="shrink-0 text-[11px] font-bold text-amber-600 dark:text-amber-400"
          role="img"
          aria-label="Integrity flag: uncertain"
          title="Integrity flag: uncertain"
        >
          🟡
        </span>
      )}
      {sub?.integrity_overview?.overall_badge === "unreadable" && (
        <span
          className="shrink-0 text-[11px] font-bold text-text-muted"
          role="img"
          aria-label="Integrity flag: handwriting unreadable"
          title="Integrity flag: handwriting unreadable"
        >
          📄
        </span>
      )}
    </button>
  );
}

function rowStatusLabel(entry: RosterEntry): {
  text: string;
  dotClass: string;
} {
  const sub = entry.submission;
  if (!sub) {
    return { text: "Not submitted", dotClass: "bg-gray-300" };
  }
  if (sub.grade_published_at) {
    return { text: "Published", dotClass: "bg-green-500" };
  }
  if (sub.final_score !== null) {
    return { text: "Graded, not published", dotClass: "bg-amber-500" };
  }
  return { text: "Needs review", dotClass: "bg-gray-400" };
}

// ────────────────────────────────────────────────────────────────────
// Submission detail — right pane. Read-only in 8b-1. The image is
// the source of truth; the typed answers are a quick-scan view
// alongside the answer key so the teacher can decide without
// switching contexts.
// ────────────────────────────────────────────────────────────────────

function SubmissionDetailPanel({
  detail,
  row,
}: {
  detail: TeacherSubmissionDetail;
  row: TeacherSubmissionRow | null;
}) {
  return (
    <div className="space-y-5">
      {/* Snapshot header */}
      <div className="rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              {detail.student_name}
            </h2>
            <p className="text-xs text-text-muted">{detail.student_email}</p>
          </div>
          <p className="text-[11px] text-text-muted">
            Submitted{" "}
            {new Date(detail.submitted_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {detail.is_late && (
              <span className="ml-2 font-semibold text-red-600 dark:text-red-400">
                · late
              </span>
            )}
          </p>
        </div>
        {row?.integrity_overview && (
          <IntegritySummary overview={row.integrity_overview} />
        )}
      </div>

      {/* Handwritten image */}
      {detail.image_data && (
        <div className="rounded-[--radius-xl] border border-border-light bg-surface p-4 shadow-sm">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Student&apos;s work
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/jpeg;base64,${detail.image_data}`}
            alt="Student handwritten submission"
            className="w-full rounded-[--radius-md] border border-border-light"
          />
        </div>
      )}

      {/* Per-problem breakdown */}
      <div className="rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Problems · {detail.problems.length}
        </p>
        <div className="mt-3 space-y-3">
          {detail.problems.map((p) => (
            <div
              key={p.bank_item_id}
              className="rounded-[--radius-md] border border-border-light bg-bg-base/40 p-4"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-bold text-text-muted">
                  {p.position}.
                </span>
                <div className="min-w-0 flex-1 text-sm text-text-primary">
                  <MathText text={p.question} />
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Student answer
                  </p>
                  <div className="mt-1 rounded-[--radius-sm] bg-surface px-2 py-1 text-sm text-text-primary">
                    {p.student_answer ? (
                      <MathText text={p.student_answer} />
                    ) : (
                      <span className="italic text-text-muted">Not typed</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Answer key
                  </p>
                  <div className="mt-1 rounded-[--radius-sm] bg-surface px-2 py-1 text-sm text-text-primary">
                    {p.final_answer ? (
                      <MathText text={p.final_answer} />
                    ) : (
                      <span className="italic text-text-muted">—</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IntegritySummary({
  overview,
}: {
  overview: NonNullable<TeacherSubmissionRow["integrity_overview"]>;
}) {
  const { overall_badge: badge, overall_status: status, problem_count, complete_count } =
    overview;
  if (status === "in_progress") {
    return (
      <p className="mt-3 text-[11px] text-text-muted">
        Integrity check in progress — {complete_count} of {problem_count} sampled
        problems graded.
      </p>
    );
  }
  if (!badge || badge === "likely") {
    return (
      <p className="mt-3 text-[11px] text-green-700 dark:text-green-400">
        ✓ Integrity check: student likely did the work themselves.
      </p>
    );
  }
  const cls =
    badge === "unlikely"
      ? "text-red-700 dark:text-red-400"
      : badge === "unreadable"
        ? "text-text-muted"
        : "text-amber-700 dark:text-amber-400";
  const label =
    badge === "unlikely"
      ? "⚠ Unlikely the student did this work themselves."
      : badge === "unreadable"
        ? "⚠ Handwriting unreadable — student flagged the extraction."
        : "⚠ Uncertain whether the student did this themselves.";
  return <p className={`mt-3 text-[11px] font-semibold ${cls}`}>{label}</p>;
}
