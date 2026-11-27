import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftHomework } from "@/lib/api";
import { draftDue, draftLeft } from "./draft-detail.ts";

const draft = (over: Partial<DraftHomework> = {}): DraftHomework => ({
  assignment_id: "a",
  title: "T",
  course_id: "c",
  course_name: "Algebra I",
  due_at: null,
  problem_count: 0,
  pending_review: 0,
  ...over,
});

test("problems waiting on approval lead what's left", () => {
  assert.equal(draftLeft(draft({ pending_review: 5, problem_count: 3 })), "5 problems need your approval");
  assert.equal(draftLeft(draft({ pending_review: 1 })), "1 problem needs your approval");
});

test("otherwise it counts the problems, or says there are none", () => {
  assert.equal(draftLeft(draft({ problem_count: 1 })), "1 problem");
  assert.equal(draftLeft(draft()), "no problems yet");
});

test("a due date already behind an unpublished draft says it passed", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  assert.equal(draftDue(null, now, String), null);
  const ahead = draftDue("2026-12-01T12:00:00Z", now, () => "Dec 1");
  assert.equal(ahead?.passed, false);
  assert.equal(ahead?.text, "due Dec 1");
  const behind = draftDue("2026-11-20T12:00:00Z", now, () => "Nov 20");
  assert.equal(behind?.passed, true);
  assert.equal(behind?.text, "due date passed (Nov 20)");
});
