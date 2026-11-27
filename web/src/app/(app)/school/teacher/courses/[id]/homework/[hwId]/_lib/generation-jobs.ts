/**
 * The ids of generation jobs still writing problems for a homework, kept
 * in sessionStorage under `hw-gen-<homework id>`. The new-homework and
 * new-practice wizards hand their jobs over this way; the homework page
 * shows their progress, and the question review page polls them to grow
 * its queue and to hold "Publish homework" until they finish.
 */
export function generationJobsKey(assignmentId: string): string {
  return `hw-gen-${assignmentId}`;
}

/** Parses the stored list; null for anything that isn't a list of ids. */
export function parseGenerationJobs(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** The stored list with `jobId` added once. */
export function withGenerationJob(raw: string | null, jobId: string): string {
  const ids = parseGenerationJobs(raw) ?? [];
  return JSON.stringify(ids.includes(jobId) ? ids : [...ids, jobId]);
}

/** Adds a job started on the homework page ("Generate more"), so the
 *  question review page sees it the same way it sees the wizard's. */
export function rememberGenerationJob(assignmentId: string, jobId: string): void {
  const key = generationJobsKey(assignmentId);
  sessionStorage.setItem(key, withGenerationJob(sessionStorage.getItem(key), jobId));
}
