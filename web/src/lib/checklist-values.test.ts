// Unit tests for finding checklist values in item text. Plain Node (>=22.6):
//   node --experimental-strip-types --test src/lib/checklist-values.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitValues } from "./checklist-values.ts";

const marked = (text: string, values: string[]) =>
  splitValues(text, values)
    .filter((p) => p.values)
    .map((p) => p.text);

describe("splitValues", () => {
  it("underlines the values the server flagged, read the same way", () => {
    assert.deepEqual(marked("Asymptotes at x = -12° and x = 24°", ["-12", "24"]), ["-12", "24"]);
    // A sign flip is a different value.
    assert.deepEqual(marked("At x = 3 and x = -3", ["-3"]), ["-3"]);
    assert.deepEqual(marked("Crosses at (0, −½)", ["-1", "2"]), ["−½"]);
    assert.deepEqual(marked("Through (0.5, 1,000)", ["0.5", "1000"]), ["0.5", "1,000"]);
    assert.deepEqual(marked("Through .5", ["0.5"]), [".5"]);
  });

  it("skips exponents and keeps the text whole", () => {
    assert.deepEqual(marked("y = x^2 crosses at 2", ["2"]), ["2"]);
    const text = "Line through (2, 4) and (6, 8)";
    assert.equal(splitValues(text, ["4", "8"]).map((p) => p.text).join(""), text);
  });
});
