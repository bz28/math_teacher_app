// Unit tests for the review page's ?student= / ?problem= deep links.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/lib/review-deep-link.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseProblemFocus,
  withReportedProblem,
  withSelectedStudent,
} from "./review-deep-link.ts";

const REVIEW = "https://veradicai.com/school/teacher/courses/c/homework/h/sections/s/review";

test("a problem focus needs a student and a positive whole number", () => {
  assert.deepEqual(parseProblemFocus("stu", "3"), { studentId: "stu", position: 3 });
  assert.equal(parseProblemFocus(null, "3"), null);
  assert.equal(parseProblemFocus("stu", null), null);
  assert.equal(parseProblemFocus("stu", ""), null);
  assert.equal(parseProblemFocus("stu", "0"), null);
  assert.equal(parseProblemFocus("stu", "2.5"), null);
  assert.equal(parseProblemFocus("stu", "abc"), null);
});

test("selecting a student writes ?student= and keeps other params", () => {
  const next = withSelectedStudent(`${REVIEW}?tab=x`, "stu-1", false);
  assert.ok(next);
  const url = new URL(next);
  assert.equal(url.searchParams.get("student"), "stu-1");
  assert.equal(url.searchParams.get("tab"), "x");
});

test("moving to another student drops a ?problem= that was about the last one", () => {
  const next = withSelectedStudent(`${REVIEW}?student=a&problem=3`, "b", false);
  assert.equal(next && new URL(next).searchParams.has("problem"), false);
});

test("a pending problem focus on the same student is kept", () => {
  assert.equal(withSelectedStudent(`${REVIEW}?student=a&problem=3`, "a", true), null);
});

test("an unchanged URL is a no-op, so no history write happens", () => {
  assert.equal(withSelectedStudent(`${REVIEW}?student=a`, "a", false), null);
  // Same student but a stale problem still gets cleaned up.
  assert.ok(withSelectedStudent(`${REVIEW}?student=a&problem=3`, "a", false));
});

test("a per-problem report points at the problem; others drop a stale one", () => {
  const perProblem = new URL(withReportedProblem(`${REVIEW}?student=a`, 4));
  assert.equal(perProblem.searchParams.get("student"), "a");
  assert.equal(perProblem.searchParams.get("problem"), "4");
  const whole = new URL(withReportedProblem(`${REVIEW}?student=a&problem=4`, null));
  assert.equal(whole.searchParams.has("problem"), false);
  assert.equal(whole.searchParams.get("student"), "a");
});
