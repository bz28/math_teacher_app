import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  LOW_READ_CONFIDENCE,
  READING_TRUST_COPY,
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

test("unconfirmed AND unsure reports both — the case that started this", () => {
  // The prod misread was a 0.62 read that was never confirmed. Reporting
  // only "unconfirmed" there drops the sentence telling the teacher what
  // to look for.
  assert.equal(
    readingTrustWarning({
      ...base,
      extraction_confidence: 0.62,
      extraction_confirmed_at: null,
    }),
    "both",
  );
  const { body } = READING_TRUST_COPY.both;
  assert.ok(body.includes("fill in what a problem expects"));
  assert.ok(body.includes("against their paper"));
});

test("no copy claims when AI grading runs", () => {
  // A teacher can regrade an unconfirmed submission by hand, so the strip
  // renders over already-graded rows; any claim about grading would be
  // contradicted by the screen it sits on.
  // Matched by shape, not by phrase: the first version of this guard
  // checked literal substrings, so "grading runs only after they confirm"
  // would have sailed through the very rule it was written for.
  const claimsAboutGrading = /grad\w*[^.]{0,40}\b(runs?|ran|only|never)\b|\b(runs?|ran|never)\b[^.]{0,40}grad\w*/;
  for (const key of ["unconfirmed", "low-confidence", "both"] as const) {
    const text = `${READING_TRUST_COPY[key].title} ${READING_TRUST_COPY[key].body}`.toLowerCase();
    assert.equal(
      claimsAboutGrading.test(text),
      false,
      `${key} copy must make no claim about when AI grading runs — a teacher can regrade by hand`,
    );
  }
});

test("no copy pins the reader's doubt on a single page", () => {
  // The reader scores the whole submission once: every page goes into one
  // Vision call and the schema asks for a single `confidence` for the
  // extraction as a whole. 79% of prod submissions are multi-page, so
  // "this page" / "a hard-to-read page" misdescribes four in five and
  // sends the teacher hunting for a bad page nothing ever identified.
  // Matched by shape so a reworded singular ("the page it struggled on")
  // is caught too; the plural "pages" stays legal.
  const pinsOnOnePage = /\b(this|that|a|one|the)\s+(\w+[- ]){0,3}page\b(?!s)/;
  for (const key of ["unconfirmed", "low-confidence", "both"] as const) {
    const text = `${READING_TRUST_COPY[key].title} ${READING_TRUST_COPY[key].body}`.toLowerCase();
    assert.equal(
      pinsOnOnePage.test(text),
      false,
      `${key} copy must not attribute the reader's doubt to one page — the score covers the whole submission`,
    );
  }
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

test("the unconfirmed copy states the fact and never infers a cause", () => {
  const { title, body } = READING_TRUST_COPY.unconfirmed;
  const text = `${title} ${body}`.toLowerCase();
  // A teacher watching submissions arrive sees this during the ordinary
  // window between the read finishing and the student pressing Confirm —
  // prod median is 108s, p99 about three hours. Claiming the student left
  // is wrong for every one of those students.
  for (const claim of ["closed the app", "abandoned", "gave up", "never confirmed", "left"]) {
    assert.equal(text.includes(claim), false, `copy must not claim the student ${claim}`);
  }
  assert.ok(text.includes("hasn't confirmed"));
});
