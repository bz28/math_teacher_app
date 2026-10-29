// Unit tests for the integrity chat's typed-reply minimums (mirror of
// the server rule in api/routes/integrity_check.py).
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node src/components/school/student/integrity-message-rules.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { meetsTypedMinimum } from "./integrity-message-rules.ts";

test("before the stuck tap: plain 5-char floor only", () => {
  assert.equal(meetsTypedMinimum("idk", false), false);
  assert.equal(meetsTypedMinimum("     ", false), false);
  assert.equal(meetsTypedMinimum("x=4", false), false);
  assert.equal(meetsTypedMinimum("I did", false), true);
});

test("after the stuck tap: 3+ words or 12+ chars", () => {
  assert.equal(meetsTypedMinimum("I did", true), false);
  assert.equal(meetsTypedMinimum("no idea", true), false);
  assert.equal(meetsTypedMinimum("dunno lol", true), false);
  assert.equal(meetsTypedMinimum("  no   idea  ", true), false);
  assert.equal(meetsTypedMinimum("abcdefghijk", true), false);
  assert.equal(meetsTypedMinimum("x = 4", true), true);
  assert.equal(meetsTypedMinimum("abcdefghijkl", true), true);
  assert.equal(meetsTypedMinimum("factorization", true), true);
});
