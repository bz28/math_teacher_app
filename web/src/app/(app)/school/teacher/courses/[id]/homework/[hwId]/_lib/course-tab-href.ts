/** The course tab an assignment is listed on: Practice for a practice
 *  set, Homework otherwise (and while the type is still loading). */
export function courseTabHref(courseId: string, type: string | null | undefined): string {
  return `/school/teacher/courses/${courseId}?tab=${type === "practice" ? "practice" : "homework"}`;
}
