/** A student's history (grades, checks, practice) in one section of a
 *  course: where every student's name in the teacher portal leads. */
export function studentHistoryHref(courseId: string, sectionId: string, studentId: string): string {
  return `/school/teacher/courses/${courseId}/grades/${sectionId}/students/${encodeURIComponent(studentId)}`;
}
