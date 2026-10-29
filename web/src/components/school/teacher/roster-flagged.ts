/** The review roster's "Flagged" rule. Pure so it can be tested directly. */

import type { TeacherSubmissionRow } from "@/lib/api";

export type FlaggedInput = Pick<
  TeacherSubmissionRow,
  "extraction_flagged_at" | "ai_grading_status" | "final_score" | "integrity_overview"
>;

/** True when the roster's Flagged filter lists this submission.
 *
 *  A row-for-row mirror of the server's `flagged_case`
 *  (api/routes/teacher_courses.py), which the inbox's "N flagged", the
 *  course pills and the needs-attention queue all count. The number a
 *  teacher clicks has to be the length of the list she lands on, so
 *  change one, change the other.
 *
 *  Two things are deliberately NOT here:
 *  - `tutor_pivot`: the student got it wrong on paper and was tutored
 *    through it — "a learning signal, not a cheating signal"
 *    (integrity_ai.py). It has an informational pill.
 *  - A check the student didn't finish (not_started / left_partway, or a
 *    reading never confirmed). That raises scrutiny with its own
 *    "Didn't finish check" pill, but walking away isn't evidence of
 *    anything, and integrity never auto-flags.
 */
export function isFlaggedSubmission(sub: FlaggedInput): boolean {
  // Student-raised "reader got something wrong": no AI ran, the teacher
  // grades from the photo.
  if (sub.extraction_flagged_at) return true;
  // The AI couldn't grade it (unreadable photo / too long) and nobody has
  // yet. No integrity row involved, so no resolution to check.
  if (
    (sub.ai_grading_status === "skipped_unreadable" ||
      sub.ai_grading_status === "skipped_too_long") &&
    sub.final_score === null
  ) {
    return true;
  }
  const overview = sub.integrity_overview;
  if (!overview) return false;
  // A teacher who marked the check reviewed has handled it.
  if (overview.resolution !== "unresolved") return false;
  if (overview.disposition === "flag_for_review") return true;
  if (overview.incomplete_reason === "unreadable") return true;
  // No verdict, and not because the student walked away: the turn cap,
  // or an old close with no recorded reason. Both wear the
  // "Inconclusive" pill, so both are in the list.
  return (
    overview.overall_status === "complete" &&
    !overview.disposition &&
    overview.incomplete_reason !== "not_started" &&
    overview.incomplete_reason !== "left_partway"
  );
}
