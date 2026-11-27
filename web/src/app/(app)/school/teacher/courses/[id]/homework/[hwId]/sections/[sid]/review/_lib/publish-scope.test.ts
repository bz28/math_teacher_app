// Unit tests for which grades a Publish marks released on screen.
//   node --experimental-strip-types <this file>   (or pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";
import { releases } from "./publish-scope.ts";

const g = (over: Partial<Parameters<typeof releases>[0]> = {}) => ({
  final_score: 90,
  reviewed_at: "2026-11-26T10:00:00Z",
  grade_published_at: null,
  grade_dirty: false,
  ...over,
});

test("an approved, never-published grade goes out", () => {
  assert.equal(releases(g(), "s1", { kind: "section" }), true);
  assert.equal(releases(g(), "s1", { kind: "all" }), true);
});

test("an unapproved grade never goes out, in any scope", () => {
  const unapproved = g({ reviewed_at: null });
  assert.equal(releases(unapproved, "s1", { kind: "section" }), false);
  assert.equal(releases(unapproved, "s1", { kind: "all" }), false);
  assert.equal(releases(unapproved, "s1", { kind: "student", submissionId: "s1" }), false);
});

test("an ungraded submission never goes out", () => {
  assert.equal(releases(g({ final_score: null }), "s1", { kind: "all" }), false);
});

test("a published grade goes out again only once edited", () => {
  const published = g({ grade_published_at: "2026-11-26T11:00:00Z" });
  assert.equal(releases(published, "s1", { kind: "all" }), false);
  assert.equal(releases({ ...published, grade_dirty: true }, "s1", { kind: "all" }), true);
});

test("publishing one student leaves the others alone", () => {
  const one = { kind: "student", submissionId: "s1" } as const;
  assert.equal(releases(g(), "s1", one), true);
  assert.equal(releases(g(), "s2", one), false);
});
