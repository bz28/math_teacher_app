"use client";

import { useOpenableUrl } from "@/hooks/use-blob-url";

interface PdfViewProps {
  /** Where the PDF loads from — a submission file's `url`. */
  url: string;
  /** Classes for the <embed> — callers size it to their layout. */
  className?: string;
}

/**
 * A PDF rendered inline, with a working "open in new tab" escape hatch.
 *
 * The escape hatch is the point. Some browsers (mobile Safari, sandboxed
 * iframes) won't render a PDF in an <embed> at all and show a blank
 * frame, so the link is the only way those viewers reach the file.
 * `useOpenableUrl` keeps that link live for a page still served inline
 * as a `data:` URL, which top-level navigation refuses.
 */
export function PdfView({ url, className }: PdfViewProps) {
  const href = useOpenableUrl(url);
  return (
    <div className="w-full">
      <embed src={href} type="application/pdf" className={className} />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
      >
        Open PDF in new tab
      </a>
    </div>
  );
}
