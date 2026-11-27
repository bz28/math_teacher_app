import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionNames } from "./section-names.ts";

test("one name is one section", () => {
  assert.deepEqual(sectionNames("  Period 1 "), ["Period 1"]);
});

test("commas or new lines make several, in the order typed", () => {
  assert.deepEqual(sectionNames("Period 1, Period 3\nBlock A"), ["Period 1", "Period 3", "Block A"]);
});

test("blanks and repeats are dropped", () => {
  assert.deepEqual(sectionNames("Period 1,, period 1 ,  ,Period  2"), ["Period 1", "Period 2"]);
  assert.deepEqual(sectionNames(" , "), []);
});
