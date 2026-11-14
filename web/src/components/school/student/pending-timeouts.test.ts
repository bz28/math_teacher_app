// The waiting screen serves two different waits. They need different bounds.
//
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node --experimental-strip-types src/components/school/student/pending-timeouts.test.ts
//
// Background: this screen polls while the server works, and gives up with
// "Couldn't prepare your check". Its budget was a single 90s constant,
// measured against nothing in particular. Production extraction runs p50
// 57.7s / p95 87.2s, so the screen was quitting under three seconds after
// a 95th-percentile read finished — about 1 student in 20 was told their
// work had failed when it had succeeded.
//
// Raising it to cover extraction (max on record 178.8s) created the
// opposite problem, because the SAME component also covers the
// post-confirm question-writing wait, which is an order of magnitude
// quicker (p50 4.1s / max 19.7s). One shared ceiling meant a genuine
// stall in the fast phase parked a student on a spinner for four minutes.
//
// These pin the split, and the phase-gating of the slow-path copy — the
// reassurance "looks like you wrote a lot" is true of a long READ, and a
// misattribution of a stall anywhere else.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXTRACTION_TIMEOUT_MS,
  QUESTIONS_TIMEOUT_MS,
  SLOW_AFTER_MS,
  showsSlowCopy,
  timeoutFor,
} from "./pending-timeouts.ts";

// Measured over production llm_calls, 2026-09.
const EXTRACTION_MAX_OBSERVED_MS = 178_800;
const QUESTIONS_MAX_OBSERVED_MS = 19_700;

test("extraction gets a bound above the slowest read on record", () => {
  // 178.8s really happened and really succeeded. A ceiling under it calls
  // a working read a failure, which is the bug this change exists to fix.
  assert.ok(
    EXTRACTION_TIMEOUT_MS > EXTRACTION_MAX_OBSERVED_MS,
    `extraction bound ${EXTRACTION_TIMEOUT_MS}ms is under the slowest real read`,
  );
  assert.equal(timeoutFor("pre_confirm"), EXTRACTION_TIMEOUT_MS);
});

test("question-writing is not held to the extraction bound", () => {
  // The regression guard. Collapsing these back to one constant is the
  // easy "simplification" that reintroduces the four-minute spinner.
  assert.ok(
    QUESTIONS_TIMEOUT_MS < EXTRACTION_TIMEOUT_MS,
    "post-confirm must not inherit the extraction ceiling",
  );
  assert.equal(timeoutFor("post_confirm"), QUESTIONS_TIMEOUT_MS);
});

test("the question-writing bound still clears its own worst case", () => {
  // Tight enough to surface a stall, loose enough not to cut off a slow
  // but healthy run — 3x the worst observed.
  assert.ok(
    QUESTIONS_TIMEOUT_MS > QUESTIONS_MAX_OBSERVED_MS * 2,
    `${QUESTIONS_TIMEOUT_MS}ms leaves too little headroom over ${QUESTIONS_MAX_OBSERVED_MS}ms`,
  );
});

test("an unresolved phase waits the longer bound", () => {
  // Phase is null until the first poll answers. Guessing short here would
  // abandon a healthy extraction during its first three seconds.
  assert.equal(timeoutFor(null), EXTRACTION_TIMEOUT_MS);
});

test("the slow-path copy appears for a long read", () => {
  assert.equal(showsSlowCopy(SLOW_AFTER_MS + 1, "pre_confirm"), true);
  assert.equal(showsSlowCopy(SLOW_AFTER_MS + 1, null), true);
});

test("the slow-path copy never blames the student for a stall", () => {
  // Post-confirm at 75s is ~18x past its median: something is wrong, and
  // "looks like you wrote a lot" points the finger at the student's page
  // count for what is actually a system fault.
  assert.equal(showsSlowCopy(SLOW_AFTER_MS + 1, "post_confirm"), false);
});

test("the slow-path copy stays hidden during a normal wait", () => {
  assert.equal(showsSlowCopy(SLOW_AFTER_MS - 1, "pre_confirm"), false);
});
