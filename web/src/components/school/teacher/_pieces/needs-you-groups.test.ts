// Unit tests for folding the "Needs you today" queue into one row per
// homework × section. Runs on plain Node (>=22.6):
//   node --experimental-strip-types --test src/components/school/teacher/_pieces/needs-you-groups.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeedsAttentionItem } from "@/lib/api";
import { groupNeedsYou, groupReviewHref } from "./needs-you-groups.ts";

function item(o: Partial<NeedsAttentionItem>): NeedsAttentionItem {
  return {
    submission_id: "sub",
    student_id: "stu",
    student_name: "Ava",
    course_id: "c1",
    course_name: "Algebra I",
    subject: "math",
    assignment_id: "hw1",
    assignment_title: "HW 1",
    section_id: "p1",
    section_name: "Period 1",
    due_at: null,
    reason: "ungraded",
    to_approve: false,
    flagged: false,
    cant_ai_grade: false,
    ...o,
  };
}

test("one row per homework × section, in the order its most urgent student came", () => {
  const groups = groupNeedsYou([
    item({ submission_id: "a", section_id: "p3", section_name: "Period 3", flagged: true }),
    item({ submission_id: "b", section_id: "p1" }),
    item({ submission_id: "c", section_id: "p3", section_name: "Period 3" }),
    item({ submission_id: "d", assignment_id: "hw2", section_id: "p1" }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((i) => i.submission_id)]),
    [
      ["hw1:p3", ["a", "c"]],
      ["hw1:p1", ["b"]],
      ["hw2:p1", ["d"]],
    ],
  );
});

test("counts mirror the review page; the remainder is ungraded", () => {
  const [g] = groupNeedsYou([
    item({ submission_id: "1", to_approve: true }),
    item({ submission_id: "2", to_approve: true, flagged: true }),
    item({ submission_id: "3", flagged: true, cant_ai_grade: true }),
    item({ submission_id: "4", flagged: true }),
    item({ submission_id: "5" }),
  ]);
  // A graded-and-flagged submission is in both counts, as on the review
  // page (it's in the Publish count and the Flagged chip).
  assert.equal(g.toApprove, 2);
  assert.equal(g.flagged, 3);
  assert.equal(g.cantAiGrade, 1);
  assert.equal(g.ungraded, 1);
});

test("Review opens on the group's first (most urgent) student", () => {
  const [g] = groupNeedsYou([
    item({ submission_id: "1", student_id: "first" }),
    item({ submission_id: "2", student_id: "second" }),
  ]);
  assert.equal(
    groupReviewHref(g),
    "/school/teacher/courses/c1/homework/hw1/sections/p1/review?student=first",
  );
});

test("empty queue → no rows", () => {
  assert.deepEqual(groupNeedsYou([]), []);
});
