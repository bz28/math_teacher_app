// Unit tests for the gradebook's arithmetic. Plain Node (>=22.6):
//   node --experimental-strip-types --test src/lib/gradebook.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GradebookAssignment, GradebookCell, GradebookStudent } from "./api.ts";
import {
  averageBreakdown,
  changedFromAi,
  sectionAverage,
  shown,
  sortRows,
} from "./gradebook.ts";

const A: GradebookAssignment[] = ["h1", "h2", "h3", "h4"].map((id) => ({
  id, title: id, due_at: null, avg_percent: null, counted_count: 0,
}));

function published(score: number, ai: number | null = score): GradebookCell {
  return {
    state: "published", submission_id: "x", score, published_at: "2026-09-01T00:00:00Z",
    is_late: false, ai_score: ai, edited_since_publish: false,
  };
}

function student(name: string, avg: number | null, cells: Record<string, GradebookCell>): GradebookStudent {
  return {
    student_id: name, name, avg_percent: avg, counted_count: 0, assigned_count: 4,
    missing_count: 0, cells,
  };
}

test("the average's breakdown lists exactly its published scores and what it leaves out", () => {
  const s = student("Leo Chen", 67.3, {
    h1: published(73),
    h2: { state: "missing" },
    h3: published(58),
    h4: { state: "not_published", submission_id: "y", is_late: false },
  });
  const { scores, leftOut } = averageBreakdown(s, A);
  assert.deepEqual(scores, [73, 58]);
  assert.deepEqual(leftOut, { missing: 1, not_published: 1 });
});

test("the section average covers the whole section and skips students with nothing published", () => {
  const all = [student("A", 80, {}), student("B", 60, {}), student("C", null, {})];
  assert.equal(sectionAverage(all), 70);
  assert.equal(sectionAverage([student("C", null, {})]), null);
});

test("tone and filters judge the number shown, not the float behind it", () => {
  assert.equal(shown(69.96), 70); // shows 70% → not "below 70"
  assert.equal(shown(84.5), 85); // shows 85% → strong
  assert.equal(shown(84.4), 84);
});

test("a grade approved as the AI suggested isn't marked as changed", () => {
  const same = published(76.25, 76.25) as Extract<GradebookCell, { state: "published" }>;
  const changed = published(80, 70) as Extract<GradebookCell, { state: "published" }>;
  const byHand = published(80, null) as Extract<GradebookCell, { state: "published" }>;
  assert.equal(changedFromAi(same), false);
  assert.equal(changedFromAi(changed), true);
  assert.equal(changedFromAi(byHand), false);
});

test("sorting by a homework puts students without a score last, both directions", () => {
  const rows = [
    student("Ava Brooks", 90, { h1: published(90) }),
    student("Ben Chen", 70, { h1: { state: "missing" } }),
    student("Cal Diaz", 60, { h1: published(60) }),
  ];
  const asc = sortRows(rows, { key: "h1", dir: "asc" }).map((r) => r.name);
  const desc = sortRows(rows, { key: "h1", dir: "desc" }).map((r) => r.name);
  assert.deepEqual(asc, ["Cal Diaz", "Ava Brooks", "Ben Chen"]);
  assert.deepEqual(desc, ["Ava Brooks", "Cal Diaz", "Ben Chen"]);
  assert.deepEqual(sortRows(rows, { key: "name", dir: "asc" }).map((r) => r.name), [
    "Ava Brooks", "Ben Chen", "Cal Diaz",
  ]);
});
