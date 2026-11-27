import assert from "node:assert/strict";
import { test } from "node:test";
import { pastedLines, sectionNames } from "./section-names.ts";

test("one name is one section", () => {
  assert.deepEqual(sectionNames("  Period 1 "), ["Period 1"]);
});

test("commas make several, in the order typed", () => {
  assert.deepEqual(sectionNames("Period 1, Period 3,Block A"), ["Period 1", "Period 3", "Block A"]);
});

test("blanks and repeats are dropped", () => {
  assert.deepEqual(sectionNames("Period 1,, period 1 ,  ,Period  2"), ["Period 1", "Period 2"]);
  assert.deepEqual(sectionNames(" , "), []);
});

test("a pasted column becomes comma-separated names", () => {
  assert.equal(pastedLines("Period 1\r\nPeriod 3\n\nBlock A\n"), "Period 1, Period 3, Block A");
  assert.deepEqual(sectionNames(pastedLines("Period 1\nPeriod 3")), ["Period 1", "Period 3"]);
});
