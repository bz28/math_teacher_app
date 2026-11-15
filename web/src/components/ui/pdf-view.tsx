"use client";

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
 */
export function PdfView({ url, className }: PdfViewProps) {
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
