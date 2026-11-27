// The review page's URL is its address for "this student, this problem":
// ?student=<id> picks the student, ?problem=<n> opens a problem on them.
// A report's page_url is built from it, so these must stay exact.

/** A section's review page opened on one student. Every link into the
 *  review page from somewhere that is about one student (their history,
 *  a gradebook cell) must name them, or the page opens on whoever it
 *  picks first and the teacher is looking at the wrong child. */
export function studentReviewHref(
  courseId: string,
  assignmentId: string,
  sectionId: string,
  studentId: string,
): string {
  return `/school/teacher/courses/${courseId}/homework/${assignmentId}/sections/${sectionId}/review?student=${encodeURIComponent(studentId)}`;
}

/** The ?problem= focus a review URL asks for, or null. Only meaningful
 *  alongside a ?student= — a problem number alone names nothing. */
export function parseProblemFocus(
  student: string | null,
  problem: string | null,
): { studentId: string; position: number } | null {
  const position = Number(problem);
  return student && problem && Number.isInteger(position) && position >= 1
    ? { studentId: student, position }
    : null;
}

/** `href` with ?student= set to the selected student, dropping ?problem=
 *  unless it still applies. Null when the URL already says exactly that,
 *  so the caller can skip a no-op history write. */
export function withSelectedStudent(
  href: string,
  studentId: string,
  keepProblem: boolean,
): string | null {
  const url = new URL(href);
  if (
    url.searchParams.get("student") === studentId &&
    (keepProblem || !url.searchParams.has("problem"))
  ) {
    return null;
  }
  url.searchParams.set("student", studentId);
  if (!keepProblem) url.searchParams.delete("problem");
  return url.toString();
}

/** The page a report was filed from, pointed at what it's about: a
 *  per-problem report adds ?problem=<n>, anything else drops a stale one. */
export function withReportedProblem(href: string, position: number | null | undefined): string {
  const url = new URL(href);
  if (position) url.searchParams.set("problem", String(position));
  else url.searchParams.delete("problem");
  return url.toString();
}
