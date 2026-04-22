"use client";

import { useEffect, useState } from "react";
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
 * the list endpoint omits the payload to keep responses lean. PDFs
 * show a placeholder for now; inline PDF rendering is a separate lift.
 */
export function FilePreviewModal({ courseId, doc, onClose }: FilePreviewModalProps) {
  const kind = fileKind(doc);
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "image") return;
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
  }, [courseId, doc.id, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = imageData ? toDataUrl(imageData, doc.file_type) : null;

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
          {kind === "pdf" ? (
            <div className="max-w-sm text-center text-sm text-text-muted">
              PDF preview isn&rsquo;t available yet.
              <div className="mt-1 text-[11px]">
                For now, download the file from your source to view it.
              </div>
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : src ? (
            // Base64 data URL, not optimize-able by next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={doc.filename}
              className="max-h-[75vh] max-w-full object-contain"
            />
          ) : (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
