import assert from "node:assert/strict";
import { test } from "node:test";
import { latePenaltyLine, oneDecimal } from "./late-penalty.ts";

test("one day late on 85% shows the half point, not a rounded one", () => {
  assert.deepEqual(latePenaltyLine(76.5, 8.5), {
    work: "85% for the work",
    late: "−8.5% for turning it in late (10% of your score per day late)",
  });
});

test("two days late on 85% takes 17", () => {
  assert.deepEqual(latePenaltyLine(68, 17), {
    work: "85% for the work",
    late: "−17% for turning it in late (10% of your score per day late)",
  });
});

test("oneDecimal drops a trailing .0 and rounds past one decimal", () => {
  assert.equal(oneDecimal(68), "68");
  assert.equal(oneDecimal(76.5), "76.5");
  assert.equal(oneDecimal(33.333), "33.3");
  assert.equal(oneDecimal(9.96), "10");
});
