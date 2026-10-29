// Unit tests for homework points. Plain Node (>=22.6):
//   node --experimental-strip-types --test src/lib/points.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deductionPoints, earnedPoints, evenSplit, formatPoints, pointsRange } from "./points.ts";

describe("evenSplit", () => {
  it("matches the server: remainder to the first problems, never zero", () => {
    assert.deepEqual(evenSplit(100, 7), [15, 15, 14, 14, 14, 14, 14]);
    assert.deepEqual(evenSplit(3, 5), [1, 1, 1, 1, 1]);
    assert.deepEqual(evenSplit(100, 0), []);
  });
});

describe("deductionPoints", () => {
  it("keeps exact points exact", () => {
    // A 1-point class rule on a 14-point problem is 7.142…%.
    assert.deepEqual(deductionPoints([100 / 14, 50 / 14], 14, 1.5), [1, 0.5]);
  });

  it("adds up to the points the score shows lost, where rounding each line would not", () => {
    // 85% of 7 points shows as 6 earned, 1 lost. Three 5% lines are 0.35
    // each: rounded one by one, 0.4 × 3 = 1.2 — more than was lost.
    const lost = 7 - earnedPoints(85, 7);
    assert.equal(lost, 1);
    assert.deepEqual(deductionPoints([5, 5, 5], 7, lost), [0.4, 0.3, 0.3]);
  });

  it("adds up even when an older ledger took off more than the score shows", () => {
    // 70% on 10 points, but the lines say 21% and 10%.
    const lines = deductionPoints([21, 10], 10, 3);
    assert.equal(Math.round(lines.reduce((s, x) => s + x, 0) * 10), 30);
    assert.deepEqual(lines, [2, 1]);
  });

  it("adds up when an older ledger took off less than the score shows", () => {
    const lines = deductionPoints([10, 5], 10, 2);
    assert.equal(Math.round(lines.reduce((s, x) => s + x, 0) * 10), 20);
    assert.deepEqual(lines, [1.3, 0.7]);
  });

  it("never gives points to a line that took nothing off", () => {
    assert.deepEqual(deductionPoints([0, 10], 10, 1), [0, 1]);
  });
});

describe("formatting", () => {
  it("writes points as a teacher would", () => {
    assert.equal(formatPoints(14), "14");
    assert.equal(formatPoints(11.5), "11.5");
    assert.equal(formatPoints(0.30000000000000004), "0.3");
    assert.equal(earnedPoints(84, 100), 84);
    assert.equal(earnedPoints(82.14, 14), 11.5);
    assert.equal(pointsRange([15, 15, 14]), "14–15 each");
    assert.equal(pointsRange([10, 10]), "10 each");
  });
});
