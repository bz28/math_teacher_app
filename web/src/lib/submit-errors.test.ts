// Unit tests for the two defects that left a student unable to turn in
// homework for three days.
//
//   node --experimental-strip-types --test src/lib/submit-errors.test.ts
//
// 1. The client decided a file's format from `File.type` — which the
//    browser reads off the FILENAME. A file renamed `.png` passed, the
//    server read the actual bytes, and the submit 400'd.
//
// 2. `friendlySubmitError` mapped only 409 and 413. Everything else,
//    including that 400, became "Something went wrong… Please try
//    again" — no information, and an instruction to repeat the failure.
//
// The assertions below are about the STUDENT-VISIBLE outcome, not the
// wording: that a bad file is caught before upload, and that no
// reachable status silently collapses into the fallback.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SUBMIT_FALLBACK_ERROR,
  UNREADABLE_FILE_ERROR,
  sniffUploadType,
  submitErrorMessage,
} from "./submit-errors.ts";

const bytes = (...b: number[]) => Uint8Array.from(b);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
// "RIFF....WEBP" — what Chrome hands you from "save image as" on most
// sites, and the likeliest thing behind a 7 KB file named .png.
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0);
// ftypheic at offset 4 — an iPhone photo moved over untouched.
const HEIC = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
// A saved error page. 7 KB of HTML is a very ordinary size, and it is
// what a failed download leaves behind under the name you asked for.
const HTML = bytes(0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45);

test("accepts exactly the three formats the server accepts", () => {
  assert.equal(sniffUploadType(PNG), "image/png");
  assert.equal(sniffUploadType(JPEG), "image/jpeg");
  assert.equal(sniffUploadType(PDF), "application/pdf");
});

test("rejects what the server would reject, whatever it is named", () => {
  // Each of these renamed to .png reports `image/png` from the browser,
  // passed the old check, and 400'd at the server.
  assert.equal(sniffUploadType(WEBP), null);
  assert.equal(sniffUploadType(GIF), null);
  assert.equal(sniffUploadType(HEIC), null);
  assert.equal(sniffUploadType(HTML), null);
});

test("a truncated header is refused rather than half-matched", () => {
  assert.equal(sniffUploadType(bytes()), null);
  assert.equal(sniffUploadType(bytes(0x89)), null);
  // The first seven bytes of a PNG signature, then nothing.
  assert.equal(sniffUploadType(PNG.subarray(0, 7)), null);
  // %PDF without the trailing dash is not what the server matches.
  assert.equal(sniffUploadType(bytes(0x25, 0x50, 0x44, 0x46)), null);
});

test("two bytes is enough for a JPEG, because that is all the server reads", () => {
  assert.equal(sniffUploadType(bytes(0xff, 0xd8)), "image/jpeg");
});

test("the 400 a student actually hit no longer reads as a shrug", () => {
  // The regression under test. This returned SUBMIT_FALLBACK_ERROR for
  // three days while a student retried the same file.
  assert.equal(submitErrorMessage(400), UNREADABLE_FILE_ERROR);
  assert.notEqual(submitErrorMessage(400), SUBMIT_FALLBACK_ERROR);
});

test("every status the submit endpoint can return says something useful", () => {
  // Enumerated from submit_homework and _load_assignment_for_student,
  // plus auth and the size middleware. If someone adds a new raise to
  // that handler, add it here too — the point of this test is that the
  // list stays in step with the server.
  for (const status of [400, 401, 403, 404, 409, 413]) {
    assert.notEqual(
      submitErrorMessage(status),
      SUBMIT_FALLBACK_ERROR,
      `status ${status} still collapses to the fallback`,
    );
  }
});

test("a message never tells a student to retry something that cannot succeed", () => {
  // "Please try again" is only honest when trying again might work.
  // A wrong file, a lapsed session, a withdrawn homework and a
  // duplicate submission all need a DIFFERENT action first.
  for (const status of [400, 401, 403, 404, 409]) {
    assert.ok(
      !/try again/i.test(submitErrorMessage(status)),
      `status ${status} tells the student to repeat a doomed action`,
    );
  }
});

test("an unexpected status still gets a friendly line, not a blank", () => {
  assert.equal(submitErrorMessage(500), SUBMIT_FALLBACK_ERROR);
  assert.equal(submitErrorMessage(418), SUBMIT_FALLBACK_ERROR);
});
