import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  LOW_READ_CONFIDENCE,
  readingTrustWarning,
  type ReadingTrustInput,
} from "./reading-trust.ts";

const base: ReadingTrustInput = {
  extraction_confidence: 0.9,
  extraction_confirmed_at: "2026-09-22T18:30:00Z",
  extraction_flagged_at: null,
};

test("a confirmed, confident reading warns about nothing", () => {
  assert.equal(readingTrustWarning(base), null);
});

test("never confirmed => nobody vouched for this transcript", () => {
  assert.equal(
    readingTrustWarning({ ...base, extraction_confirmed_at: null }),
    "unconfirmed",
  );
});

test("confirmed but the reader was unsure => compare with the photo", () => {
  assert.equal(
    readingTrustWarning({ ...base, extraction_confidence: 0.62 }),
    "low-confidence",
  );
});

test("the threshold is exclusive at the boundary", () => {
  assert.equal(
    readingTrustWarning({ ...base, extraction_confidence: LOW_READ_CONFIDENCE }),
    null,
  );
  assert.equal(
    readingTrustWarning({ ...base, extraction_confidence: LOW_READ_CONFIDENCE - 0.01 }),
    "low-confidence",
  );
});

test("no reading at all never blames the student", () => {
  // AI grading + understanding check both off => extraction never runs,
  // so extraction_confirmed_at is null forever. Warning here would tell
  // the teacher the student closed the app, on every single submission.
  assert.equal(
    readingTrustWarning({
      extraction_confidence: null,
      extraction_confirmed_at: null,
      extraction_flagged_at: null,
    }),
    null,
  );
});

test("the student's own 'the reader got it wrong' owns that case", () => {
  assert.equal(
    readingTrustWarning({
      extraction_confidence: 0.2,
      extraction_confirmed_at: null,
      extraction_flagged_at: "2026-09-22T18:35:00Z",
    }),
    null,
  );
});
