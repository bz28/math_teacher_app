"use client";

import { useEffect, useState } from "react";
import { useBlobUrl } from "@/hooks/use-blob-url";
import { teacher, type TeacherDocument } from "@/lib/api";
import { formatFileSize } from "@/lib/utils";
import { fileKind } from "./types";

interface FilePreviewModalProps {
  courseId: string;
  doc: TeacherDocument;
  onClose: () => void;
}

/**
 * Lightbox for a single uploaded document. Fetches image_data lazily —
 * the list endpoint omits the payload to keep responses lean. Images
 * render inline; PDFs go through <embed> with an "Open in new tab"
 * fallback for browsers (mobile Safari, sandboxed iframes) that don't
 * render inline PDFs — same pattern as the student submission viewer.
 */
export function FilePreviewModal({ courseId, doc, onClose }: FilePreviewModalProps) {
  const kind = fileKind(doc);
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher
      .document(courseId, doc.id)
      .then((d) => {
        if (cancelled) return;
        setImageData(d.image_data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, doc.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = imageData ? toDataUrl(imageData, doc.file_type) : null;
  // PDFs render and open from a blob: URL — a data: link is inert in
  // Chrome/Firefox, and that link is the whole fallback. Falls back to
  // `src` if the blob can't be built.
  const blobUrl = useBlobUrl(kind === "pdf" ? imageData : null, "application/pdf");
  const pdfUrl = blobUrl ?? src;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${doc.filename}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[--radius-lg] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-5 py-3">
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm font-bold text-text-primary"
              title={doc.filename}
            >
              {doc.filename}
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {formatFileSize(doc.file_size)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="ml-4 rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-bg-subtle p-4">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : !src ? (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : kind === "pdf" ? (
            <div className="w-full self-stretch">
              <embed
                src={pdfUrl ?? undefined}
                type="application/pdf"
                className="h-[75vh] w-full rounded-[--radius-md] bg-white"
              />
              <a
                href={pdfUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
              >
                Open PDF in new tab
              </a>
            </div>
          ) : (
            // Base64 data URL, not optimize-able by next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={doc.filename}
              className="max-h-[75vh] max-w-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// image_data is stored as raw base64 (no data: prefix). Build a data
// URL here so the <img> can render it directly.
function toDataUrl(base64: string, fileType: string): string {
  if (base64.startsWith("data:")) return base64;
  const mime = fileType || "image/jpeg";
  return `data:${mime};base64,${base64}`;
}
