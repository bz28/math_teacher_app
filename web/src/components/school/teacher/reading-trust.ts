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
  // No time gate on purpose. A teacher watching submissions arrive sees
  // this during the ordinary window between the read finishing and the
  // student pressing Confirm, so the copy states the fact ("hasn't
  // confirmed") rather than inferring a cause ("closed the app"). Prod:
  // median confirm is 108s after the read, but p90 is 11min and p99 ~3h,
  // so any threshold would call a slow-but-present student absent.
  if (d.extraction_confirmed_at === null) return "unconfirmed";
  if (d.extraction_confidence < LOW_READ_CONFIDENCE) return "low-confidence";
  return null;
}

/** The strip's wording, here rather than in the page so it is covered by
 *  the same tests as the conditions. The unconfirmed case states a FACT
 *  ("hasn't confirmed") and never infers a cause: a teacher watching
 *  submissions land sees this during the ordinary confirm window, and
 *  telling them a present student "closed the app" is both wrong and the
 *  kind of thing that makes a teacher stop trusting the strip. */
export const READING_TRUST_COPY: Record<
  Exclude<ReadingTrustWarning, null>,
  { title: string; body: string }
> = {
  unconfirmed: {
    title: "The student hasn't confirmed this reading — compare it with the photo",
    body:
      "Nobody has checked the work below against their paper, and AI grading only " +
      "runs once they confirm. Students usually confirm within a couple of minutes, " +
      "but some take hours.",
  },
  "low-confidence": {
    title: "The reader wasn't confident about this page — compare it with the photo",
    body:
      "On a hard-to-read page the reader can fill in what a problem expects instead " +
      "of what the student wrote, which makes a wrong answer look right.",
  },
};
