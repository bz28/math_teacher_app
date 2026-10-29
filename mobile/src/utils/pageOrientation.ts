// Whether a staged homework file still reads as sideways, and what the
// upload screen tells the student about it. Sideways pages block turn-in
// (the AI reader misreads them), but the check behind them is a free
// pixel heuristic that can be wrong, so the student can always overrule
// it with "It's already upright". The server never enforces orientation,
// only the size floor.
//
// A copy of web/src/lib/page-orientation.ts (mobile can't import web) —
// keep the two in step.

export interface OrientationState {
  /** Pages in the file: 1 for a photo, one per page for a PDF. */
  pageCount: number;
  /** 1-based pages within the file the check read as sideways. */
  sidewaysPages: number[];
  /** Clockwise quarter turns the student applied to the whole file. */
  rotation: number;
  /** The student said the file is already upright. */
  upright: boolean;
}

/** The longest a page check holds turn-in. A big PDF on a slow link can
 *  take longer to upload than a student should wait; past this the check
 *  is dropped and holds nothing (fail open, like any failed check). */
export const CHECK_HOLD_MS = 20_000;

/** What the upload screen takes from the page check. */
export interface PageCheck {
  pageCount: number;
  sidewaysPages: number[];
  tooSmallPages: number[];
  preview: string | null;
}

/** Read a page-check response defensively — every field may be missing
 *  or malformed (an older API is still live while a new client deploys),
 *  and a bad answer must hold nothing rather than crash the screen. An
 *  older API answers a photo with only `sideways: boolean`. */
export function parsePageCheck(res: unknown): PageCheck {
  const r = (res !== null && typeof res === "object" ? res : {}) as Record<string, unknown>;
  const pages = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
  const count = r.page_count;
  const sidewaysPages = pages(r.sideways_pages);
  return {
    pageCount: Number.isInteger(count) && (count as number) >= 0 ? (count as number) : 1,
    sidewaysPages:
      sidewaysPages.length === 0 && r.sideways === true && !("sideways_pages" in r)
        ? [1]
        : sidewaysPages,
    tooSmallPages: pages(r.too_small_pages),
    preview: typeof r.preview === "string" && r.preview ? r.preview : null,
  };
}

/** Run a page check, giving up after `CHECK_HOLD_MS`. Resolves null on
 *  any failure or timeout — the caller then holds nothing. */
export async function boundedPageCheck(
  run: () => Promise<unknown>,
  holdMs: number = CHECK_HOLD_MS,
): Promise<PageCheck | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), holdMs);
  });
  try {
    return await Promise.race([run().then(parsePageCheck), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Some, but not all, pages of a PDF read as sideways. Turning the file
 *  would turn the upright pages too, so it can't be fixed here. */
export function onlySomePagesSideways(f: OrientationState): boolean {
  return f.sidewaysPages.length > 0 && f.sidewaysPages.length < f.pageCount;
}

/** Still sideways after the student's turns? A half turn leaves a
 *  sideways page sideways, so only a quarter turn clears it. A page the
 *  check didn't flag is never called sideways after a turn: the check
 *  misses some sideways pages, and the student may be fixing one. */
export function stillSideways(f: OrientationState): boolean {
  return !f.upright && f.sidewaysPages.length > 0 && f.rotation % 180 === 0;
}

/** The line shown on a sideways file. */
export function sidewaysPrompt(f: OrientationState): string {
  if (f.pageCount <= 1) {
    return "This page is sideways. Rotate it so the writing reads across.";
  }
  if (!onlySomePagesSideways(f)) {
    return "This PDF is sideways. Rotate it so the writing reads across.";
  }
  const pages = f.sidewaysPages;
  const which = pages.length === 1 ? `Page ${pages[0]}` : `Pages ${listPages(pages)}`;
  return (
    `${which} of this PDF ${pages.length === 1 ? "is" : "are"} sideways. ` +
    "Save it upright and add it again, or add a photo of " +
    `${pages.length === 1 ? "that page" : "those pages"} instead.`
  );
}

/** Why turn-in is held, naming files by their turn-in page number. */
export function sidewaysHint(turnInPages: number[]): string {
  return turnInPages.length === 1
    ? `Page ${turnInPages[0]} is sideways. Fix it before you turn it in.`
    : `Pages ${listPages(turnInPages)} are sideways. Fix them before you turn it in.`;
}

/** A PDF page the server would refuse at turn-in. */
export function pdfTooSmallError(pages: number[]): string {
  const which = pages.length === 1 ? `Page ${pages[0]}` : `Pages ${listPages(pages)}`;
  return (
    `${which} of this PDF ${pages.length === 1 ? "is" : "are"} too small to read. ` +
    "Take it again closer up, so the page fills the screen."
  );
}

function listPages(pages: number[]): string {
  return pages.length === 2
    ? `${pages[0]} and ${pages[1]}`
    : `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
}
