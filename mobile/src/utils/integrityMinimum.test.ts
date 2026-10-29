// Table-driven tests for the chat's typed-reply rules. The SAME table lives
// in tests/test_integrity_non_answer.py and
// web/src/components/school/student/integrity-message-rules.test.ts —
// change all three together.
import { isNonAnswer, meetsIntegrityMinimum, normalizeReply } from "./integrityMinimum";

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

describe("isNonAnswer", () => {
  it.each(NON_ANSWERS)("non-answer: %s", (text) => {
    expect(isNonAnswer(text)).toBe(true);
  });
  it.each(ANSWERS)("answer: %s", (text) => {
    expect(isNonAnswer(text)).toBe(false);
  });
});

it("normalize matches smart punctuation and case", () => {
  expect(normalizeReply("I’M STUCK – I’m not sure how to explain this")).toBe(
    normalizeReply("I'm stuck — I'm not sure how to explain this."),
  );
});

it("meetsIntegrityMinimum: 5-char floor for everyone, non-answers only after the tap", () => {
  expect(meetsIntegrityMinimum("idk", false)).toBe(false);
  expect(meetsIntegrityMinimum("x=4", true)).toBe(false);
  expect(meetsIntegrityMinimum("I have no idea", false)).toBe(true);
  expect(meetsIntegrityMinimum("I have no idea", true)).toBe(false);
  expect(meetsIntegrityMinimum("y=2x+3", true)).toBe(true);
});
