import assert from "node:assert/strict";
import { test } from "node:test";
import { flagWords } from "./flag-words.ts";

test("each kind of flag is said apart, and nothing when none", () => {
  assert.deepEqual(flagWords({ worth_a_look: 0, photo_problems: 0, too_long: 0 }), []);
  assert.deepEqual(flagWords({ worth_a_look: 1, photo_problems: 2, too_long: 1 }), [
    "1 worth a look",
    "2 photo or reading problems",
    "1 too long to AI-grade",
  ]);
});

test("homework too long for the AI grader is counted, not dropped", () => {
  assert.deepEqual(flagWords({ worth_a_look: 0, photo_problems: 0, too_long: 1 }), ["1 too long to AI-grade"]);
});
