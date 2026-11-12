import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultReopenDue, reopenDateProblem, reopenMinimum, toLocalInputValue } from "./reopen.ts";

const NOW = new Date(2026, 10, 11, 15, 30); // Nov 11, 3:30 PM local

test("the picker value is local wall time, minutes only", () => {
  assert.equal(toLocalInputValue(new Date(2026, 0, 5, 9, 7, 42)), "2026-01-05T09:07");
});

test("the earliest date is now, or the class due date when that's later", () => {
  const past = new Date(2026, 10, 1);
  const future = new Date(2026, 10, 20);
  assert.equal(reopenMinimum(NOW, null), NOW);
  assert.equal(reopenMinimum(NOW, past), NOW);
  assert.equal(reopenMinimum(NOW, future), future);
});

test("the default is two days past the earliest date, at 11:59 PM", () => {
  assert.equal(toLocalInputValue(defaultReopenDue(NOW, null)), "2026-11-13T23:59");
  assert.equal(toLocalInputValue(defaultReopenDue(NOW, new Date(2026, 10, 1))), "2026-11-13T23:59");
  assert.equal(toLocalInputValue(defaultReopenDue(NOW, new Date(2026, 10, 20, 8))), "2026-11-22T23:59");
});

test("the default always passes the same checks as the API", () => {
  for (const classDue of [null, new Date(2026, 10, 1), new Date(2026, 10, 20, 8)]) {
    const value = toLocalInputValue(defaultReopenDue(NOW, classDue));
    assert.equal(reopenDateProblem(value, NOW, classDue), null);
  }
});

test("a past time, or one before the class date, is refused with why", () => {
  assert.equal(reopenDateProblem("", NOW, null), "Pick a date and time.");
  assert.equal(reopenDateProblem("2026-11-11T15:00", NOW, null), "Pick a time in the future.");
  assert.equal(
    reopenDateProblem("2026-11-15T10:00", NOW, new Date(2026, 10, 20)),
    "Pick a date on or after the class due date.",
  );
  assert.equal(reopenDateProblem("2026-11-20T00:00", NOW, new Date(2026, 10, 20)), null);
});
