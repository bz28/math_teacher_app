/** Whether to tell the teacher that nobody vouched for the transcript
 *  they are grading from. Pure so it can be tested directly. */

export interface ReadingTrustInput {
  /** Non-null exactly when a reading exists. An assignment with both AI
   *  toggles off never extracts, and then there is nothing to vouch for —
   *  without this gate the strip would fire on every one of its
   *  submissions and blame the student for the teacher's own setting. */
  extraction_confidence: number | null;
  /** Null means the student never signed off on the reading. */
  extraction_confirmed_at: string | null;
  /** Set means the student said the reader got it wrong. That has its own
   *  louder red callout, which also states that AI grading was skipped. */
  extraction_flagged_at: string | null;
}

/** True when the teacher is grading from a transcript nobody has checked.
 *
 *  Deliberately NOT gated on the reader's own confidence score, though an
 *  earlier version of this file was. That score does not separate good
 *  readings from bad ones:
 *
 *  - Across 82 graded problems, 0.72 carries the same 16% flattering rate
 *    as 0.62 — so any cut between them is arbitrary.
 *  - The model emits a coarse ladder (0.42, 0.52, 0.62, 0.72, 0.82, 0.88),
 *    so a threshold is really a choice of which rung to include, not a
 *    tunable dial.
 *  - In probe runs the reader invented an answer while reporting 0.72,
 *    and read a page correctly while reporting 0.45.
 *
 *  The root reason is that a reader which cannot make out the ink does not
 *  know it cannot: it sees a shape, the question implies a value, and it
 *  reports having read one. Self-reported confidence cannot catch an error
 *  the reporter is unaware of. A warning that misses a third of real cases
 *  and fires on clean pages only teaches teachers to ignore warnings.
 *
 *  "Nobody checked this" carries none of that: it is a fact about what did
 *  or did not happen, true every time it is shown.
 */
export function needsReadingCheck(d: ReadingTrustInput): boolean {
  // The student's explicit "the reader got this wrong" has its own callout.
  if (d.extraction_flagged_at) return false;
  if (d.extraction_confidence === null) return false;
  // No time gate, on purpose. A teacher watching submissions arrive sees
  // this during the ordinary window between the read and the student's tap;
  // that window is exactly when the transcript is unvouched-for, so saying
  // so is correct rather than premature.
  return d.extraction_confirmed_at === null;
}

export const READING_TRUST_COPY = {
  title: "The student hasn't confirmed this reading — compare it with the photo",
  // Nothing here about when grading runs: a teacher can regrade an
  // unconfirmed submission by hand (`regrade_submission` forces it), so
  // this strip renders over an already-graded row often enough that any
  // claim about grading would be contradicted by the screen it sits on.
  body: "Nobody has checked the work below against their paper.",
};
