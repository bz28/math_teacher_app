"use client";

import { useRef, useState } from "react";
import { fileToBase64, formatFileSize } from "@/lib/utils";
import { ImageResizeError, resizeImageForUpload } from "@/lib/image-resize";
import { FileTextIcon, ImageIcon, UploadIcon, XIcon } from "@/components/ui/icons";

// The New Homework wizard's Upload pane: worksheet photos / a PDF staged
// in the browser, then sent for Vision extraction.

// Backend caps mirrored client-side so we can reject oversized files
// before encoding+POSTing 23MB of base64. Magic-byte detection still
// happens server-side; this is just an early bail for the obvious case.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 23 * 1024 * 1024;
const MAX_FILES = 10;
// Extraction sends every file to the model in one request, so the batch
// shares that request's budget (MAX_TOTAL_SOURCE_B64_BYTES in
// api/core/document_vision.py; the server refuses past it). Measured on
// the base64 we send.
export const MAX_TOTAL_B64_BYTES = 31 * 1024 * 1024;
export const MAX_TOTAL_MB = 23;
const ACCEPT = "image/jpeg,image/png,application/pdf";

export interface StagedFile {
  id: string;
  filename: string;
  size: number;
  mediaType: "image/jpeg" | "image/png" | "application/pdf";
  /** Raw base64 (no data: prefix) — what the API expects. */
  base64: string;
  /** data: URL preview for image thumbnails; null for PDFs. */
  previewUrl: string | null;
  /** Per-row error if validation failed. Kept on a row so the teacher
   *  sees what was rejected, with valid files staged alongside. */
  error?: string;
}

/** Staged files plus the drag-and-drop handlers that feed them. Files
 *  stay staged across mode switches so a teacher who clicks Generate by
 *  accident doesn't lose their photos. */
export function useStagedFiles(busy: boolean) {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const ACCEPTED_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "application/pdf",
  ]);

  const newRowId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const errorRow = (file: File, message: string): StagedFile => ({
    id: newRowId(),
    filename: file.name,
    size: file.size,
    mediaType: "image/jpeg", // unused on error rows
    base64: "",
    previewUrl: null,
    error: message,
  });

  const stageOne = async (file: File): Promise<StagedFile> => {
    if (!ACCEPTED_TYPES.has(file.type)) {
      return errorRow(file, "Only JPEG, PNG, and PDF are accepted");
    }
    const isPdf = file.type === "application/pdf";

    // PDFs go through untouched — resizeImageForUpload is image-only.
    if (isPdf) {
      if (file.size > MAX_PDF_BYTES) {
        return errorRow(file, "Too large (max 23MB)");
      }
      try {
        const base64 = await fileToBase64(file);
        return {
          id: newRowId(),
          filename: file.name,
          size: file.size,
          mediaType: "application/pdf",
          base64,
          previewUrl: null,
        };
      } catch {
        return errorRow(file, "Could not read file");
      }
    }

    // Images: resize before staging so a phone photo lands well under
    // the 5 MB server cap.
    try {
      const blob = await resizeImageForUpload(file);
      if (blob.size > MAX_IMAGE_BYTES) {
        return errorRow(file, "Too large (max 5MB)");
      }
      const base64 = await fileToBase64(blob as File);
      const mediaType: StagedFile["mediaType"] =
        blob === file ? (file.type as StagedFile["mediaType"]) : "image/jpeg";
      return {
        id: newRowId(),
        filename: file.name,
        size: blob.size,
        mediaType,
        base64,
        previewUrl: `data:${mediaType};base64,${base64}`,
      };
    } catch (err) {
      if (err instanceof ImageResizeError) {
        return errorRow(file, err.message);
      }
      throw err;
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const remaining = Math.max(0, MAX_FILES - stagedFiles.length);
    const next = list.slice(0, remaining);
    const staged = await Promise.all(next.map(stageOne));
    setStagedFiles((prev) => [...prev, ...staged]);
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (busy) return;
    if (e.dataTransfer.files?.length) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  return {
    stagedFiles,
    dragActive,
    fileInputRef,
    handleFiles,
    removeStagedFile,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}

// ── Upload pane (worksheet photos / PDF → Vision extraction) ──

export function UploadSection({
  fileInputRef,
  dragActive,
  stagedFiles,
  scopeHint,
  onScopeHintChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onFilesSelected,
  onRemoveStaged,
  disabled,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dragActive: boolean;
  stagedFiles: StagedFile[];
  scopeHint: string;
  onScopeHintChange: (v: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFilesSelected: (files: FileList) => void;
  onRemoveStaged: (id: string) => void;
  disabled: boolean;
}) {
  const fullCount = stagedFiles.length;
  const atCap = fullCount >= MAX_FILES;
  return (
    <div className="space-y-3" role="tabpanel" aria-label="Upload">
      <div>
        <label className="block text-sm font-bold text-text-primary">
          Upload pages
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          Snap or drop a worksheet — the AI transcribes the problems verbatim
          into the review queue.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          disabled={disabled || atCap}
          aria-label="Add files"
          className={`mt-2 flex w-full flex-col items-center justify-center gap-1.5 rounded-[--radius-md] border border-dashed px-4 py-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border-light bg-bg-subtle hover:border-primary"
          }`}
        >
          <UploadIcon className="h-5 w-5 text-text-muted" />
          <span className="text-xs font-semibold text-text-primary">
            Drop photos or a PDF, or click to browse
          </span>
          <span className="text-[11px] text-text-muted">
            Up to {MAX_FILES} files, {MAX_TOTAL_MB} MB in total · JPEG/PNG up to 5 MB each
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {fullCount > 0 && (
        <ul className="space-y-1.5" aria-label="Staged files">
          {stagedFiles.map((f) => (
            <li
              key={f.id}
              className="flex min-h-[44px] items-center gap-3 rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2"
            >
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.previewUrl}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded object-cover"
                />
              ) : f.mediaType === "application/pdf" ? (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-bg-subtle text-text-muted">
                  <FileTextIcon className="h-5 w-5" />
                </div>
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-bg-subtle text-text-muted">
                  <ImageIcon className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-text-primary">
                  {f.filename}
                </p>
                <p className="text-[11px] text-text-muted">
                  {formatFileSize(f.size)}
                  {f.mediaType === "application/pdf" ? " · PDF" : ""}
                </p>
                {f.error && (
                  <p className="mt-0.5 text-[11px] text-[color:var(--color-error)]">{f.error}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveStaged(f.id)}
                disabled={disabled}
                aria-label={`Remove ${f.filename}`}
                className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {fullCount > 0 && (
        <p className="text-[11px] text-text-muted">
          {fullCount} of {MAX_FILES}
        </p>
      )}

      <div>
        <label
          htmlFor="hw-scope"
          className="block text-sm font-bold text-text-primary"
        >
          Which problems?{" "}
          <span className="font-normal text-text-muted">· optional</span>
        </label>
        <p className="mt-1 text-[11px] text-text-muted">
          Tell the AI which problems to pull. Leave blank to extract everything.
        </p>
        <input
          id="hw-scope"
          type="text"
          value={scopeHint}
          onChange={(e) => onScopeHintChange(e.target.value)}
          placeholder="e.g. Q1-13 odd, skip word problems"
          disabled={disabled}
          className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
