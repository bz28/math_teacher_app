"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { teacher, type StudentGradesResponse } from "@/lib/api";
import { PercentBadge } from "@/components/school/shared/percent-badge";

/**
 * Grades → Student detail page.
 *
 * Route: /school/teacher/courses/[id]/grades/[sectionId]/students/[studentId]
 *
 * Pure read view of a single student's published grades within one
 * section. Section is in the URL (not inferred from enrollment) so a
 * dual-enrolled student gets the correct section's numbers and the
 * URL is bookmark-stable.
 *
 * Header summary = overall avg + graded/missing counts + class avg.
 * Body = chronological list of published HWs (newest first) with
 * score + date + comment excerpt; muted Missing section at bottom.
 * Each HW row links into the existing per-HW review page.
 */
export default function StudentGradesPage({
  params,
}: {
  params: Promise<{ id: string; sectionId: string; studentId: string }>;
}) {
  const { id: courseId, sectionId, studentId } = use(params);
  const backHref = `/school/teacher/courses/${courseId}?tab=grades`;

  const [data, setData] = useState<StudentGradesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .studentGrades(courseId, sectionId, studentId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load grades");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionId, studentId]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <BackLink href={backHref} />
        <p className="mt-6 text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <BackLink href={backHref} />
        <p className="mt-6 text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <BackLink href={backHref} />

      <header className="mt-4">
        <h1 className="text-2xl font-bold text-text-primary">{data.student.name}</h1>
        <p className="mt-0.5 text-sm text-text-muted">{data.student.section_name}</p>
      </header>

      <SummaryBar data={data} />

      <section className="mt-10">
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Published homework
        </h2>
        {data.published_hws.length === 0 ? (
          <p className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-6 text-center text-xs text-text-muted">
            No grades published yet for this student.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.published_hws.map((hw) => (
              <PublishedHwRow
                key={hw.assignment_id}
                hw={hw}
                courseId={courseId}
                sectionId={sectionId}
              />
            ))}
          </div>
        )}
      </section>

      {data.missing_hws.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Missing
          </h2>
          <div className="mt-3 space-y-2">
            {data.missing_hws.map((hw) => (
              <MissingHwRow key={hw.assignment_id} hw={hw} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-primary"
    >
      ← Back to Grades
    </Link>
  );
}

function SummaryBar({ data }: { data: StudentGradesResponse }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SummaryStat
        label="Overall"
        value={data.overall_avg === null ? "—" : `${Math.round(data.overall_avg)}%`}
        emphasize
      />
      <SummaryStat
        label="Graded"
        value={`${data.graded_count}`}
      />
      <SummaryStat
        label="Missing"
        value={`${data.missing_count}`}
        tone={data.missing_count > 0 ? "red" : "neutral"}
      />
      <SummaryStat
        label="Class avg"
        value={data.class_avg === null ? "—" : `${Math.round(data.class_avg)}%`}
      />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  emphasize,
  tone,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: "red" | "neutral";
}) {
  const valueCls = emphasize
    ? "text-3xl font-bold text-text-primary"
    : tone === "red"
      ? "text-xl font-bold text-red-700 dark:text-red-400"
      : "text-xl font-bold text-text-primary";
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className={`mt-1 ${valueCls}`}>{value}</div>
    </div>
  );
}

function PublishedHwRow({
  hw,
  courseId,
  sectionId,
}: {
  hw: StudentGradesResponse["published_hws"][number];
  courseId: string;
  sectionId: string;
}) {
  // Link into the existing per-HW review page — the teacher can
  // see the full breakdown there. sectionId in the HW link matches
  // the section we're viewing on this page.
  const href = `/school/teacher/courses/${courseId}/homework/${hw.assignment_id}/sections/${sectionId}/review`;
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-[--radius-md] border border-border-light bg-surface px-4 py-3 transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-text-primary">{hw.title}</div>
        {hw.due_at && (
          <div className="mt-0.5 text-[11px] text-text-muted">
            Due {formatDate(hw.due_at)}
          </div>
        )}
        {hw.teacher_notes && (
          <div className="mt-1 line-clamp-2 text-xs italic text-text-secondary">
            “{hw.teacher_notes}”
          </div>
        )}
      </div>
      {hw.final_score === null ? (
        <span className="shrink-0 rounded-[--radius-pill] border border-border-light bg-bg-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Not graded yet
        </span>
      ) : (
        <PercentBadge percent={hw.final_score} size="lg" className="shrink-0" />
      )}
    </Link>
  );
}

function MissingHwRow({ hw }: { hw: StudentGradesResponse["missing_hws"][number] }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[--radius-md] border border-border-light bg-bg-subtle px-4 py-3 opacity-75">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-secondary">{hw.title}</div>
        {hw.due_at && (
          <div className="mt-0.5 text-[11px] text-text-muted">
            Was due {formatDate(hw.due_at)}
          </div>
        )}
      </div>
      <span className="shrink-0 rounded-[--radius-pill] border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        Missing
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}
