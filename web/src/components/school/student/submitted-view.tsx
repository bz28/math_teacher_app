"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { StudentSubmission, SubmissionFile } from "@/lib/api";
import { CheckIcon, FileTextIcon, XIcon } from "@/components/ui/icons";
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
  const reduceMotion = useReducedMotion();
  const pageCount = files.length;
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="mt-8 overflow-hidden rounded-[--radius-lg] border border-success-border bg-success-light shadow-[0_1px_2px_rgba(20,19,15,0.04)]"
    >
      {/* Payoff beat — the moment the work is safely in. */}
      <div className="px-6 pt-7 pb-6 text-center">
        <motion.span
          initial={reduceMotion ? false : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.12, type: "spring", stiffness: 380, damping: 18 }}
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-success text-white shadow-sm"
        >
          <CheckIcon className="h-6 w-6" strokeWidth={3} />
        </motion.span>
        <p className="eyebrow mt-4 text-success">Turned in</p>
        <h2 className="mt-1.5 font-serif text-[1.9rem] leading-tight text-text-primary">
          That&apos;s in your teacher&apos;s hands now.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
          Nice work — {pageCount === 1 ? "your page" : `all ${pageCount} pages`} went
          through. Your teacher will grade it soon, and you&apos;ll find your
          result waiting in{" "}
          <span className="font-semibold text-text-primary">Grades</span>.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-xs font-medium text-text-muted">
          <span>Submitted {submittedAt.toLocaleString()}</span>
          {submission.is_late && (
            <span className="rounded-full bg-warning-bg px-2 py-0.5 font-semibold text-warning-dark">
              Marked late
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-success-border/60 bg-surface/40 px-6 py-5">
        <div className="text-sm font-semibold text-text-primary">
          What your teacher sees{" "}
          <span className="font-normal text-text-muted">
            ({files.length} {files.length === 1 ? "page" : "pages"})
          </span>
        </div>
        {files.length === 0 ? (
          <p className="mt-2 text-sm italic text-text-muted">
            No files on this submission.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
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
    </motion.div>
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
          className="inline-flex items-center gap-1.5 rounded-[--radius-md] px-2 py-1 text-xs font-semibold text-text-muted hover:bg-bg-subtle hover:text-text-primary"
        >
          <XIcon className="h-3.5 w-3.5" /> Close
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
              Open PDF in new tab
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
