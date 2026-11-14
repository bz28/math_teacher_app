import assert from "node:assert/strict";
import { test } from "node:test";
import { createDetailCache } from "./detail-cache.ts";

type Detail = { id: string; score: number };

function counted(value: Detail) {
  let calls = 0;
  return {
    load: () => {
      calls += 1;
      return Promise.resolve(value);
    },
    calls: () => calls,
  };
}

test("A → B → A serves A from the cache without a second fetch", async () => {
  const cache = createDetailCache<Detail>();
  const rowA = {};
  const a = counted({ id: "a", score: 80 });
  await cache.load("a", rowA, a.load);
  await cache.load("b", {}, counted({ id: "b", score: 90 }).load);
  assert.deepEqual(cache.get("a", rowA), { id: "a", score: 80 });
  await cache.load("a", rowA, a.load);
  assert.equal(a.calls(), 1);
});

test("a changed row (a save, an approve, a poll) is a miss, never the old grade", async () => {
  const cache = createDetailCache<Detail>();
  const before = {};
  await cache.load("a", before, () => Promise.resolve({ id: "a", score: 80 }));
  const after = {}; // the roster replaced the row object on save
  assert.equal(cache.get("a", after), undefined);
  const fresh = await cache.load("a", after, () => Promise.resolve({ id: "a", score: 95 }));
  assert.equal(fresh.score, 95);
  // The superseded version is gone for good, not just shadowed.
  assert.equal(cache.get("a", before), undefined);
});

test("invalidate drops an entry, including one still in flight", async () => {
  const cache = createDetailCache<Detail>();
  const row = {};
  let resolve!: (d: Detail) => void;
  const pending = cache.load("a", row, () => new Promise((r) => (resolve = r)));
  cache.invalidate("a");
  resolve({ id: "a", score: 1 });
  assert.equal((await pending).score, 1); // the caller still gets its answer
  assert.equal(cache.get("a", row), undefined); // but it isn't kept
});

test("an in-flight load for the same version is joined, not repeated", async () => {
  const cache = createDetailCache<Detail>();
  const row = {};
  const a = counted({ id: "a", score: 1 });
  await Promise.all([cache.load("a", row, a.load), cache.load("a", row, a.load)]);
  assert.equal(a.calls(), 1);
});

test("entries expire ttl after the fetch started", async () => {
  let t = 0;
  const cache = createDetailCache<Detail>({ ttlMs: 1000, now: () => t });
  const row = {};
  await cache.load("a", row, () => Promise.resolve({ id: "a", score: 1 }));
  t = 1000;
  assert.ok(cache.get("a", row));
  t = 1001;
  assert.equal(cache.get("a", row), undefined);
});

test("only the most recently used `capacity` entries are kept", async () => {
  const cache = createDetailCache<Detail>({ capacity: 2 });
  const rows = { a: {}, b: {}, c: {} };
  for (const id of ["a", "b"] as const) {
    await cache.load(id, rows[id], () => Promise.resolve({ id, score: 0 }));
  }
  await cache.load("a", rows.a, () => Promise.reject(new Error("should hit")));
  await cache.load("c", rows.c, () => Promise.resolve({ id: "c", score: 0 }));
  assert.ok(cache.get("a", rows.a));
  assert.equal(cache.get("b", rows.b), undefined);
  assert.ok(cache.get("c", rows.c));
});

test("failures and values `keep` refuses are not cached", async () => {
  const cache = createDetailCache<Detail>({ keep: (d) => d.score >= 0 });
  const row = {};
  await assert.rejects(cache.load("a", row, () => Promise.reject(new Error("503"))));
  const retry = counted({ id: "a", score: 1 });
  await cache.load("a", row, retry.load);
  assert.equal(retry.calls(), 1);
  await cache.load("b", row, () => Promise.resolve({ id: "b", score: -1 }));
  assert.equal(cache.get("b", row), undefined);
});

test("holds is true only for the untouched cached object", async () => {
  const cache = createDetailCache<Detail>();
  const row = {};
  const d = await cache.load("a", row, () => Promise.resolve({ id: "a", score: 1 }));
  assert.equal(cache.holds("a", d), true);
  assert.equal(cache.holds("a", { ...d, score: 2 }), false);
});
