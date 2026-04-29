"use client";

import { useState } from "react";
import type { StudentSubmission, SubmissionFile } from "@/lib/api";
import { FileTextIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";

interface Props {
  submission: StudentSubmission;
}

/**
 * Read-only view of a submitted homework. Renders the gallery of
 * files the student turned in (≤10), plus the submission timestamp
 * and late badge. Each thumbnail opens a zoom modal so the student
 * can verify what their teacher will see.
 */
export function SubmittedView({ submission }: Props) {
  const submittedAt = new Date(submission.submitted_at);
  const files = submission.files ?? [];
  const [zoomedFile, setZoomedFile] = useState<SubmissionFile | null>(null);
  return (
    <div className="mt-8 rounded-[--radius-md] border border-green-500 bg-green-50 p-6 dark:bg-green-500/10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">✓ Submitted</h2>
        <div className="text-xs font-medium text-text-muted">
          {submittedAt.toLocaleString()}
          {submission.is_late && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
              LATE
            </span>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-semibold text-text-primary">
          Your work{" "}
          <span className="font-normal text-text-muted">
            ({files.length} {files.length === 1 ? "page" : "pages"})
          </span>
        </div>
        {files.length === 0 ? (
          <p className="mt-2 italic text-sm text-text-muted">
            No files on this submission.
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {files.map((f, i) => (
              <SubmissionThumb
                key={i}
                file={f}
                index={i}
                onClick={() => setZoomedFile(f)}
              />
            ))}
          </div>
        )}
      </div>

      {zoomedFile && (
        <ZoomModal file={zoomedFile} onClose={() => setZoomedFile(null)} />
      )}
    </div>
  );
}

function SubmissionThumb({
  file,
  index,
  onClick,
}: {
  file: SubmissionFile;
  index: number;
  onClick: () => void;
}) {
  const isPdf = file.media_type === "application/pdf";
  const dataUrl = `data:${file.media_type};base64,${file.data}`;
  const label = file.filename ?? `Page ${index + 1}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${label}`}
      className="overflow-hidden rounded-[--radius-sm] border border-border bg-surface hover:border-primary focus:border-primary focus:outline-none"
    >
      {isPdf ? (
        <div className="flex flex-col items-center gap-1 bg-bg-subtle p-4 text-text-secondary">
          <FileTextIcon className="h-10 w-10" />
          <span className="max-w-full truncate text-[10px]">{label}</span>
          <span className="text-[10px] text-text-muted">PDF</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={label}
          className="h-[160px] w-full object-cover"
        />
      )}
      <div className="bg-bg-subtle px-2 py-0.5 text-center text-[10px] text-text-muted">
        Page {index + 1}
      </div>
    </button>
  );
}

/** Uses the shared Modal so Esc, focus trap, body-scroll-lock, and
 *  return-focus all behave per the rest of the app. PDF embed has an
 *  "Open in new tab" fallback for browsers (mobile Safari, sandboxed
 *  iframes) that don't render inline PDFs. */
function ZoomModal({
  file,
  onClose,
}: {
  file: SubmissionFile;
  onClose: () => void;
}) {
  const isPdf = file.media_type === "application/pdf";
  const dataUrl = `data:${file.media_type};base64,${file.data}`;
  const label = file.filename ?? "Submitted page";
  return (
    <Modal
      open
      onClose={onClose}
      className="max-h-[90vh] w-full max-w-5xl bg-surface p-3"
    >
      <div className="flex items-center justify-between pb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          {label}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded-[--radius-md] px-2 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle hover:text-text-primary"
        >
          Close ✕
        </button>
      </div>
      <div className="overflow-auto">
        {isPdf ? (
          <>
            <embed
              src={dataUrl}
              type="application/pdf"
              className="h-[75vh] w-full rounded-[--radius-md] bg-white"
            />
            <a
              href={dataUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
            >
              Open PDF in new tab ↗
            </a>
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={label}
            className="mx-auto max-h-[80vh] w-auto rounded-[--radius-md] object-contain"
          />
        )}
      </div>
    </Modal>
  );
}
