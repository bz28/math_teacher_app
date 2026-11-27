import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftHomework } from "@/lib/api";
import { draftDetail } from "./draft-detail.ts";

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
  assert.equal(
    draftDetail(draft({ pending_review: 5, problem_count: 3 }), "Dec 1"),
    "Algebra I · due Dec 1 · 5 problems need your approval",
  );
  assert.equal(draftDetail(draft({ pending_review: 1 }), null), "Algebra I · 1 problem needs your approval");
});

test("otherwise it counts the problems, or says there are none", () => {
  assert.equal(draftDetail(draft({ problem_count: 1 }), null), "Algebra I · 1 problem");
  assert.equal(draftDetail(draft(), "Dec 1"), "Algebra I · due Dec 1 · no problems yet");
});
