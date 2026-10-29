// node --experimental-strip-types --test src/lib/page-orientation.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundedPageCheck,
  CHECK_HOLD_MS,
  onlySomePagesSideways,
  parsePageCheck,
  pdfTooSmallError,
  sidewaysHint,
  sidewaysPrompt,
  stillSideways,
  type OrientationState,
} from "./page-orientation.ts";

const photo = (over: Partial<OrientationState> = {}): OrientationState => ({
  pageCount: 1,
  sidewaysPages: [1],
  rotation: 0,
  upright: false,
  ...over,
});

test("a sideways page clears only on a quarter turn", () => {
  assert.equal(stillSideways(photo()), true);
  assert.equal(stillSideways(photo({ rotation: 90 })), false);
  assert.equal(stillSideways(photo({ rotation: 180 })), true);
  assert.equal(stillSideways(photo({ rotation: 270 })), false);
  assert.equal(stillSideways(photo({ rotation: 0 })), true); // a full turn back
});

test("the student can always overrule the check", () => {
  assert.equal(stillSideways(photo({ upright: true })), false);
  assert.equal(stillSideways(photo({ upright: true, rotation: 180 })), false);
});

test("a page the check didn't flag is never blocked, turned or not", () => {
  for (const rotation of [0, 90, 180, 270]) {
    assert.equal(stillSideways(photo({ sidewaysPages: [], rotation })), false);
  }
});

test("a PDF with only some pages sideways can't be fixed by turning it", () => {
  const mixed = photo({ pageCount: 3, sidewaysPages: [2] });
  assert.equal(onlySomePagesSideways(mixed), true);
  assert.equal(onlySomePagesSideways(photo({ pageCount: 3, sidewaysPages: [1, 2, 3] })), false);
  assert.equal(onlySomePagesSideways(photo()), false);
  assert.match(sidewaysPrompt(mixed), /^Page 2 of this PDF is sideways\./);
  assert.match(
    sidewaysPrompt(photo({ pageCount: 4, sidewaysPages: [1, 3] })),
    /^Pages 1 and 3 of this PDF are sideways\..*those pages/,
  );
});

test("the prompt names what to turn", () => {
  assert.match(sidewaysPrompt(photo()), /^This page is sideways\. Rotate it/);
  assert.match(sidewaysPrompt(photo({ pageCount: 2, sidewaysPages: [1, 2] })), /^This PDF is sideways/);
});

test("hints and size errors name the pages", () => {
  assert.equal(sidewaysHint([2]), "Page 2 is sideways. Fix it before you turn it in.");
  assert.equal(sidewaysHint([1, 2, 4]), "Pages 1, 2 and 4 are sideways. Fix them before you turn it in.");
  assert.match(pdfTooSmallError([3]), /^Page 3 of this PDF is too small to read\. Take it again closer up/);
});

test("an older API's answer (no arrays) holds nothing and never throws", () => {
  // Partial deploy: new web, old API. It answers photos with only a boolean.
  assert.deepEqual(parsePageCheck({ sideways: false }), {
    pageCount: 1, sidewaysPages: [], tooSmallPages: [], preview: null,
  });
  assert.deepEqual(parsePageCheck({ sideways: true }).sidewaysPages, [1]);
  for (const junk of [null, undefined, "x", 3, [], { sideways_pages: "2", too_small_pages: null }]) {
    const r = parsePageCheck(junk);
    assert.deepEqual(r.sidewaysPages, []);
    assert.deepEqual(r.tooSmallPages, []);
  }
  assert.deepEqual(parsePageCheck({ sideways_pages: [2, -1, 1.5, "3"] }).sidewaysPages, [2]);
});

test("a check that runs long, fails, or answers junk holds nothing", async () => {
  assert.equal(await boundedPageCheck(() => new Promise(() => {}), 10), null);
  assert.equal(await boundedPageCheck(() => Promise.reject(new Error("offline")), 10), null);
  assert.deepEqual(
    await boundedPageCheck(
      () => Promise.resolve({ page_count: 3, sideways_pages: [2], too_small_pages: [], preview: "P" }),
      1000,
    ),
    { pageCount: 3, sidewaysPages: [2], tooSmallPages: [], preview: "P" },
  );
  assert.equal(CHECK_HOLD_MS, 20_000);
});
