import type { SubmissionFile } from "./api.ts";

/**
 * Student homework photos arrive as short-lived presigned URLs to the
 * photo bucket (api/core/photo_store.py), never as bytes.
 *
 * Every response signs a fresh URL for the same page, and the browser
 * caches by URL — so without help, reopening a student would download
 * all of their photos again. This keeps the FIRST URL seen for each page
 * (keyed by the page's stable `id`) and hands it back on later responses
 * until it is close to expiring; the browser then serves the photo from
 * its cache (the objects are immutable and sent with a long
 * `Cache-Control`).
 *
 * Expiry is tracked from when the response arrived plus `expires_in`, not
 * from an absolute server time, so a wrong client clock can't make a live
 * URL look dead or the reverse.
 */

// Hand out a cached URL only while it has at least this long left — a
// page opened just before expiry still has time to load.
const REUSE_MARGIN_MS = 10 * 60 * 1000;

const urls = new Map<string, { url: string; expiresAt: number }>();

/** `files` with each page's URL swapped for the one this tab already
 *  loaded, when that one is still good. Call on every response that
 *  carries photos. */
export function stablePhotoUrls<T extends SubmissionFile>(files: T[]): T[];
export function stablePhotoUrls<T extends SubmissionFile>(
  files: T[] | null,
): T[] | null;
export function stablePhotoUrls<T extends SubmissionFile>(
  files: T[] | null,
): T[] | null {
  if (!files) return files;
  const now = Date.now();
  return files.map((f) => {
    if (!f.id || f.expires_in == null) return f;
    const cached = urls.get(f.id);
    if (cached && cached.expiresAt - now > REUSE_MARGIN_MS) {
      return { ...f, url: cached.url };
    }
    urls.set(f.id, { url: f.url, expiresAt: now + f.expires_in * 1000 });
    return f;
  });
}

/** Fired when a photo failed to load because its URL had expired (a tab
 *  left open past the hour). Pages that fetched the photos listen and
 *  re-fetch, which signs new URLs. */
export const PHOTO_URLS_EXPIRED = "veradic:photo-urls-expired";

/** `onError` for a photo `<img>`: if its URL has expired, ask the page
 *  that owns it for fresh ones. A load error on a live URL is left alone
 *  — re-fetching can't fix a missing object, and would loop. */
export function onPhotoError(file: SubmissionFile): void {
  if (!file.id) return;
  const cached = urls.get(file.id);
  const expired = !cached || cached.url !== file.url || cached.expiresAt <= Date.now();
  if (!expired) return;
  urls.delete(file.id);
  window.dispatchEvent(new Event(PHOTO_URLS_EXPIRED));
}
