// What a student is told when turning in work goes wrong, and how we
// recognise a file the server will refuse.
//
// Deliberately dependency-free so it runs under the plain Node test
// runner (`node --experimental-strip-types --test`), the same shape as
// auth-refresh.test.ts.
//
// ── Why this file exists ──────────────────────────────────────────────
// On 2026-09-10 a student tried to turn in homework three times across
// two days and was told "Something went wrong turning in your work.
// Please try again" every time. The server had actually answered
// `400 File 1: Unsupported file format (only JPEG, PNG, and PDF are
// accepted)` — it knew exactly what was wrong, and the client replaced
// that with a line carrying no information and an instruction to repeat
// the thing that had just failed. He re-signed-in four times in three
// minutes looking for a login problem, then stopped trying. He has
// never turned in a single assignment.
//
// Two separate defects put him there, and both live here now.

/** The three formats the API accepts. Mirrors `validate_and_decode_upload`
 *  in api/core/image_utils.py. */
export type UploadMediaType = "image/jpeg" | "image/png" | "application/pdf";

/** Bytes needed to identify any supported format. PNG's signature is the
 *  longest at 8. */
export const SNIFF_BYTES = 8;

/** Identify an upload from its leading bytes, or null if it is not a
 *  format the API accepts.
 *
 *  This is a byte-for-byte mirror of the server's check
 *  (api/core/image_utils.py:57-71) and that is the whole point: because
 *  the two tests are identical, this can never reject a file the server
 *  would have accepted. It can only ever tell the student sooner what
 *  the server was going to say anyway.
 *
 *  The client used to trust `File.type`, which the browser derives from
 *  the FILENAME, not the contents — so anything renamed `.png` sailed
 *  through. Worse, the failure was size-dependent and therefore
 *  invisible in testing: a file over 5MB gets decoded by
 *  `createImageBitmap` during resizing, which throws on a non-image and
 *  produces a clean per-row error, while a file under 5MB is passed
 *  through untouched and never decoded at all. The student's file was
 *  7.2 KB.
 */
export function sniffUploadType(head: Uint8Array): UploadMediaType | null {
  // \x89PNG\r\n\x1a\n
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e &&
    head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a &&
    head[6] === 0x1a && head[7] === 0x0a
  ) {
    return "image/png";
  }
  // \xff\xd8 — every JPEG variant starts SOI.
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) {
    return "image/jpeg";
  }
  // %PDF-
  if (
    head.length >= 5 &&
    head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 &&
    head[3] === 0x46 && head[4] === 0x2d
  ) {
    return "application/pdf";
  }
  return null;
}

/** Shown when a staged file is not one of the three accepted formats.
 *  Says what to DO, not what the format was — "your file is WebP" helps
 *  nobody in year 9. */
export const UNREADABLE_FILE_ERROR =
  "That file isn't a photo we can read. Take a new picture with your " +
  "camera, or save it as a JPEG, and add it again.";

export const SUBMIT_FALLBACK_ERROR =
  "Something went wrong turning in your work. Please try again.";

/** The student-facing line for a failed submit, by HTTP status.
 *
 *  Every status below is one `POST /school/student/homework/{id}/submit`
 *  can genuinely return. Enumerated from the handler rather than guessed
 *  — `submit_homework` and `_load_assignment_for_student` in
 *  api/routes/school_student_practice.py, plus auth and the request-size
 *  middleware:
 *
 *    400  the per-file validation loop — the ONLY 400 in the handler, so
 *         a 400 here always means a bad file and nothing else
 *    401  access token lapsed
 *    403  not enrolled, or the homework was unpublished
 *    404  the assignment is gone, or the id is not a homework
 *    409  already turned in
 *    413  total payload too large (handler or middleware)
 *
 *  422 is deliberately absent: the two `SubmitHomeworkRequest`
 *  validators ("at least one file", "maximum 10 files") are both
 *  unreachable, because the submit button is disabled with zero valid
 *  files and the picker caps staging at MAX_FILES = 10, the same number
 *  as the server's MAX_SUBMISSION_FILES. If either cap ever drifts, 422
 *  falls through to the fallback below, which is safe but unhelpful —
 *  so keep them in step.
 *
 *  We still do NOT echo the server's `detail`. One of the three possible
 *  400 strings is "Invalid base64 data", which means nothing to a
 *  student; the replacements below say what to do instead.
 */
export function submitErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return UNREADABLE_FILE_ERROR;
    case 401:
      return "You've been signed out. Sign in again, then turn in your work.";
    case 403:
      return "This homework isn't open to you right now — check with your teacher.";
    case 404:
      return "This homework isn't there anymore. Refresh the page.";
    case 409:
      return "This homework has already been turned in. Refresh to see your submission.";
    case 413:
      return "Your pages are too large all together. Remove a page or two, or retake a photo, and try again.";
    default:
      return SUBMIT_FALLBACK_ERROR;
  }
}
