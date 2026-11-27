import type { DraftHomework } from "@/lib/api";

/** A draft's one line under its title: course, due date, and what's
 *  left — generated problems waiting on the teacher's approval first,
 *  since that's what holds it back; else how many problems it has. */
export function draftDetail(d: DraftHomework, due: string | null): string {
  const parts = [d.course_name];
  if (due) parts.push(`due ${due}`);
  if (d.pending_review > 0) {
    parts.push(`${d.pending_review} problem${d.pending_review === 1 ? "" : "s"} need${d.pending_review === 1 ? "s" : ""} your approval`);
  } else if (d.problem_count > 0) {
    parts.push(`${d.problem_count} problem${d.problem_count === 1 ? "" : "s"}`);
  } else {
    parts.push("no problems yet");
  }
  return parts.join(" · ");
}
