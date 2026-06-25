// Practice sets are ungraded — the problems ship their final_answer, so the
// student self-checks client-side. Pure (no RN imports) for unit testing.

export function normalizeAnswer(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Lenient equality for a self-check: whitespace/case-insensitive exact match. */
export function isAnswerCorrect(student: string, correct: string | null | undefined): boolean {
  if (!correct) return false;
  const a = normalizeAnswer(student);
  return a.length > 0 && a === normalizeAnswer(correct);
}

/** Dedupe enrolled sections down to unique courses (a student can be in several
 *  sections of the same course). */
export function uniqueCourses<T extends { course_id: string }>(classes: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of classes) {
    if (seen.has(c.course_id)) continue;
    seen.add(c.course_id);
    out.push(c);
  }
  return out;
}
