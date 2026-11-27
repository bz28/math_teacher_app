import assert from "node:assert/strict";
import { test } from "node:test";
import { studentHistoryHref } from "./student-history-href.ts";

test("a student's name leads to their history in that section", () => {
  assert.equal(studentHistoryHref("c", "s", "stu"), "/school/teacher/courses/c/grades/s/students/stu");
});
