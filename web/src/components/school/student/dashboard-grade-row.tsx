import Link from "next/link";
import type { DashboardGrade } from "@/lib/api";
import { PercentBadge } from "@/components/school/shared/percent-badge";
import { CourseAvatar } from "./dashboard-card";

/**
 * Row used inside the Recently graded card. Shows the shared
 * PercentBadge as the visual anchor — nothing else about the grade
 * is exposed in v1 (no feedback, no teacher notes).
 */
export function DashboardGradeRow({ grade }: { grade: DashboardGrade }) {
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
          {grade.course_name} · {grade.section_name} · published{" "}
          {formatPublishedDate(published)}
        </div>
      </div>
      <PercentBadge percent={grade.final_score} size="lg" className="shrink-0" />
    </Link>
  );
}

function formatPublishedDate(d: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
