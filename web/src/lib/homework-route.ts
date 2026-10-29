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
 *  `sub` / `integrity` are null when their fetch failed. Precedence
 *  (top match wins):
 *   1. Flagged       — student said "reader got it wrong". Nothing
 *                      downstream ran; terminal screen.
 *   2. Extracting    — the reader hasn't finished. Preparing spinner +
 *                      poll, unless neither toggle is on, in which case
 *                      no extraction will ever come.
 *   3. Awaiting confirm — reading done, student hasn't pressed
 *                      Confirm/Flag. Integrity + grading wait on that
 *                      press, so the integrity-state endpoint can't tell
 *                      this apart from "extracting"; drive it off the
 *                      submission row.
 *   4. Integrity state — after confirm: "extracting" → preparing,
 *                      "awaiting_student" / "in_progress" → chat, and
 *                      everything else ("no_check" when the check is
 *                      off, "complete", "skipped_unreadable", or a
 *                      failed fetch) → the submitted view. */
export function routeSubmittedHomework(
  sub: StudentSubmission | null,
  integrity: IntegrityStateResponse | null,
): HomeworkMode {
  if (sub?.extraction_flagged_at != null) return { kind: "extraction_flagged" };
  if (sub && sub.extraction == null) {
    if (!sub.integrity_check_enabled && !sub.ai_grading_enabled) {
      return { kind: "homework" };
    }
    return { kind: "integrity_pending" };
  }
  if (
    sub &&
    sub.extraction != null &&
    sub.extraction_confirmed_at == null &&
    sub.files != null &&
    sub.files.length > 0
  ) {
    return {
      kind: "integrity_confirm",
      extraction: sub.extraction,
      files: sub.files,
      integrityCheckEnabled: sub.integrity_check_enabled,
    };
  }
  switch (integrity?.overall_status) {
    case "extracting":
      return { kind: "integrity_pending" };
    case "awaiting_student":
    case "in_progress":
      return { kind: "integrity_chat" };
    default:
      return { kind: "homework" };
  }
}
