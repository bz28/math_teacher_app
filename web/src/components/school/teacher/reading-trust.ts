/** Whether to warn the teacher that the transcript they're grading from
 *  hasn't been vouched for. Pure so it can be tested directly — the
 *  conditions are subtle and one of them (see `extraction_confidence`)
 *  shipped wrong the first time. */

/** Below this, the reader's own confidence is low enough that the teacher
 *  should compare the transcript against the photo before approving. Set at
 *  0.65 from prod: clean phone photos score 0.82-0.92, while every misread
 *  found by hand sat at 0.62 or below. Deliberately far above the 0.3
 *  unreadable gate, which is for pages we refuse to grade at all. */
export const LOW_READ_CONFIDENCE = 0.65;

export interface ReadingTrustInput {
  /** Null when there is no reading at all — AI grading and the
   *  understanding check are both off so extraction never runs, the read
   *  is still in flight, or it failed. */
  extraction_confidence: number | null;
  /** Null means the student never signed off on the reading. */
  extraction_confirmed_at: string | null;
  /** Set means the student said the reader got it wrong — its own louder
   *  callout owns that case. */
  extraction_flagged_at: string | null;
}

export type ReadingTrustWarning = "unconfirmed" | "low-confidence" | null;

export function readingTrustWarning(d: ReadingTrustInput): ReadingTrustWarning {
  // The student's explicit "the reader got this wrong" has its own callout.
  if (d.extraction_flagged_at) return null;
  // No reading => nothing to distrust. Without this the strip would tell
  // the teacher, on every submission of an assignment with both AI
  // toggles off, that the student closed the app — blaming a student for
  // the teacher's own setting.
  if (d.extraction_confidence === null) return null;
  if (d.extraction_confirmed_at === null) return "unconfirmed";
  if (d.extraction_confidence < LOW_READ_CONFIDENCE) return "low-confidence";
  return null;
}
