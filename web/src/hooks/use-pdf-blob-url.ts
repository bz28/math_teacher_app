"use client";

import { useEffect, useState } from "react";

/**
 * A `blob:` URL for base64 PDF bytes, revoked when the bytes change or
 * the component unmounts.
 *
 * Why not the `data:` URL the callers already build for `<embed>`:
 * Chrome and Firefox block top-level navigation to `data:` URLs, so
 * `<a href="data:application/pdf" target="_blank">` silently does
 * nothing when clicked. That link is the *only* recourse for browsers
 * which can't render a PDF inline (mobile Safari, sandboxed iframes) —
 * so precisely the people who need the fallback got a blank frame and a
 * dead link. `blob:` URLs are permitted for top-level navigation.
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
export function usePdfBlobUrl(base64: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = base64 ? createPdfObjectUrl(base64) : null;
    // An object URL's lifecycle IS the external system this effect
    // synchronizes with: it has to be created and revoked in the same
    // scope to survive StrictMode's double-invoke. Deriving it during
    // render instead is the bug described above, not the fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    // No setUrl(null) here: React runs cleanup and the next setup in the
    // same commit with no render in between, so state never hands a
    // caller a revoked handle. On unmount the state is discarded anyway.
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [base64]);

  return url;
}

/** Build the handle, or null if the bytes can't be decoded (malformed
 *  base64, or a browser refusing the allocation) — the caller then keeps
 *  its data: URL, exactly as before this hook existed. */
function createPdfObjectUrl(base64: string): string | null {
  try {
    return URL.createObjectURL(
      new Blob([decodeBase64(base64)], { type: "application/pdf" }),
    );
  } catch {
    return null;
  }
}

/** base64 -> bytes. `atob` returns a binary string whose char codes are
 *  the bytes; copying them one at a time is exact across the full
 *  0-255 range, high-bit values included. */
function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  // Allocate the ArrayBuffer explicitly: a bare `new Uint8Array(n)` is
  // typed over ArrayBufferLike, which BlobPart won't accept.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
