import assert from "node:assert/strict";
import { test } from "node:test";
import { landingTab } from "./landing-tab.ts";

test("a course with homework opens on Homework", () => {
  assert.equal(landingTab({ has_homework: true }), "homework");
});

test("a course without homework opens on Sections", () => {
  assert.equal(landingTab({ has_homework: false }), "sections");
});
