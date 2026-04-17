"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  schoolStudent,
  type DashboardGrade,
  type StudentGradesResponse,
} from "@/lib/api";
import { PercentBadge } from "@/components/school/shared/percent-badge";
import { CourseAvatar } from "@/components/school/student/dashboard-card";

type Sort = "date_desc" | "date_asc" | "score_desc" | "score_asc";

/**
 * My Grades — every published grade across every enrolled section,
 * newest first by default. Sortable by date or score. No trends,
 * no rank, no feedback; v1 is a record-only view.
 */
export default function StudentGradesPage() {
  const [data, setData] = useState<StudentGradesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("date_desc");

  const load = useCallback(() => {
    schoolStudent
      .getAllGrades()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch(() => setError("Couldn't load your grades. Please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const sorted = useMemo(() => sortGrades(data?.grades ?? [], sort), [data, sort]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <p className="text-error">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 h-8 w-40 animate-pulse rounded-[--radius-sm] bg-surface-hover" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-[--radius-md] bg-surface-hover"
            />
          ))}
        </div>
      </div>
    );
  }

  const empty = sorted.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">
            My Grades
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {empty
              ? "Your grades will appear here once your teacher publishes them."
              : `${sorted.length} graded ${sorted.length === 1 ? "assignment" : "assignments"}`}
          </p>
        </div>
        {!empty && (
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
            aria-label="Sort grades"
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="score_desc">Highest score</option>
            <option value="score_asc">Lowest score</option>
          </select>
        )}
      </div>

      {empty ? (
        <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-12 text-center">
          <p className="text-sm text-text-muted">No graded work yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface">
          {sorted.map((g, i) => (
            <GradeRow key={`${g.assignment_id}-${i}`} grade={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function GradeRow({ grade }: { grade: DashboardGrade }) {
  const published = new Date(grade.published_at);
  return (
    <Link
      href={`/school/student/courses/${grade.course_id}/homework/${grade.assignment_id}`}
      className="group flex items-center gap-3 border-b border-border-light/60 px-5 py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
    >
      <CourseAvatar courseId={grade.course_id} courseName={grade.course_name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary group-hover:text-primary">
          {grade.title}
        </div>
        <div className="truncate text-xs text-text-muted">
          {grade.course_name} · {grade.section_name}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <PercentBadge percent={grade.final_score} size="lg" />
        <div className="mt-0.5 text-[11px] text-text-muted">
          {published.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
    </Link>
  );
}

function sortGrades(grades: DashboardGrade[], sort: Sort): DashboardGrade[] {
  const copy = [...grades];
  switch (sort) {
    case "date_desc":
      return copy.sort(
        (a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    case "date_asc":
      return copy.sort(
        (a, b) =>
          new Date(a.published_at).getTime() - new Date(b.published_at).getTime(),
      );
    case "score_desc":
      return copy.sort((a, b) => b.final_score - a.final_score);
    case "score_asc":
      return copy.sort((a, b) => a.final_score - b.final_score);
  }
}
