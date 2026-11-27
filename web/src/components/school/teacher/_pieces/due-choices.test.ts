// node --test src/components/school/teacher/_pieces/due-choices.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dueChoices, joinDue, splitDue, toLocalDueValue } from "./due-choices.ts";

test("Thursday: tomorrow is Friday, then Monday, then the next Friday", () => {
  const thu = new Date(2026, 10, 26, 22, 0); // Thu Nov 26
  assert.deepEqual(dueChoices(thu), [
    { date: "2026-11-27", label: "Tomorrow · Fri 11/27" },
    { date: "2026-11-30", label: "Mon 11/30" },
    { date: "2026-12-04", label: "Fri 12/4" },
  ]);
});

test("Sunday: tomorrow is Monday, so no second Monday chip until the next one", () => {
  const sun = new Date(2026, 10, 29, 9, 0); // Sun Nov 29
  assert.deepEqual(
    dueChoices(sun).map((c) => c.date),
    ["2026-11-30", "2026-12-04", "2026-12-07"],
  );
});

test("Month and year rollover", () => {
  const dec31 = new Date(2026, 11, 31, 12, 0); // Thu Dec 31
  assert.deepEqual(
    dueChoices(dec31).map((c) => c.date),
    ["2027-01-01", "2027-01-04", "2027-01-08"],
  );
});

test("the chips are always three distinct dates after today", () => {
  for (let d = 0; d < 14; d++) {
    const now = new Date(2026, 0, 1 + d, 8, 0);
    const dates = dueChoices(now).map((c) => c.date);
    assert.equal(new Set(dates).size, 3);
    assert.ok(dates.every((x) => x > toLocalDueValue(now).slice(0, 10)));
  }
});

test("join defaults the time to 11:59 PM; split reads it back", () => {
  assert.equal(joinDue("2026-12-04", ""), "2026-12-04T23:59");
  assert.deepEqual(splitDue("2026-12-04T23:59"), { date: "2026-12-04", time: "23:59" });
  assert.equal(splitDue(""), null);
});
