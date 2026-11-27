import assert from "node:assert/strict";
import { test } from "node:test";
import { READ_EVERY_MS, courseIdFromPath, shouldReadCourses } from "./teacher-courses-read.ts";

test("the first page reads the courses", () => {
  assert.equal(shouldReadCourses(null, null, 0), true);
});

test("moving to another course, or home, reads them at once", () => {
  assert.equal(shouldReadCourses({ at: 0, scope: "a" }, "b", 1), true);
  assert.equal(shouldReadCourses({ at: 0, scope: "a" }, null, 1), true);
});

test("pages inside the same course reuse a fresh read", () => {
  assert.equal(shouldReadCourses({ at: 0, scope: "a" }, "a", READ_EVERY_MS - 1), false);
  assert.equal(shouldReadCourses({ at: 0, scope: "a" }, "a", READ_EVERY_MS), true);
});

test("the course a URL is in", () => {
  assert.equal(courseIdFromPath("/school/teacher/courses/abc/homework/x"), "abc");
  assert.equal(courseIdFromPath("/school/teacher"), null);
  assert.equal(courseIdFromPath(null), null);
});
