// Table-driven tests for the integrity chat's typed-reply rules. The SAME
// table lives in tests/test_integrity_non_answer.py and
// mobile/src/utils/integrityMinimum.test.ts — change all three together.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/components/school/student/integrity-message-rules.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isNonAnswer,
  meetsTypedMinimum,
  normalizeReply,
} from "./integrity-message-rules.ts";

const NON_ANSWERS = [
  "I don't know",
  "I don’t know",
  "i dont know",
  "I do not know.",
  "IDK!!",
  "idk idk idk",
  "dunno",
  "I dunno lol",
  "no idea",
  "I have no idea",
  "honestly I have no idea",
  "not sure lol",
  "not really sure",
  "I'm not sure",
  "Im not sure",
  "no clue",
  "I'm stuck",
  "i forgot",
  "I give up",
  "skip",
  "?",
  "???",
  "nothing",
  "um idk 🤷",
  "I don't know how to explain this",
  "I’m not sure — idk",
];

const ANSWERS = [
  "y=2x+3",
  "x=-3/2",
  "(3, 4)",
  "x=2, y=3",
  "12.5 cm",
  "x = 4",
  "factorization",
  "I subtracted 3",
  "I divided both sides by two",
  "I don't know if this is right but x = 4",
  "I'm not sure but I think I factored it",
  "I forgot to carry the 2",
  "nope",
  "I did",
  "that's it",
  "slope intercept form",
];

for (const text of NON_ANSWERS) {
  test(`non-answer: ${text}`, () => assert.equal(isNonAnswer(text), true));
}
for (const text of ANSWERS) {
  test(`answer: ${text}`, () => assert.equal(isNonAnswer(text), false));
}

test("normalize matches smart punctuation and case", () => {
  assert.equal(
    normalizeReply("I’M STUCK – I’m not sure how to explain this"),
    normalizeReply("I'm stuck — I'm not sure how to explain this."),
  );
});

test("meetsTypedMinimum: 5-char floor for everyone, non-answers only after the tap", () => {
  assert.equal(meetsTypedMinimum("idk", false), false);
  assert.equal(meetsTypedMinimum("x=4", true), false);
  assert.equal(meetsTypedMinimum("I have no idea", false), true);
  assert.equal(meetsTypedMinimum("I have no idea", true), false);
  assert.equal(meetsTypedMinimum("y=2x+3", true), true);
});
