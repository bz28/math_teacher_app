"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  schoolStudent,
  type DashboardGrade,
  type StudentGradesResponse,
} from "@/lib/api";
import { StudentGradeRow } from "@/components/school/student/student-grade-row";
import {
  percentTone,
  STRONG_THRESHOLD,
  STRUGGLING_THRESHOLD,
} from "@/components/school/shared/percent-badge";

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
  // Frontend-side average so the student gets the headline number
  // without a backend round-trip. No course-scoping yet; v1 is the
  // pooled across-courses figure, which matches the page scope.
  const overallAverage = useMemo(() => {
    const grades = data?.grades ?? [];
    if (grades.length === 0) return null;
    const sum = grades.reduce((acc, g) => acc + g.final_score, 0);
    return Math.round(sum / grades.length);
  }, [data]);

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

      {/* Headline stat — overall avg at a glance. Hidden when there's
          nothing graded yet (the empty-state CTA covers that case).
          Tone uses the shared `percentTone` so the headline number's
          color matches what individual row pills (PercentBadge) show:
          single source of truth for "what counts as strong vs
          struggling" prevents the dashboard avg from disagreeing
          visually with the rows below. */}
      {!empty && overallAverage !== null && (
        <div className="mb-5 rounded-[--radius-xl] border border-border-light bg-surface p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Overall average
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-4xl font-extrabold tabular-nums ${percentTone(overallAverage)}`}>
              {overallAverage}
            </span>
            <span className="text-2xl font-semibold text-text-muted">%</span>
            <span className="ml-2 text-xs text-text-muted">
              across {sorted.length} {sorted.length === 1 ? "assignment" : "assignments"}
              {" · "}
              {`${STRONG_THRESHOLD}+ strong, under ${STRUGGLING_THRESHOLD} needs work`}
            </span>
          </div>
        </div>
      )}

      {empty ? (
        <div className="rounded-[--radius-xl] border border-dashed border-border-light bg-bg-subtle p-12 text-center">
          <p className="text-sm text-text-muted">No graded work yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface">
          {sorted.map((g, i) => (
            <StudentGradeRow
              key={`${g.assignment_id}-${i}`}
              grade={g}
              variant="detailed"
            />
          ))}
        </div>
      )}
    </div>
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
