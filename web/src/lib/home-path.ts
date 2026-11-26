/**
 * Where a signed-in user lands. Veradic is schools-only: teachers work in
 * their course portal, every student in the school-student portal (which
 * shows a join-a-class view until they're enrolled). The personal self-study
 * app (/home, /learn, /practice, /mock-test, /review, /history) is hidden.
 * Admins pass every teacher check in the API, so they share the teacher
 * portal (the student portal's guard would bounce them back in a loop).
 */
export function homePathFor(role: string | null | undefined): string {
  return role === "teacher" || role === "admin" ? "/school/teacher" : "/school/student";
}
