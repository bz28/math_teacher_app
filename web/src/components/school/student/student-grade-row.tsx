import Link from "next/link";
import type { DashboardGrade } from "@/lib/api";
import { PercentBadge } from "@/components/school/shared/percent-badge";
import { formatRelativeDate } from "@/lib/utils";
import { CourseAvatar } from "./dashboard-card";

/**
 * Shared row for a published grade. Used on the Today dashboard's
 * "Recently graded" card (compact, relative date inline) and on the
 * My Grades list (detailed, absolute date stacked under the badge).
 *
 * v1 is score-only: no breakdown, teacher notes, or AI reasoning.
 */
export function StudentGradeRow({
  grade,
  variant,
}: {
  grade: DashboardGrade;
  /**
   * - "compact": relative date inline in subtitle ("published 2d ago").
   * - "detailed": absolute date stacked below the badge.
   */
  variant: "compact" | "detailed";
}) {
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
          {variant === "compact" && (
            <> · published {formatRelativeDate(grade.published_at)}</>
          )}
        </div>
      </div>
      {variant === "compact" ? (
        <PercentBadge
          percent={grade.final_score}
          size="lg"
          className="shrink-0"
        />
      ) : (
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
      )}
    </Link>
  );
}
