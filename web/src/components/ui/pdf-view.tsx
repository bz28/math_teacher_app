"use client";

import { useBlobUrl } from "@/hooks/use-blob-url";

interface PdfViewProps {
  /** Raw base64 PDF bytes (no `data:` prefix). */
  data: string;
  /** Classes for the <embed> — callers size it to their layout. */
  className?: string;
}

/**
 * A PDF rendered inline, with a working "open in new tab" escape hatch.
 *
 * The escape hatch is the point. Some browsers (mobile Safari, sandboxed
 * iframes) won't render a PDF in an <embed> at all and show a blank
 * frame, so the link is the only way those viewers reach the file. It
 * has to be a `blob:` URL: Chrome and Firefox block top-level navigation
 * to `data:` URLs, so a `data:` link is silently inert — dead in exactly
 * the case it exists to cover.
 *
 * Falls back to a `data:` URL if the blob can't be built, which still
 * renders inline even where the link won't navigate.
 */
export function PdfView({ data, className }: PdfViewProps) {
  const dataUrl = `data:application/pdf;base64,${data}`;
  const url = useBlobUrl(data, "application/pdf") ?? dataUrl;
  return (
    <div className="w-full">
      <embed src={url} type="application/pdf" className={className} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
      >
        Open PDF in new tab
      </a>
    </div>
  );
}
