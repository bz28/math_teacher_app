// node --test src/components/school/teacher/_pieces/due-dates.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { changeNote, datesDiffer, dueDatesBody, toLocalInput } from "./due-dates.ts";

const iso = (local: string) => new Date(local).toISOString();

test("one date for every section, or cleared", () => {
  assert.deepEqual(dueDatesBody("same", "2026-12-04T23:59", {}), { due_at: iso("2026-12-04T23:59") });
  assert.deepEqual(dueDatesBody("same", "", {}), { clear_due_at: true });
  assert.equal(dueDatesBody("same", "not a date", {}), null);
});

test("per section: every date, and the homework's is the earliest", () => {
  const body = dueDatesBody("per-section", "", {
    p1: "2026-12-04T23:59",
    p3: "2026-12-02T23:59",
  });
  assert.deepEqual(body, {
    due_at: iso("2026-12-02T23:59"),
    section_due_dates: { p1: iso("2026-12-04T23:59"), p3: iso("2026-12-02T23:59") },
  });
});

test("per section: nothing to send while a section has no date", () => {
  assert.equal(dueDatesBody("per-section", "", { p1: "2026-12-04T23:59", p3: "" }), null);
  assert.equal(dueDatesBody("per-section", "", {}), null);
});

test("dates differ only when the sections' instants differ", () => {
  const s = (id: string, due_at: string | null) => ({ section_id: id, name: id, due_at });
  assert.equal(datesDiffer([s("a", "2026-12-04T04:59:00Z"), s("b", "2026-12-04T04:59:00+00:00")]), false);
  assert.equal(datesDiffer([s("a", "2026-12-04T04:59:00Z"), s("b", "2026-12-06T04:59:00Z")]), true);
  assert.equal(datesDiffer([]), false);
});

test("the change note counts what moves", () => {
  assert.equal(changeNote({ lateness_changed: 0, published_grades_changed: 0 }), "No work already turned in changes.");
  assert.equal(
    changeNote({ lateness_changed: 1, published_grades_changed: 0 }),
    "1 turned-in submission changes lateness.",
  );
  assert.equal(
    changeNote({ lateness_changed: 3, published_grades_changed: 2 }),
    "3 turned-in submissions change lateness · 2 published grades will show as changed until you republish.",
  );
});

test("an untouched section keeps its saved date exactly", () => {
  const saved = { p1: "2026-12-04T04:59:30.500Z", p3: "2026-12-04T04:59:30.500Z" };
  const body = dueDatesBody(
    "per-section",
    "",
    { p1: toLocalInput(saved.p1), p3: "2026-12-02T23:59" },
    saved,
  );
  assert.equal(body?.section_due_dates?.p1, saved.p1);
  assert.equal(body?.section_due_dates?.p3, iso("2026-12-02T23:59"));
});
