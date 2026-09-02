"use client";

import { useEffect, useState } from "react";

/**
 * A `blob:` URL for base64 bytes of any type, revoked when the bytes
 * change or the component unmounts.
 *
 * Why not the `data:` URL the callers already build for `<embed>`/`<img>`:
 * Chrome and Firefox block top-level navigation to `data:` URLs, so
 * `<a href="data:application/pdf" target="_blank">` silently does
 * nothing when clicked. That link is the *only* recourse for browsers
 * which can't render a PDF inline (mobile Safari, sandboxed iframes) —
 * so precisely the people who need the fallback got a blank frame and a
 * dead link. `blob:` URLs are permitted for top-level navigation.
 *
 * The same block is why an "open this page full size" link on a photo
 * needs a blob handle too: a submitted image is base64 in the API
 * payload, and a `data:` link to it is just as inert. Hence the
 * media type is a parameter rather than pinned to PDF.
 *
 * Create and revoke both live in the effect, deliberately. Creating in
 * `useMemo` and revoking in an effect looks tidier and is wrong: React
 * StrictMode runs setup → cleanup → setup, the cleanup revokes the
 * handle, and the second setup can't recreate it because `useMemo`
 * doesn't re-run for an effect remount — leaving the committed
 * `src`/`href` pointing at a revoked blob for the rest of the
 * component's life. The `<embed>` usually still paints (the browser
 * fetches at commit, before passive effects), so it fails *invisibly*:
 * the frame looks right and only the link is dead. Creating in the
 * effect means the second setup makes a fresh handle. It also keeps
 * `createObjectURL` out of the render phase, where a discarded render
 * would leak a handle nothing ever revokes.
 *
 * Returns null until the effect has run, and if the bytes can't be
 * decoded; callers fall back to their `data:` URL, so behaviour is
 * never worse than before this hook existed.
 */
export function useBlobUrl(
  base64: string | null | undefined,
  mediaType: string,
): string | null {
  // The handle is stored WITH the bytes it was built from, and only
  // returned when the two still match. Decoding is async, so between the
  // input changing and the new handle arriving there is a window of one
  // or more renders — and holding a bare `url` across it would serve the
  // PREVIOUS handle, which cleanup has already revoked. A caller pointing
  // an <embed> or an href at a revoked blob: gets a torn-down plugin or a
  // dead new tab. Keying it means the gap returns null instead, and every
  // caller already falls back to its data: URL on null.
  const [handle, setHandle] = useState<{ key: string; url: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    // An object URL's lifecycle IS the external system this effect
    // synchronizes with: it has to be created and revoked in the same
    // scope to survive StrictMode's double-invoke. Deriving it during
    // render instead is the bug described above, not the fix.
    void (async () => {
      const built = base64 ? await createObjectUrlFor(base64, mediaType) : null;
      if (cancelled) {
        // Cleanup already ran (StrictMode's double-invoke, or the caller
        // moved to another file mid-decode). Revoke here — the cleanup
        // never saw this handle.
        if (built) URL.revokeObjectURL(built);
        return;
      }
      objectUrl = built;
      // Not a sync set-state-in-effect: this runs in a later microtask,
      // after the decode, so there is no cascading render to guard.
      setHandle(built && base64 ? { key: base64, url: built } : null);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        // Forget it as well as revoking it. Keying on the bytes alone
        // isn't enough: page A -> B -> back to A re-matches the stored
        // key while the handle it points at was revoked on the way out,
        // so the hook would hand a caller a dead blob: again. Clearing
        // here means the only thing a match can return is a live handle.
        setHandle((current) =>
          current && current.url === objectUrl ? null : current,
        );
      }
    };
  }, [base64, mediaType]);

  return handle && handle.key === base64 ? handle.url : null;
}

/** Build the handle, or null if the bytes can't be decoded (malformed
 *  base64, or a browser refusing the allocation) — the caller then keeps
 *  its data: URL, exactly as before this hook existed.
 *
 *  Decodes via `fetch` on a data: URL rather than atob + a byte-at-a-time
 *  copy. The hand-rolled loop measured ~48ms of BLOCKING main thread for
 *  a 5MB page (the per-file upload cap), which the gallery pays on every
 *  page turn — held arrow keys turned into visible stutter. `fetch` does
 *  the same work off-thread in about the same wall-clock and yields, so
 *  paging stays smooth. No network request is made.
 *
 *  One caveat if a Content-Security-Policy is ever added: `fetch` of a
 *  `data:` URL IS gated by `connect-src`, which would need an explicit
 *  `data:` source. The app sets no CSP today, and the failure is soft —
 *  fetch rejects, the catch returns null, and callers fall back to their
 *  data: URL — but it is the wrong thing to be surprised by later.
 */
async function createObjectUrlFor(
  base64: string,
  mediaType: string,
): Promise<string | null> {
  try {
    const blob = await fetch(`data:${mediaType};base64,${base64}`).then((r) =>
      r.blob(),
    );
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
