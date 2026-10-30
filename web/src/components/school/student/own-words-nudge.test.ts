// Unit tests for when the integrity chat's own-words popup opens.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/components/school/student/own-words-nudge.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldOpenOwnWordsNudge } from "./own-words-nudge.ts";

const off = { nudge_own_words: false, overall_status: "in_progress" };
const on = { nudge_own_words: true, overall_status: "in_progress" };

test("opens on the reply that turns the nudge on", () => {
  assert.equal(shouldOpenOwnWordsNudge(off, on), true);
});

test("opens once per trigger: not again while the same streak continues", () => {
  assert.equal(shouldOpenOwnWordsNudge(on, on), false);
});

test("opens again after the streak breaks and re-forms", () => {
  const sequence = [off, on, on, off, on];
  const opens = sequence
    .slice(1)
    .filter((next, i) => shouldOpenOwnWordsNudge(sequence[i], next)).length;
  assert.equal(opens, 2);
});

test("stays closed while the nudge is off", () => {
  assert.equal(shouldOpenOwnWordsNudge(on, off), false);
  assert.equal(shouldOpenOwnWordsNudge(off, off), false);
});

test("never opens once the check is over", () => {
  assert.equal(
    shouldOpenOwnWordsNudge(off, { nudge_own_words: true, overall_status: "complete" }),
    false,
  );
});
