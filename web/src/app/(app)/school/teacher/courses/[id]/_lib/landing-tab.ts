/** Where a course opens without ?tab=: its homework once there is any —
 *  that's the daily work — and Sections until then, where a new course
 *  is set up (and where the first-run tour starts). */
export function landingTab(course: { has_homework: boolean }): "homework" | "sections" {
  return course.has_homework ? "homework" : "sections";
}
