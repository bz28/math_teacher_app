// node --experimental-strip-types --test src/lib/page-orientation.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundedPageCheck,
  CHECK_HOLD_MS,
  onlySomePagesSideways,
  orientationReport,
  parsePageCheck,
  pdfTooSmallError,
  sidewaysHint,
  sidewaysPrompt,
  stillSideways,
  turnInCountLabel,
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
    pageCount: 1, totalPages: 1, sidewaysPages: [], tooSmallPages: [], preview: null,
  });
  assert.deepEqual(parsePageCheck({ sideways: true }).sidewaysPages, [1]);
  // No `total_pages` yet: the checked pages are the best count there is.
  assert.equal(parsePageCheck({ page_count: 4 }).totalPages, 4);
  // A PDF past the check's cap: every page, not just the checked ones.
  const capped = parsePageCheck({ page_count: 30, total_pages: 40 });
  assert.equal(capped.pageCount, 30);
  assert.equal(capped.totalPages, 40);
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
    { pageCount: 3, totalPages: 3, sidewaysPages: [2], tooSmallPages: [], preview: "P" },
  );
  assert.equal(CHECK_HOLD_MS, 20_000);
});

test("each file reports how it got past the sideways hold", () => {
  const upright = photo({ sidewaysPages: [] });
  assert.equal(orientationReport(upright, true), "upright");
  // The check missed it but the student turned it anyway: still the
  // check's "upright" — rotations are reported separately.
  assert.equal(orientationReport({ ...upright, rotation: 90 }, true), "upright");
  assert.equal(orientationReport(photo({ rotation: 90 }), true), "rotated");
  assert.equal(orientationReport(photo({ rotation: 270 }), true), "rotated");
  assert.equal(orientationReport(photo({ upright: true }), true), "student_says_upright");
  // A half turn leaves it sideways; only the override got it through.
  assert.equal(
    orientationReport(photo({ rotation: 180, upright: true }), true),
    "student_says_upright",
  );
  // Some PDF pages sideways: no rotate button, the override is the way.
  assert.equal(
    orientationReport({ pageCount: 3, sidewaysPages: [2], rotation: 0, upright: true }, true),
    "student_says_upright",
  );
  // The check timed out or failed: nothing was held, whatever the state.
  assert.equal(orientationReport(upright, false), "unchecked");
  assert.equal(orientationReport(photo({ upright: true }), false), "unchecked");
});

test("turn-in counts pages across files, not files", () => {
  const img = { pdf: false, totalPages: 1, checked: true };
  const pdf6 = { pdf: true, totalPages: 6, checked: true };
  assert.equal(turnInCountLabel([pdf6]), "6 pages");
  assert.equal(turnInCountLabel([img]), "1 page");
  assert.equal(turnInCountLabel([img, pdf6, img]), "8 pages");
  assert.equal(turnInCountLabel([{ ...pdf6, totalPages: 1 }]), "1 page");
  // Past the check's page cap: every page the teacher gets.
  assert.equal(turnInCountLabel([{ ...pdf6, totalPages: 40 }]), "40 pages");
  // A photo is one page whether or not its check answered.
  assert.equal(turnInCountLabel([{ ...img, checked: false }, img]), "2 pages");
});

test("turn-in never guesses a PDF's pages before the check knows them", () => {
  const unknownPdf = { pdf: true, totalPages: 1, checked: false };
  const img = { pdf: false, totalPages: 1, checked: true };
  assert.equal(turnInCountLabel([unknownPdf]), "1 file");
  assert.equal(turnInCountLabel([unknownPdf, img]), "2 files");
  // The check answered 0 pages: it couldn't open the PDF.
  assert.equal(turnInCountLabel([{ ...unknownPdf, checked: true, totalPages: 0 }]), "1 file");
});
