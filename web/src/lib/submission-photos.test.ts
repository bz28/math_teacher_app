// Unit tests for the photo URL cache. Plain Node (>=22.6):
//   node --experimental-strip-types --test src/lib/submission-photos.test.ts
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { SubmissionFile } from "./api.ts";
import { PHOTO_URLS_EXPIRED, onPhotoError, stablePhotoUrls } from "./submission-photos.ts";

const page = (id: string | null, url: string, expiresIn: number | null = 3600): SubmissionFile => ({
  id,
  url,
  media_type: "image/jpeg",
  expires_in: expiresIn,
});

afterEach(() => mock.timers.reset());

describe("stablePhotoUrls", () => {
  it("hands back the first URL for a page while it has time left, so the browser cache hits", () => {
    const [first] = stablePhotoUrls([page("p1", "https://b/p1?sig=a")]);
    const [again] = stablePhotoUrls([page("p1", "https://b/p1?sig=b")]);
    assert.equal(first!.url, "https://b/p1?sig=a");
    assert.equal(again!.url, "https://b/p1?sig=a");
  });

  it("takes the fresh URL once the cached one is close to expiring", () => {
    mock.timers.enable({ apis: ["Date"], now: 0 });
    stablePhotoUrls([page("p2", "https://b/p2?sig=a")]);
    mock.timers.tick(55 * 60 * 1000); // 5 minutes left: too close
    const [later] = stablePhotoUrls([page("p2", "https://b/p2?sig=b")]);
    assert.equal(later!.url, "https://b/p2?sig=b");
  });

  it("leaves pages without an id (a not-yet-moved data: URL) and null lists alone", () => {
    const inline = page(null, "data:image/jpeg;base64,AAAA", null);
    assert.deepEqual(stablePhotoUrls([inline]), [inline]);
    assert.equal(stablePhotoUrls(null), null);
  });
});

describe("onPhotoError", () => {
  it("asks for fresh URLs only when the failed one has expired", () => {
    mock.timers.enable({ apis: ["Date"], now: 0 });
    const fired: string[] = [];
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: (e: Event) => fired.push(e.type),
    };
    const [live] = stablePhotoUrls([page("p3", "https://b/p3?sig=a")]);
    onPhotoError(live!);
    assert.deepEqual(fired, []); // a live URL that failed: re-fetching can't help
    mock.timers.tick(61 * 60 * 1000);
    onPhotoError(live!);
    assert.deepEqual(fired, [PHOTO_URLS_EXPIRED]);
  });
});
