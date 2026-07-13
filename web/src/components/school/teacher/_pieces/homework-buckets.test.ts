// Unit tests for homework timeline bucketing.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/components/school/teacher/_pieces/homework-buckets.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeacherAssignment } from "@/lib/api";
import { bucketHomeworks } from "./homework-buckets.ts";

const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();
const DAY = 86_400_000;
// ISO string for `offsetMs` away from NOW (positive = future, negative = past).
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

/** Minimal TeacherAssignment builder — only bucketing-relevant fields
 *  carry meaning; the rest are inert defaults. */
function hw(overrides: Partial<TeacherAssignment>): TeacherAssignment {
  return {
    id: "hw",
    course_id: "c",
    unit_ids: [],
    title: "HW",
    description: null,
    type: "homework",
    source_type: null,
    status: "published",
    due_at: null,
    late_policy: "none",
    source_homework_id: null,
    section_ids: [],
    section_names: [],
    problem_count: 5,
    total_students: 10,
    submitted: 0,
    graded: 0,
    to_review: 0,
    published: 0,
    pending_review: 0,
    avg_score: null,
    created_at: at(-30 * DAY),
    ...overrides,
  };
}

/** Which bucket a single HW landed in. */
function bucketOf(over: Partial<TeacherAssignment>): keyof ReturnType<typeof bucketHomeworks> {
  const b = bucketHomeworks([hw({ id: "target", ...over })], NOW);
  for (const key of ["needsGrading", "dueThisWeek", "upcoming", "completed"] as const) {
    if (b[key].some((h) => h.id === "target")) return key;
  }
  throw new Error("HW did not land in any bucket");
}

test("past due, whole class submitted, all published → completed", () => {
  assert.equal(
    bucketOf({ due_at: at(-1 * DAY), total_students: 10, submitted: 10, published: 10 }),
    "completed",
  );
});

test("past due, all graded but NONE published → needsGrading (the fix)", () => {
  // AI grading set final_score on every submit (graded === submitted), but
  // the teacher never hit "Publish grades". Old logic mislabeled this
  // Completed; it must surface for review instead.
  assert.equal(
    bucketOf({
      due_at: at(-1 * DAY),
      total_students: 10,
      submitted: 10,
      graded: 10,
      published: 0,
    }),
    "needsGrading",
  );
});

test("past due, fully submitted, only some published → needsGrading", () => {
  assert.equal(
    bucketOf({ due_at: at(-1 * DAY), total_students: 10, submitted: 10, published: 6 }),
    "needsGrading",
  );
});

test("past due with missing submissions, all present grades published → needsGrading", () => {
  // Everyone who submitted is published, but the class isn't fully in.
  assert.equal(
    bucketOf({ due_at: at(-1 * DAY), total_students: 10, submitted: 7, published: 7 }),
    "needsGrading",
  );
});

test("past due with zero submissions → needsGrading (overdue, missing work)", () => {
  assert.equal(
    bucketOf({ due_at: at(-1 * DAY), total_students: 10, submitted: 0, published: 0 }),
    "needsGrading",
  );
});

test("active HW due within 7 days is NOT nagged for grading → dueThisWeek", () => {
  // Students still working; unpublished grades must not push it to needsGrading.
  assert.equal(
    bucketOf({ due_at: at(3 * DAY), total_students: 10, submitted: 4, published: 0 }),
    "dueThisWeek",
  );
});

test("active HW due beyond 7 days → upcoming", () => {
  assert.equal(
    bucketOf({ due_at: at(20 * DAY), total_students: 10, submitted: 2, published: 0 }),
    "upcoming",
  );
});

test("published HW with no due date → upcoming", () => {
  assert.equal(bucketOf({ due_at: null, submitted: 3, published: 0 }), "upcoming");
});

test("draft (non-published status) → upcoming regardless of due", () => {
  assert.equal(
    bucketOf({ status: "draft", due_at: at(-1 * DAY), submitted: 10, published: 10 }),
    "upcoming",
  );
});

test("every published HW lands in exactly one bucket", () => {
  const items = [
    hw({ id: "a", due_at: at(-2 * DAY), total_students: 5, submitted: 5, published: 5 }),
    hw({ id: "b", due_at: at(-2 * DAY), total_students: 5, submitted: 5, published: 0 }),
    hw({ id: "c", due_at: at(2 * DAY), submitted: 1 }),
    hw({ id: "d", due_at: at(30 * DAY) }),
    hw({ id: "e", status: "draft" }),
  ];
  const b = bucketHomeworks(items, NOW);
  const total =
    b.needsGrading.length + b.dueThisWeek.length + b.upcoming.length + b.completed.length;
  assert.equal(total, items.length);
});
