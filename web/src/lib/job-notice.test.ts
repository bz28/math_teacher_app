// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node --experimental-strip-types --test src/lib/job-notice.test.ts
//
// A generated set that came back short tells the teacher how many were
// left out. Before, the note sat in error_message on a "done" job, which
// the teacher UI only shows for failed jobs, so she was never told.
import assert from "node:assert/strict";
import { test } from "node:test";

import { jobNotices } from "./job-notice.ts";

const NOTE = "6 of 8 problems are ready. 2 more didn't pass our checks (usually a diagram that couldn't be confirmed), so they were left out — generate again for more.";

test("a finished short set shows its notice", () => {
  assert.deepEqual(jobNotices([{ id: "a", status: "done", notice: NOTE }], false), [{ id: "a", text: NOTE }]);
});

test("no notice while generating, for a full set, or for an unfinished or failed job", () => {
  assert.deepEqual(jobNotices([{ id: "a", status: "done", notice: NOTE }], true), []);
  assert.deepEqual(jobNotices([{ id: "a", status: "done", notice: null }, { id: "b", status: "done" }], false), []);
  assert.deepEqual(jobNotices([{ id: "a", status: "running", notice: NOTE }], false), []);
  assert.deepEqual(jobNotices([{ id: "a", status: "failed", notice: NOTE }], false), []);
});
