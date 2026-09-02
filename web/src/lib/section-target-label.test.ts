// Unit tests for how an empty section list is described to a teacher.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/lib/section-target-label.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionTargetLabel, sectionToneClass } from "./utils.ts";

test("named sections are listed as-is", () => {
  const r = sectionTargetLabel({
    selectedNames: ["Period 2", "Period 4"],
    status: "draft",
    courseSectionCount: 2,
  });
  assert.equal(r.label, "Period 2, Period 4");
  assert.equal(r.tone, "normal");
});

test("blank on a draft is the default, and reads as one", () => {
  // The promise the creation wizard makes: publishing fans out to every
  // section in the course.
  const r = sectionTargetLabel({
    selectedNames: [],
    status: "draft",
    courseSectionCount: 2,
  });
  assert.equal(r.label, "All sections");
  assert.equal(r.tone, "default");
  assert.equal(sectionToneClass(r.tone), "italic");
});

test("blank on a published homework is a problem, not a default", () => {
  // Only reachable by deleting every section it went to — it now
  // reaches nobody, so it must not read like the reassuring blank case.
  const r = sectionTargetLabel({
    selectedNames: [],
    status: "published",
    courseSectionCount: 0,
  });
  assert.equal(r.label, "No sections");
  assert.equal(r.tone, "problem");
  assert.notEqual(sectionToneClass(r.tone), sectionToneClass("default"));
});

test("a draft in a course with no sections does not promise all of them", () => {
  // Publishing is refused outright here, so "All sections" would be a
  // promise the publish button won't keep.
  const r = sectionTargetLabel({
    selectedNames: [],
    status: "draft",
    courseSectionCount: 0,
  });
  assert.equal(r.label, "No sections in this course");
  assert.equal(r.tone, "problem");
});

test("an unknown section count falls back to the ordinary draft copy", () => {
  // List cards don't load the course's sections. They can't tell the
  // zero case apart, and shouldn't guess it.
  for (const count of [null, undefined]) {
    const r = sectionTargetLabel({
      selectedNames: [],
      status: "draft",
      courseSectionCount: count,
    });
    assert.equal(r.label, "All sections");
    assert.equal(r.tone, "default");
  }
});

test("names win over every empty-state rule", () => {
  // A published homework that still has sections is just a list.
  const r = sectionTargetLabel({
    selectedNames: ["Period 6"],
    status: "published",
    courseSectionCount: 0,
  });
  assert.equal(r.label, "Period 6");
  assert.equal(r.tone, "normal");
});
