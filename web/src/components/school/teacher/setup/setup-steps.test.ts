import assert from "node:assert/strict";
import { test } from "node:test";
import type { CourseSetupStatus } from "@/lib/api";
import { setupSteps, shouldReadSetup } from "./setup-steps.ts";

const status = (over: Partial<CourseSetupStatus> = {}): CourseSetupStatus => ({
  has_section: false,
  has_student: false,
  has_materials: false,
  has_homework: false,
  has_published_grade: false,
  ...over,
});

test("a new course lists the three steps, none done", () => {
  assert.deepEqual(setupSteps(status()), [
    { key: "sections", done: false },
    { key: "codes", done: false },
    { key: "homework", done: false },
  ]);
});

test("each step is done by its own milestone", () => {
  const steps = setupSteps(status({ has_section: true, has_homework: true }));
  assert.deepEqual(steps?.map((s) => s.done), [true, false, true]);
});

test("the checklist goes away once all three are done", () => {
  assert.equal(setupSteps(status({ has_section: true, has_student: true, has_homework: true })), null);
});

test("the status is read once the tab is known, and not after setup is done", () => {
  assert.equal(shouldReadSetup(false, null), false);
  assert.equal(shouldReadSetup(true, null), true);
  assert.equal(shouldReadSetup(true, status({ has_section: true })), true);
  assert.equal(shouldReadSetup(true, status({ has_section: true, has_student: true, has_homework: true })), false);
});
