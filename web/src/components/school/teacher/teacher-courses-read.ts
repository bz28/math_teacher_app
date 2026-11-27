/** When the shell's course list is read again, and which course a URL is in. */

export const READ_EVERY_MS = 30_000;
export type CoursesRead = { at: number; scope: string | null };

/** Read at once on moving between courses (or to and from home), else at
 *  most every READ_EVERY_MS: GET /teacher/courses totals every course. */
export function shouldReadCourses(last: CoursesRead | null, scope: string | null, now: number): boolean {
  return last === null || last.scope !== scope || now - last.at >= READ_EVERY_MS;
}

/** The course the URL is inside, if any: /school/teacher/courses/<id>/… */
export function courseIdFromPath(pathname: string | null): string | null {
  return pathname?.match(/^\/school\/teacher\/courses\/([^/?#]+)/)?.[1] ?? null;
}

