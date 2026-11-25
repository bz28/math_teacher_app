/**
 * Where a signed-in user lands. Veradic is schools-only: teachers work in
 * their course portal, every student in the school-student portal (which
 * shows a join-a-class view until they're enrolled). The personal self-study
 * app (/home, /learn, /practice, /mock-test, /review, /history) is hidden.
 */
export function homePathFor(role: string | null | undefined): string {
  return role === "teacher" ? "/school/teacher" : "/school/student";
}
