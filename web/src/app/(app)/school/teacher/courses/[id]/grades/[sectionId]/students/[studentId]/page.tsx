"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { teacher, type StudentGradesResponse } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { PercentBadge } from "@/components/school/shared/percent-badge";
import { PracticeEngagement } from "@/components/school/teacher/practice-engagement";
import { Skeleton } from "@/components/ui/skeleton";

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
        <p className="mt-6 text-sm text-[color:var(--color-error)]">{error}</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <BackLink href={backHref} />
        <StudentGradesSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <BackLink href={backHref} />

      <header className="mt-3">
        <h1 className="font-serif text-[34px] leading-tight tracking-[-0.015em] text-text-primary">{data.student.name}</h1>
        <p className="mt-1 font-serif italic text-[15px] text-text-muted">{data.student.section_name}</p>
      </header>

      <SummaryBar data={data} />

      <section className="mt-10">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
          Published homework
        </h2>
        {data.published_hws.length === 0 ? (
          <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] p-6 text-center text-xs text-text-muted">
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
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Missing
          </h2>
          <div className="mt-3 space-y-2">
            {data.missing_hws.map((hw) => (
              <MissingHwRow key={hw.assignment_id} hw={hw} />
            ))}
          </div>
        </section>
      )}

      {/* Ungraded practice/learn engagement — sits below the graded
          record as a deliberately formative, non-score readout. */}
      <PracticeEngagement
        courseId={courseId}
        sectionId={sectionId}
        studentId={studentId}
      />
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

/**
 * Initial-load placeholder for the student grades page. Mirrors the real
 * silhouette — name + section header, the four-stat summary grid, then a
 * published-homework eyebrow over a few score rows — so the page settles
 * in place rather than blanking to "Loading…".
 */
function StudentGradesSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <header className="mt-3 space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </header>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[--radius-md] border border-border-light bg-surface p-4"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
        ))}
      </div>
      <section className="mt-10">
        <Skeleton className="h-3 w-40" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-[--radius-md] border border-border-light bg-surface p-4"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-6 w-12 rounded-[--radius-pill]" />
            </div>
          ))}
        </div>
      </section>
    </div>
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
      ? "text-xl font-bold text-[color:var(--color-error)] "
      : "text-xl font-bold text-text-primary";
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
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
        <span className="shrink-0 rounded-[--radius-pill] border border-border-light bg-[color:var(--color-surface-alt-2)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
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
    <div className="flex items-center justify-between gap-4 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-4 py-3 opacity-75">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-secondary">{hw.title}</div>
        {hw.due_at && (
          <div className="mt-0.5 text-[11px] text-text-muted">
            Was due {formatDate(hw.due_at)}
          </div>
        )}
      </div>
      <span className="shrink-0 rounded-[--radius-pill] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-error)]  dark:bg-[color:var(--color-error-light)] ">
        Missing
      </span>
    </div>
  );
}

