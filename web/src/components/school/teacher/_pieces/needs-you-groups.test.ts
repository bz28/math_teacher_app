// Unit tests for folding the "Needs you today" queue into one row per
// homework × section. Runs on plain Node (>=22.6):
//   node --experimental-strip-types --test src/components/school/teacher/_pieces/needs-you-groups.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeedsAttentionItem } from "@/lib/api";
import { groupNeedsYou, groupReviewHref, studentChip, studentCount } from "./needs-you-groups.ts";

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
    to_publish: false,
    flagged: false,
    flag_kind: null,
    cant_ai_grade: false,
    ...o,
  };
}

test("one row per homework × section, in the order its most urgent student came", () => {
  const groups = groupNeedsYou([
    item({ submission_id: "a", section_id: "p3", section_name: "Period 3", flagged: true, flag_kind: "check" }),
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
    item({ submission_id: "2", to_approve: true, flagged: true, flag_kind: "check" }),
    item({ submission_id: "3", flagged: true, flag_kind: "reading", cant_ai_grade: true }),
    item({ submission_id: "4", flagged: true, flag_kind: "check" }),
    item({ submission_id: "5" }),
    item({ submission_id: "6", to_publish: true }),
  ]);
  // A graded-and-flagged submission is in both counts, as on the review
  // page (it's in the Publish count and the Flagged chip).
  assert.equal(g.toApprove, 2);
  // Approved but unreleased — only Publish left, never "to approve".
  assert.equal(g.toPublish, 1);
  // The two kinds of flag stay apart: a photo problem is never counted
  // as an understanding check worth a look.
  assert.equal(g.worthALook, 2);
  assert.equal(g.photoProblem, 1);
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

test("students are counted once across homeworks", () => {
  assert.equal(
    studentCount([
      item({ submission_id: "1", student_id: "a" }),
      item({ submission_id: "2", student_id: "a", assignment_id: "hw2" }),
      item({ submission_id: "3", student_id: "b" }),
    ]),
    2,
  );
});

test("a student's chip agrees with the row's counts", () => {
  // The server's `reason` says "ungraded" for anything unreleased; the
  // chip reads the same flags the counts do.
  assert.equal(studentChip(item({ reason: "ungraded", to_publish: true })), "to_publish");
  assert.equal(studentChip(item({ reason: "overdue", to_approve: true })), "to_approve");
  assert.equal(
    studentChip(item({ reason: "flagged", flagged: true, flag_kind: "check", to_approve: true })),
    "worth_a_look",
  );
  assert.equal(
    studentChip(item({ reason: "flagged", flagged: true, flag_kind: "reading", cant_ai_grade: true })),
    "photo_problem",
  );
  assert.equal(studentChip(item({ reason: "dirty", to_publish: true })), "republish");
  assert.equal(studentChip(item({ reason: "ungraded", cant_ai_grade: true })), "cant_ai_grade");
  assert.equal(studentChip(item({ reason: "overdue" })), "overdue");
  assert.equal(studentChip(item({})), "ungraded");
});
