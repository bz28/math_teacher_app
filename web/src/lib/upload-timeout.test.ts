// Unit tests for the size-scaled submit timeout in apiFetch's callers.
// Runs on plain Node (>=22.6) via native TS type-stripping:
//   node --experimental-strip-types src/lib/upload-timeout.test.ts
//
// The regression this file exists for: homework submits carried a fixed
// 30s abort. The body is every page inline as base64, so on a ~5 Mbps
// home upload four phone photos (~24MB on the wire) could not finish in
// time — the browser cancelled mid-body, the API logged the CORS
// preflight but never a POST, and the student saw the "trouble reaching
// our servers" banner on every retry (prod, 2026-09-14). The timeout
// exists to catch a dead backend, so it must grow with the bytes it has
// to move and only stay tight for small requests.
import assert from "node:assert/strict";
import { test } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

const { uploadTimeoutFor } = await import("./api.ts");

const MB = 1024 * 1024;

test("a tiny body keeps the 30s floor", () => {
  assert.equal(uploadTimeoutFor(10 * 1024), 30_100);
});

test("a four-photo submission gets minutes, not 30 seconds", () => {
  // ~18MB of JPEG → ~24MB of base64. At the pessimistic 100 KB/s that
  // is ~4 minutes of transfer on top of the floor.
  const ms = uploadTimeoutFor(24 * MB);
  assert.ok(ms > 4 * 60_000, `expected > 4 min, got ${ms}ms`);
  assert.ok(ms < 5 * 60_000, `expected < 5 min, got ${ms}ms`);
});

test("the largest allowed submission is capped at 10 minutes", () => {
  // Server cap is 50MB decoded → ~67MB base64; a dead link must still
  // fail in bounded time rather than spinning for the full transfer.
  assert.equal(uploadTimeoutFor(67 * MB), 10 * 60_000);
  assert.equal(uploadTimeoutFor(Number.MAX_SAFE_INTEGER), 10 * 60_000);
});

test("timeout is monotonic in body size", () => {
  let prev = 0;
  for (const bytes of [0, 100 * 1024, MB, 5 * MB, 20 * MB, 50 * MB]) {
    const ms = uploadTimeoutFor(bytes);
    assert.ok(ms >= prev, `${bytes}B → ${ms}ms regressed below ${prev}ms`);
    prev = ms;
  }
});
