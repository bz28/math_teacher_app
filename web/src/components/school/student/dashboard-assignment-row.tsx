import Link from "next/link";
import type { DashboardAssignment } from "@/lib/api";
import { CourseAvatar } from "./dashboard-card";
import { UrgencyPill } from "./urgency-pill";

/**
 * Row used inside Due this week and Overdue subsections on the
 * student dashboard. Click target is the HW detail page. The
 * In-review bucket renders as a status sentence, not rows, so this
 * component always shows the urgency pill.
 */
export function DashboardAssignmentRow({
  assignment,
}: {
  assignment: DashboardAssignment;
}) {
  return (
    <Link
      href={`/school/student/courses/${assignment.course_id}/homework/${assignment.assignment_id}`}
      className="group flex items-center gap-3 border-b border-border-light/60 px-5 py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
    >
      <CourseAvatar
        courseId={assignment.course_id}
        courseName={assignment.course_name}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary group-hover:text-primary">
          {assignment.title}
        </div>
        <div className="truncate text-xs text-text-muted">
          {assignment.course_name} · {assignment.section_name}
        </div>
      </div>
      <UrgencyPill dueAt={assignment.due_at} />
      <svg
        className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
