import assert from "node:assert/strict";
import { test } from "node:test";
import { courseTabHref } from "./course-tab-href.ts";

test("a practice set's course link opens the Practice tab", () => {
  assert.equal(courseTabHref("c", "practice"), "/school/teacher/courses/c?tab=practice");
});

test("homework, or a type not loaded yet, opens the Homework tab", () => {
  assert.equal(courseTabHref("c", "homework"), "/school/teacher/courses/c?tab=homework");
  assert.equal(courseTabHref("c", null), "/school/teacher/courses/c?tab=homework");
});
