// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node --experimental-strip-types --test src/lib/generation-progress.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generatingLabel,
  generationJobsKey,
  generationProgress,
  idsToRemember,
  expiredJobIds,
  oldestFirst,
  startJobUpdate,
  withStartedJob,
} from "./generation-progress.ts";

const job = (status: string, mode: string, requested: number, produced: number) => ({
  status,
  mode,
  requested_count: requested,
  produced_count: produced,
});

test("an upload not yet read says so, with no count", () => {
  const p = generationProgress([job("running", "upload", 0, 0)]);
  assert.deepEqual(p, { requested: 0, produced: 0, reading: true });
  assert.equal(generatingLabel(p.requested, p.reading), "Reading your pages…");
  assert.equal(generatingLabel(p.requested, p.reading, "more"), "Reading more problems from your pages…");
});

test("a finished generate job's count is not shown as problems read from the pages", () => {
  // Generate 5 more finished while the upload is still reading.
  const p = generationProgress([job("done", "generate", 5, 5), job("running", "upload", 0, 0)]);
  assert.deepEqual(p, { requested: 0, produced: 0, reading: true });
  assert.equal(generatingLabel(p.requested, p.reading, "more"), "Reading more problems from your pages…");
});

test("once read, the upload's own count shows", () => {
  const p = generationProgress([job("done", "generate", 5, 5), job("running", "upload", 6, 2)]);
  assert.deepEqual(p, { requested: 6, produced: 2, reading: true });
  assert.equal(generatingLabel(p.requested, p.reading), "Reading 6 problems from your pages…");
});

test("generation counts every job feeding the homework", () => {
  const p = generationProgress([job("done", "generate", 3, 3), job("running", "generate", 4, 1)]);
  assert.deepEqual(p, { requested: 7, produced: 4, reading: false });
  assert.equal(generatingLabel(1, false), "Generating 1 problem…");
  assert.equal(generatingLabel(7, false, "more"), "Generating 7 more…");
});

test("review walks pending problems oldest first, one millisecond apart", () => {
  // The bank lists newest first; a worksheet's problems are stamped 1 ms apart.
  const newestFirst = [6, 5, 4, 3, 2, 1].map((n) => ({
    n,
    created_at: `2026-11-24T15:00:00.00${n}000+00:00`,
  }));
  assert.deepEqual(oldestFirst(newestFirst).map((i) => i.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(newestFirst[0].n, 6, "the input is left alone");
});

test("a started job is tracked with only the jobs still running", () => {
  const j = (id: string, status: string) => ({ id, status, requested_count: 5, produced_count: 0 });
  const next = withStartedJob([j("a", "done"), j("b", "failed"), j("c", "running"), j("d", "queued")], j("e", "queued"));
  assert.deepEqual(next.map((x) => x.id), ["c", "d", "e"]);
  // Starting the same job twice doesn't track it twice.
  assert.deepEqual(withStartedJob(next, j("e", "running")).map((x) => x.id), ["c", "d", "e"]);
  // The page restores from the key the wizard writes.
  assert.equal(generationJobsKey("hw1"), "hw-gen-hw1");
});

test("starting a job builds on the latest jobs, not the ones seen at click time", () => {
  const j = (id: string, status: string, produced = 0) => ({
    id, status, requested_count: 5, produced_count: produced,
  });
  const update = startJobUpdate(j("b", "queued"));
  // Clicked while "a" was running; a poll tick finished it before the start returned.
  assert.deepEqual(update([j("a", "done", 5)]).map((x) => [x.id, x.status]), [["b", "queued"]]);
});

test("only running jobs are remembered; none running means forget the key", () => {
  const j = (id: string, status: string) => ({ id, status, requested_count: 5, produced_count: 0 });
  assert.deepEqual(idsToRemember([j("a", "running"), j("b", "done"), j("c", "queued")]), ["a", "c"]);
  assert.deepEqual(idsToRemember([j("a", "done"), j("b", "failed")]), []);
});

test("each job's poll ceiling runs from when it was first seen", () => {
  const seen = new Map([["old", 0], ["new", 240_000]]);
  // Five minutes after the old job started, the new one has had one.
  assert.deepEqual(expiredJobIds(["old", "new"], seen, 300_001, 300_000), ["old"]);
  assert.deepEqual(expiredJobIds(["old", "new"], seen, 540_001, 300_000), ["old", "new"]);
  assert.deepEqual(expiredJobIds(["unseen"], seen, 999_999, 300_000), []);
});
