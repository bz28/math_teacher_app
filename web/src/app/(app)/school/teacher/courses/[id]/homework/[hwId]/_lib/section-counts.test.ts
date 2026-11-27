// The homework page's per-section review counts.
//   cd into this folder, then: node --experimental-strip-types section-counts.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubmissionsInboxRow } from "@/lib/api";
import { sectionCounts } from "./section-counts.ts";

const row = (o: Partial<SubmissionsInboxRow>): SubmissionsInboxRow => ({
  assignment_id: "hw",
  assignment_title: "HW",
  section_id: "p1",
  section_name: "Period 1",
  due_at: null,
  total_students: 25,
  submitted: 0,
  flagged: 0,
  to_grade: 0,
  dirty: 0,
  published: 0,
  to_publish: 0,
  ...o,
});

test("ungraded work is counted, never read as all published", () => {
  const c = sectionCounts(row({ submitted: 5 }));
  assert.deepEqual(c, { toApprove: 0, toPublish: 0, notGraded: 5, allOut: false });
});

test("to approve vs to publish split by approval; dirty grades count as waiting", () => {
  // 20 turned in: 12 graded unreleased, 6 published (1 edited since),
  // 2 not graded; 5 of the 13 waiting are already approved.
  const c = sectionCounts(row({ submitted: 20, to_grade: 12, published: 6, dirty: 1, to_publish: 5 }));
  assert.deepEqual(c, { toApprove: 8, toPublish: 5, notGraded: 2, allOut: false });
});

test("all out only when every turned-in grade is published and none edited since", () => {
  assert.equal(sectionCounts(row({ submitted: 8, published: 8 })).allOut, true);
  assert.equal(sectionCounts(row({ submitted: 8, published: 8, dirty: 1, to_publish: 1 })).allOut, false);
  assert.equal(sectionCounts(row({ submitted: 0 })).allOut, false);
});
