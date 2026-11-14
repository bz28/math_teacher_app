import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTEMPTS, plannedAttempts, scaledSize } from "./image-resize.ts";

const longEdge = (w: number, h: number, maxDim: number) => {
  const s = scaledSize(w, h, maxDim);
  return Math.max(s.width, s.height);
};

test("a 12MP phone photo is first tried at its full resolution", () => {
  const [first] = plannedAttempts(4032, 3024);
  assert.deepEqual(scaledSize(4032, 3024, first.maxDim), { width: 4032, height: 3024 });
});

test("an oversized photo steps down to the reader's 2576px, then a 2048px floor", () => {
  const plan = plannedAttempts(8064, 6048); // 48MP
  assert.deepEqual(
    plan.map((a) => longEdge(8064, 6048, a.maxDim)),
    [4096, 2576, 2048],
  );
});

test("never below 2048px on the long edge", () => {
  for (const a of ATTEMPTS) assert.ok(a.maxDim >= 2048);
  assert.equal(longEdge(3000, 4000, ATTEMPTS[ATTEMPTS.length - 1].maxDim), 2048);
});

test("a photo that already fits the reader isn't encoded twice at the same size", () => {
  // 2400px is the same image under the 4096 and 2576 caps.
  assert.deepEqual(
    plannedAttempts(1800, 2400).map((a) => longEdge(1800, 2400, a.maxDim)),
    [2400, 2048],
  );
  // At or under the floor every cap gives the same pixels: try at the
  // best quality, then once more at the floor's lower quality.
  assert.deepEqual(
    plannedAttempts(1500, 2000).map((a) => a.quality),
    [0.85, 0.8],
  );
});

test("aspect ratio is kept and nothing is upscaled", () => {
  assert.deepEqual(scaledSize(6000, 1500, 2576), { width: 2576, height: 644 });
  assert.deepEqual(scaledSize(800, 600, 4096), { width: 800, height: 600 });
});
