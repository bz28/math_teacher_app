// Runs on plain Node via native TS type-stripping (see package.json "test").
//
// Pins the loose-file routing in MaterialsTab.handleImport. Regression:
// in a brand-new course the Materials empty state's only button, "Upload
// files", sent loose files to the selected unit — and a new course has
// none, so every first upload failed. A follow-up: dropping a folder and
// loose files together into an empty course must reuse the folder's unit,
// not mint an extra "Unit 1".
import { test } from "node:test";
import assert from "node:assert/strict";
import { looseFilesTarget } from "./walk-dropped-folder.ts";

test("selected unit wins", () => {
  assert.deepEqual(looseFilesTarget("u-sel", "u-imp", true), { kind: "unit", id: "u-sel" });
});

test("empty course, first upload: create a unit instead of failing", () => {
  assert.deepEqual(looseFilesTarget(null, null, false), { kind: "create" });
});

test("empty course, folder + loose files: reuse the folder's unit", () => {
  assert.deepEqual(looseFilesTarget(null, "u-imp", false), { kind: "unit", id: "u-imp" });
});

test("units exist but none selected: ask the teacher to pick", () => {
  assert.deepEqual(looseFilesTarget(null, null, true), { kind: "none" });
});
