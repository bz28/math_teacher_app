import assert from "node:assert/strict";
import { test } from "node:test";

import {
  READING_TRUST_COPY,
  needsReadingCheck,
  type ReadingTrustInput,
} from "./reading-trust";

const base: ReadingTrustInput = {
  extraction_confidence: 0.88,
  extraction_confirmed_at: "2026-09-20T10:00:00Z",
  extraction_flagged_at: null,
};

test("a reading the student confirmed needs no check", () => {
  assert.equal(needsReadingCheck(base), false);
});

test("never confirmed => nobody vouched for this transcript", () => {
  assert.equal(
    needsReadingCheck({ ...base, extraction_confirmed_at: null }),
    true,
  );
});

test("the student's own 'the reader got it wrong' owns that case", () => {
  // It has a louder red callout that also states AI grading was skipped.
  // Two callouts stacked would bury the more serious one.
  assert.equal(
    needsReadingCheck({
      ...base,
      extraction_confirmed_at: null,
      extraction_flagged_at: "2026-09-20T10:05:00Z",
    }),
    false,
  );
});

test("no reading at all never blames the student", () => {
  // Both AI toggles off => extraction never runs => nothing to vouch for.
  // Without this the strip would fire on every submission of such an
  // assignment and read as "the student skipped a step they were never shown".
  assert.equal(
    needsReadingCheck({
      ...base,
      extraction_confidence: null,
      extraction_confirmed_at: null,
    }),
    false,
  );
});

test("the reader's own confidence never changes the answer", () => {
  // The score does not separate: across 82 graded problems 0.72 carried the
  // same 16% flattering rate as 0.62, and in probe runs the reader invented
  // an answer at 0.72 while reading a page correctly at 0.45. Gating on it
  // would miss real cases and fire on clean ones. This asserts the whole
  // ladder the model actually emits.
  for (const c of [0.42, 0.52, 0.62, 0.72, 0.78, 0.82, 0.88, 0.92, 0.97]) {
    assert.equal(
      needsReadingCheck({ ...base, extraction_confidence: c }),
      false,
      `confirmed reading at confidence ${c} must not warn`,
    );
    assert.equal(
      needsReadingCheck({
        ...base,
        extraction_confidence: c,
        extraction_confirmed_at: null,
      }),
      true,
      `unconfirmed reading at confidence ${c} must warn`,
    );
  }
});

test("the copy states the fact and never infers a cause", () => {
  // A student who didn't tap may have closed the app, lost signal, or never
  // seen the screen. The strip reports what did not happen, not why.
  const text = `${READING_TRUST_COPY.title} ${READING_TRUST_COPY.body}`.toLowerCase();
  const blamesTheStudent =
    /\b(ignored|skipped|refused|didn't bother|couldn't be bothered|dodged)\b/;
  assert.equal(blamesTheStudent.test(text), false);
});

test("no copy claims when AI grading runs", () => {
  // A teacher can regrade an unconfirmed submission by hand, so the strip
  // renders over already-graded rows; any claim about grading would be
  // contradicted by the screen it sits on.
  // Matched by shape, not by phrase: the first version of this guard
  // checked literal substrings, so "grading runs only after they confirm"
  // would have sailed through the very rule it was written for.
  const claimsAboutGrading =
    /grad\w*[^.]{0,40}\b(runs?|ran|only|never)\b|\b(runs?|ran|never)\b[^.]{0,40}grad\w*/;
  const text = `${READING_TRUST_COPY.title} ${READING_TRUST_COPY.body}`.toLowerCase();
  assert.equal(claimsAboutGrading.test(text), false);
});

test("no copy claims the reader was unsure", () => {
  // The strip no longer reads the confidence score, so copy that mentions
  // the reader's certainty would describe a signal it does not consult.
  const claimsCertainty =
    /\b(unsure|uncertain|confiden\w*|not sure|wasn't sure|struggled)\b/;
  const text = `${READING_TRUST_COPY.title} ${READING_TRUST_COPY.body}`.toLowerCase();
  assert.equal(claimsCertainty.test(text), false);
});

test("no copy pins anything on a single page", () => {
  // Every page goes into one Vision call, so there is no per-page signal;
  // 79% of prod submissions are multi-page. The plural stays legal.
  const pinsOnOnePage = /\b(this|that|a|one|the)\s+(\w+[- ]){0,3}page\b(?!s)/;
  const text = `${READING_TRUST_COPY.title} ${READING_TRUST_COPY.body}`.toLowerCase();
  assert.equal(pinsOnOnePage.test(text), false);
});
