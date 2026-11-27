// node --experimental-strip-types --test src/lib/student-history.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DRAFT_LABEL, draftScoreText } from "./student-history.ts";

test("a waiting grade's score is the draft, not credited to the AI", () => {
  assert.equal(draftScoreText("awaiting_review", 84.6), "85%");
  assert.equal(draftScoreText("graded_unpublished", 80), "80%");
});

test("a partly graded score isn't shown", () => {
  assert.equal(draftScoreText("partly_graded", 50), null);
});

test("labels match the review page's markers", () => {
  assert.equal(DRAFT_LABEL.awaiting_review, "Awaiting your review");
  assert.equal(DRAFT_LABEL.graded_unpublished, "Graded, not published");
  assert.equal(DRAFT_LABEL.partly_graded, "Partly graded");
});
