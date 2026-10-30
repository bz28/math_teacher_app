// Which screen a student's submitted homework belongs on, decided from
// server truth alone. Pure so every toggle combination can be tested
// without a browser — see homework-route.test.ts.
import type {
  IntegrityExtraction,
  IntegrityStateResponse,
  StudentSubmission,
  SubmissionFile,
} from "@/lib/api";

export type HomeworkMode =
  | { kind: "homework" }
  | { kind: "integrity_pending" }
  | { kind: "integrity_pending_timeout" }
  | {
      kind: "integrity_confirm";
      extraction: IntegrityExtraction;
      files: SubmissionFile[];
      integrityCheckEnabled: boolean;
    }
  | { kind: "integrity_chat" }
  /** Student flagged "reader got something wrong" on the confirm
   *  screen. Submission is routed to the teacher for manual
   *  grading; no AI calls run. Terminal — nothing else to do. */
  | { kind: "extraction_flagged" };

/** Always returns a mode — never "leave it as it is". The page calls
 *  this after every re-fetch, including from inside the confirm screen
 *  and the preparing screen; keeping the current mode there would
 *  strand the student on a screen that has already done its job.
 *
 *  `sub` / `integrity` are null when their fetch failed. The toggles are
 *  read as they are now, and a published grade means the loop has moved
 *  on — the same rule as the server's "one more step" nudge
 *  (`student_next_step` in api/core/integrity_pipeline.py). Precedence
 *  (top match wins):
 *   1. Flagged       — student said "reader got it wrong". Nothing
 *                      downstream ran; terminal screen.
 *   2. Extracting    — the reader hasn't finished. Preparing spinner +
 *                      poll, unless no toggle is on or the grade is
 *                      already published: nothing is waiting on it.
 *   3. Awaiting confirm — reading done, student hasn't pressed
 *                      Confirm/Flag, and something still waits on that
 *                      press (a toggle is on, no published grade).
 *                      Integrity + grading wait on it, so the
 *                      integrity-state endpoint can't tell this apart
 *                      from "extracting"; drive it off the submission row.
 *   4. Integrity state — after confirm: "extracting" → preparing,
 *                      "awaiting_student" / "in_progress" → chat, and
 *                      everything else ("no_check" when the check is
 *                      off, "complete", "skipped_unreadable") → the
 *                      submitted view. A failed fetch with the check on
 *                      goes to preparing, which polls until it knows. */
export function routeSubmittedHomework(
  sub: StudentSubmission | null,
  integrity: IntegrityStateResponse | null,
  gradePublished: boolean,
): HomeworkMode {
  if (sub?.extraction_flagged_at != null) return { kind: "extraction_flagged" };
  const waitingOnReading =
    sub != null &&
    !gradePublished &&
    (sub.integrity_check_enabled || sub.ai_grading_enabled);
  if (sub && sub.extraction == null) {
    return waitingOnReading ? { kind: "integrity_pending" } : { kind: "homework" };
  }
  if (sub && sub.extraction != null && sub.extraction_confirmed_at == null) {
    if (!waitingOnReading) return { kind: "homework" };
    if (sub.files != null && sub.files.length > 0) {
      return {
        kind: "integrity_confirm",
        extraction: sub.extraction,
        files: sub.files,
        integrityCheckEnabled: sub.integrity_check_enabled,
      };
    }
  }
  if (integrity == null) {
    return sub?.extraction_confirmed_at != null && sub.integrity_check_enabled
      ? { kind: "integrity_pending" }
      : { kind: "homework" };
  }
  switch (integrity.overall_status) {
    case "extracting":
      return { kind: "integrity_pending" };
    case "awaiting_student":
    case "in_progress":
      return { kind: "integrity_chat" };
    default:
      return { kind: "homework" };
  }
}
