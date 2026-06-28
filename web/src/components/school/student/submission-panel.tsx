"use client";

import { useRef, useState } from "react";
import {
  schoolStudent,
  type SubmitHomeworkResponse,
} from "@/lib/api";
import {
  blobToDataUrl,
  ImageResizeError,
  resizeImageForUpload,
} from "@/lib/image-resize";
import { fileToBase64, formatFileSize } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  ImageIcon,
  LockIcon,
  UploadIcon,
  XIcon,
} from "@/components/ui/icons";

interface Props {
  assignmentId: string;
  dueAt: string | null;
  /** Called after a successful submit so the parent can swap into
   *  the submitted read-only view. */
  onSubmitted: (resp: SubmitHomeworkResponse) => void;
}

/**
 * "Submit your homework" panel at the bottom of the locked HW page.
 *
 * Multi-file: a student can stage up to 10 photos (JPEG/PNG) or a PDF.
 * The work is the source of truth for the teacher view and the
 * integrity-check + AI grading pipelines, which read all pages as one
 * sequential document so cross-page work stitches naturally.
 *
 * Per-file resizing for images runs client-side (resizeImageForUpload)
 * so a 12 MP phone photo doesn't get rejected at the 5 MB server cap.
 * PDFs go through untouched up to 25 MB.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const ACCEPT = "image/jpeg,image/png,application/pdf";

interface StagedFile {
  id: string;
  filename: string;
  size: number;
  mediaType: "image/jpeg" | "image/png" | "application/pdf";
  /** Raw base64 (no data: prefix). What the API expects in `files`. */
  base64: string;
  /** data: URL preview for image rows. Null for PDFs and error rows. */
  previewUrl: string | null;
  /** Per-row error message; valid files stay alongside. */
  error?: string;
}

export function SubmissionPanel({
  assignmentId,
  dueAt,
  onSubmitted,
}: Props) {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Concurrent-batch counter so two overlapping handleFiles calls
  // (drop + picker, or two drops in flight) don't have the first
  // call's `finally` flip `preparing` off while the second is still
  // resizing. Increment on entry, decrement in finally; flip the
  // flag off only when nothing is in flight.
  const inFlightRef = useRef(0);

  const reduceMotion = useReducedMotion();
  const isLate = dueAt ? new Date(dueAt) < new Date() : false;
  const validCount = stagedFiles.filter((f) => !f.error && f.base64).length;
  const canSubmit = validCount > 0 && !submitting && !preparing;

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

  async function stageOne(file: File): Promise<StagedFile> {
    const accepted = ["image/jpeg", "image/png", "application/pdf"];
    if (!accepted.includes(file.type)) {
      return errorRow(file, "Only JPEG, PNG, and PDF are accepted");
    }
    const isPdf = file.type === "application/pdf";

    if (isPdf) {
      if (file.size > MAX_PDF_BYTES) {
        return errorRow(file, "Too large (max 25MB)");
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

    // Images: resize before staging so a 10 MP phone photo lands well
    // under the 5 MB server cap. resizeImageForUpload returns the
    // original File when already small enough, else a smaller JPEG Blob.
    try {
      const blob = await resizeImageForUpload(file);
      if (blob.size > MAX_IMAGE_BYTES) {
        return errorRow(file, "Too large (max 5MB)");
      }
      const dataUrl = await blobToDataUrl(blob);
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const mediaType: StagedFile["mediaType"] =
        blob === file ? (file.type as StagedFile["mediaType"]) : "image/jpeg";
      return {
        id: newRowId(),
        filename: file.name,
        size: blob.size,
        mediaType,
        base64,
        previewUrl: dataUrl,
      };
    } catch (err) {
      if (err instanceof ImageResizeError) {
        return errorRow(file, err.message);
      }
      // FileReader / encoding failure — give the student a friendly
      // message instead of a blank screen.
      return errorRow(file, "Could not read file");
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    inFlightRef.current += 1;
    setPreparing(true);
    try {
      // Resize/encode every file in the batch first, then commit in a
      // single functional setState that re-reads the live `prev` list
      // and slices to the cap. This honors MAX_FILES even when two
      // batches commit out-of-order (drop + picker race), without the
      // earlier read-only updater anti-pattern.
      const staged: StagedFile[] = [];
      for (const file of list) {
        const row = await stageOne(file);
        staged.push(row);
      }
      setStagedFiles((prev) => {
        const remaining = Math.max(0, MAX_FILES - prev.length);
        return [...prev, ...staged.slice(0, remaining)];
      });
    } finally {
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0) setPreparing(false);
    }
  }

  function removeStagedFile(id: string) {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function moveStaged(id: string, dir: -1 | 1) {
    setStagedFiles((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function doSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const valid = stagedFiles.filter((f) => !f.error && f.base64);
      const resp = await schoolStudent.submitHomework(assignmentId, {
        files: valid.map((f) => f.base64),
      });
      onSubmitted(resp);
    } catch (err) {
      setError((err as Error).message || "Submit failed. Try again.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  const atCap = stagedFiles.length >= MAX_FILES;

  return (
    <div className="mt-8 overflow-hidden rounded-[--radius-lg] border border-border bg-surface shadow-[0_1px_2px_rgba(20,19,15,0.04)]">
      <div className="border-b border-border-light bg-primary-bg/30 px-6 py-5">
        <p className="eyebrow text-primary/80">Turn in your work</p>
        <h2 className="mt-1.5 font-serif text-[1.75rem] leading-tight text-text-primary">
          Submit your homework
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
          Add clear photos or a PDF of your completed work — up to {MAX_FILES}{" "}
          files. If your work runs over a few pages, snap each one in order. Your
          teacher sees exactly what you turn in, so a steady, well-lit shot goes
          a long way.
        </p>
      </div>

      <div className="px-6 py-5">
      {isLate && (
        <div className="mb-5 flex items-start gap-2.5 rounded-[--radius-sm] border border-warning/25 bg-warning-bg/60 p-3 text-sm text-warning-dark">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={2} />
          <span>
            This homework is past due. You can still turn it in, and it will be
            marked late so your teacher knows.
          </span>
        </div>
      )}

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          disabled={atCap || submitting || preparing}
          aria-label="Add files"
          className={cn(
            "flex w-full flex-col items-center justify-center gap-1.5 rounded-[--radius-md] border border-dashed px-4 py-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border bg-surface hover:border-primary",
          )}
        >
          <UploadIcon className="h-5 w-5 text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">
            Drop photos or a PDF, or tap to add
          </span>
          <span className="text-xs text-text-muted">
            up to {MAX_FILES} files · JPEG, PNG, PDF · large photos shrink automatically
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
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {preparing && (
          <p className="text-xs text-text-muted">Preparing your files…</p>
        )}

        {stagedFiles.length > 0 && (
          <ul className="space-y-2" aria-label="Staged files">
            {stagedFiles.map((f, i) => (
              <li
                key={f.id}
                className="flex min-h-[44px] items-center gap-3 rounded-[--radius-md] border border-border bg-surface px-3 py-2"
              >
                {f.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.previewUrl}
                    alt={`Preview of ${f.filename}`}
                    className="h-12 w-12 flex-shrink-0 rounded object-cover"
                  />
                ) : f.mediaType === "application/pdf" ? (
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-bg-subtle text-text-muted">
                    <FileTextIcon className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-bg-subtle text-text-muted">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    Page {i + 1} · {f.filename}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatFileSize(f.size)}
                    {f.mediaType === "application/pdf" ? " · PDF" : ""}
                  </p>
                  {f.error && (
                    <p className="mt-0.5 text-xs text-error">{f.error}</p>
                  )}
                </div>
                {/* Up / down reorder: page order matters because the
                    extraction sees pages as a sequential document. */}
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => moveStaged(f.id, -1)}
                    disabled={i === 0 || submitting}
                    aria-label={`Move ${f.filename} up`}
                    className="inline-flex h-[22px] w-11 items-center justify-center rounded-t-[--radius-sm] text-text-muted transition-colors hover:bg-bg-subtle hover:text-primary disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                  >
                    <ChevronUpIcon className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStaged(f.id, 1)}
                    disabled={i === stagedFiles.length - 1 || submitting}
                    aria-label={`Move ${f.filename} down`}
                    className="inline-flex h-[22px] w-11 items-center justify-center rounded-b-[--radius-sm] text-text-muted transition-colors hover:bg-bg-subtle hover:text-primary disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                  >
                    <ChevronDownIcon className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeStagedFile(f.id)}
                  disabled={submitting}
                  aria-label={`Remove ${f.filename}`}
                  className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded text-text-muted hover:bg-bg-subtle hover:text-error disabled:opacity-50"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {stagedFiles.length > 0 && (
          <div className="flex items-center justify-between pt-0.5">
            <p className="text-xs font-medium text-text-muted">
              {stagedFiles.length} of {MAX_FILES}
            </p>
            {validCount > 1 && (
              <p className="text-xs text-text-muted">
                Drag isn&apos;t needed — use the arrows to set page order.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-sm text-error">{error}</p>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {confirming ? (
          <motion.div
            key="confirm"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="mt-6 rounded-[--radius-md] border border-primary/25 bg-primary-bg/30 p-5"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LockIcon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="font-serif text-lg leading-snug text-text-primary">
                  Ready to turn it in?
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  Your teacher will see exactly{" "}
                  <span className="font-semibold text-text-primary">
                    {validCount} {validCount === 1 ? "page" : "pages"}
                  </span>{" "}
                  of work — nothing else. Once you turn it in you won&apos;t be
                  able to change it, so take one last look if you&apos;d like.
                  You&apos;ve got this.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setConfirming(false)}
                disabled={submitting}
                className="order-2 inline-flex min-h-[44px] items-center justify-center rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-primary hover:text-text-primary disabled:opacity-50 sm:order-1"
              >
                Not yet — let me look again
              </button>
              <button
                onClick={doSubmit}
                disabled={submitting}
                className="order-1 inline-flex min-h-[44px] items-center justify-center rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark disabled:opacity-50 sm:order-2"
              >
                {submitting ? "Turning it in…" : "Turn it in"}
              </button>
            </div>
          </motion.div>
        ) : (
          <div key="cta" className="mt-6 flex justify-end">
            <button
              onClick={() => setConfirming(true)}
              disabled={!canSubmit}
              className={cn(
                "inline-flex min-h-[44px] items-center justify-center rounded-[--radius-sm] px-6 py-2 text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-50",
                isLate
                  ? "bg-warning hover:bg-warning-dark"
                  : "bg-primary hover:bg-primary-dark",
              )}
            >
              Review &amp; turn in{isLate ? " (late)" : ""}
            </button>
          </div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
