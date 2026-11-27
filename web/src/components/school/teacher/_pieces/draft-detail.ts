import type { DraftHomework } from "@/lib/api";

/** A draft's due date as its line says it. A draft is unpublished, so a
 *  date already behind it means students never saw it in time: said so,
 *  for the error ink, rather than reading like a date still to come. */
export function draftDue(
  dueAt: string | null,
  now: number,
  format: (iso: string) => string,
): { text: string; passed: boolean } | null {
  if (!dueAt) return null;
  const date = format(dueAt);
  return new Date(dueAt).getTime() < now
    ? { text: `due date passed (${date})`, passed: true }
    : { text: `due ${date}`, passed: false };
}

/** What's left on a draft: generated problems waiting on the teacher's
 *  approval first, since that's what holds it back; else how many
 *  problems it has. */
export function draftLeft(d: DraftHomework): string {
  if (d.pending_review > 0) {
    const n = d.pending_review;
    return `${n} problem${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your approval`;
  }
  if (d.problem_count > 0) return `${d.problem_count} problem${d.problem_count === 1 ? "" : "s"}`;
  return "no problems yet";
}
