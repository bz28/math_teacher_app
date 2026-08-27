"use client";

import { useEffect, useMemo } from "react";

/**
 * A `blob:` URL for base64 PDF bytes, revoked when the component unmounts
 * or the bytes change.
 *
 * Why not just use the `data:` URL we already build for the `<embed>`:
 * Chrome and Firefox block top-level navigation to `data:` URLs, so
 * `<a href="data:application/pdf" target="_blank">` silently does nothing
 * when clicked. That link is the *only* recourse for browsers which can't
 * render a PDF inline (mobile Safari, sandboxed iframes) — so precisely
 * the people who need the fallback got a blank frame and a dead link.
 * `blob:` URLs are permitted for top-level navigation.
 *
 * The `<embed>` uses this too: a 25MB PDF is a ~33MB string as a `data:`
 * URL sitting in a DOM attribute, versus a short handle to the bytes.
 *
 * Returns null while the URL is being built and if the bytes can't be
 * decoded; callers fall back to the `data:` URL so behaviour is never
 * worse than before.
 */
export function usePdfBlobUrl(base64: string | null | undefined): string | null {
  // useMemo rather than state-in-an-effect: the URL is derived from the
  // bytes, so deriving it during render keeps it available on the first
  // paint and avoids the cascading re-render the lint rule warns about.
  const url = useMemo(() => {
    if (!base64) return null;
    try {
      return URL.createObjectURL(
        new Blob([decodeBase64(base64)], { type: "application/pdf" }),
      );
    } catch {
      // Malformed base64, or a browser refusing the allocation. The
      // caller keeps its data: URL — same as before this hook existed.
      return null;
    }
  }, [base64]);

  // Release the previous handle whenever the bytes change, and on
  // unmount. Keyed on `url` so each created handle is revoked exactly
  // once by the cleanup belonging to the render that made it.
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return url;
}

/** base64 -> bytes. Chunked because `atob` output for a 25MB PDF is a
 *  33M-char string, and a per-character callback over that is measurably
 *  slower than filling the array in blocks. */
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
