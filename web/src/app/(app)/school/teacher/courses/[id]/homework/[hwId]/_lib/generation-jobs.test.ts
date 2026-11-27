// Runs on plain Node (>=22.6), from this folder:
//   node --experimental-strip-types --test generation-jobs.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGenerationJobs, withGenerationJob } from "./generation-jobs.ts";

test("a Generate-more job joins the wizard's jobs, once", () => {
  assert.equal(withGenerationJob(null, "j2"), '["j2"]');
  assert.equal(withGenerationJob('["j1"]', "j2"), '["j1","j2"]');
  assert.equal(withGenerationJob('["j1","j2"]', "j2"), '["j1","j2"]');
});

test("a malformed stored value is replaced, not iterated", () => {
  assert.equal(parseGenerationJobs('"abc"'), null);
  assert.equal(parseGenerationJobs("{"), null);
  assert.equal(parseGenerationJobs("[1]"), null);
  assert.equal(withGenerationJob('"abc"', "j2"), '["j2"]');
});
