"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useBlobUrl } from "@/hooks/use-blob-url";
import type { SubmissionFile } from "@/lib/api";

/**
 * The teacher's view of a student's submitted pages.
 *
 * The grading page used to stack every page in one scroll with no page
 * markers, no way back to a specific page, and no way to magnify a
 * photo. A submission can carry ten pages, so that gap was felt on
 * exactly the work that is hardest to read. This is the viewer that
 * replaced it.
 *
 * Opened from three places on the grading page — the header strip, the
 * pinned rail, and a problem's page marker — each with its own open
 * state, so a marker can deep-link to the page its work is on.
 */

function pageLabel(file: SubmissionFile, index: number): string {
  return file.filename ?? `Page ${index + 1}`;
}

/**
 * One page at a time, with a thumbnail rail and a pager so the teacher
 * can reach a specific page instead of scroll-hunting for it. Closed
 * when `openAt` is null; otherwise it opens on that page.
 *
 * Both formats get an "open full size in a new tab" escape hatch, which
 * is the only way to actually magnify a page: the inline view is sized
 * to the modal, and browser zoom on the real file is better than any
 * pan-and-zoom we would build here. Both need a `blob:` URL — a `data:`
 * link is inert for top-level navigation in Chrome and Firefox. PDFs
 * additionally need it because some browsers won't render them inline
 * at all and the link is their only recourse.
 */
export function WorkGalleryModal({
  files,
  studentName,
  openAt,
  onClose,
}: {
  files: SubmissionFile[];
  studentName: string;
  /** Page index to open on, or null to stay closed. */
  openAt: number | null;
  onClose: () => void;
}) {
  // Mount the viewer per open rather than keeping one alive and resetting
  // it. The pager's position is ordinary local state inside `GalleryBody`,
  // so closing unmounts it and the next open starts from whatever page the
  // caller asked for — no effect, and nothing to keep in sync.
  //
  // Keying on `openAt` matters as much as the early return: the callers
  // hold this component permanently mounted (they render it unconditionally
  // and rely on it returning null), and two of them always request page 1.
  // Without a remount, "page to 5, close, reopen" would restore page 5, and
  // because the instance also survives a student switch, it would restore
  // page 5 of the NEXT student's work.
  if (openAt === null || files.length === 0) return null;
  return (
    <GalleryBody
      key={openAt}
      files={files}
      studentName={studentName}
      initialIndex={openAt}
      onClose={onClose}
    />
  );
}

function GalleryBody({
  files,
  studentName,
  initialIndex,
  onClose,
}: {
  files: SubmissionFile[];
  studentName: string;
  initialIndex: number;
  onClose: () => void;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(n, files.length - 1));
  const [index, setIndex] = useState(() => clamp(initialIndex));
  // `files` can shrink between renders (a student switch while open), so
  // clamp on read too rather than trusting the stored value.
  const current = clamp(index);
  const file = files[current]!;

  // ←/→ flip pages. Modal owns Esc and Tab; these sit alongside. Bail on
  // modifier chords so Alt+← (browser back) and the like still work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, files.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [files.length]);

  const label = pageLabel(file, current);
  return (
    <Modal
      open
      onClose={onClose}
      className="max-h-[90vh] w-full max-w-5xl overflow-y-auto bg-surface p-3"
      label={`${studentName}'s work`}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          {studentName}&apos;s {label}
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

      {/* The page has to leave room for whatever sits under it. With a
          rail and a pager below, a 75vh page pushed the "Page N of M"
          control off a laptop screen — the one thing the rail was added
          to make reachable. Cap the single-page case higher, since
          there's nothing beneath it to crowd out. */}
      <GalleryPage
        file={file}
        label={label}
        studentName={studentName}
        maxHeightClass={files.length > 1 ? "max-h-[52vh]" : "max-h-[72vh]"}
      />

      {files.length > 1 && (
        <>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {files.map((f, i) => (
              <RailThumb
                key={i}
                file={f}
                index={i}
                current={i === current}
                studentName={studentName}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
              disabled={current === 0}
              aria-label="Previous page"
              className="inline-flex min-h-[44px] items-center rounded-[--radius-sm] border border-border px-3 text-sm text-text-secondary hover:border-primary disabled:opacity-30"
            >
              ← Previous
            </button>
            <span
              aria-live="polite"
              aria-atomic="true"
              className="text-xs font-semibold text-text-muted"
            >
              Page {current + 1} of {files.length}
            </span>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(i + 1, files.length - 1))}
              disabled={current === files.length - 1}
              aria-label="Next page"
              className="inline-flex min-h-[44px] items-center rounded-[--radius-sm] border border-border px-3 text-sm text-text-secondary hover:border-primary disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** The page itself plus its open-full-size link. Split out so the blob
 *  handle is keyed to one file and is revoked when the teacher pages
 *  away, rather than accumulating one per page visited. */
function GalleryPage({
  file,
  label,
  studentName,
  maxHeightClass,
}: {
  file: SubmissionFile;
  label: string;
  studentName: string;
  maxHeightClass: string;
}) {
  const isPdf = file.media_type === "application/pdf";
  const dataUrl = `data:${file.media_type};base64,${file.data}`;
  const blobUrl = useBlobUrl(file.data, file.media_type);
  const href = blobUrl ?? dataUrl;
  return (
    <div className="relative overflow-auto">
      {isPdf ? (
        <embed
          src={href}
          type="application/pdf"
          className={`${maxHeightClass} h-[70vh] w-full rounded-[--radius-md] bg-white`}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={`${studentName}'s ${label}`}
          className={`mx-auto ${maxHeightClass} w-auto rounded-[--radius-md] object-contain`}
        />
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
      >
        Open {label.toLowerCase()} full size ↗
      </a>
    </div>
  );
}

function RailThumb({
  file,
  index,
  current,
  studentName,
  onClick,
}: {
  file: SubmissionFile;
  index: number;
  current: boolean;
  studentName: string;
  onClick: () => void;
}) {
  const isPdf = file.media_type === "application/pdf";
  const dataUrl = `data:${file.media_type};base64,${file.data}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Go to ${studentName}'s ${pageLabel(file, index)}`}
      aria-current={current ? "true" : undefined}
      className={`shrink-0 overflow-hidden rounded-[--radius-sm] border bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        current
          ? "border-primary ring-1 ring-primary"
          : "border-border-light hover:border-primary/50"
      }`}
    >
      {isPdf ? (
        <div className="flex h-12 w-10 items-center justify-center bg-bg-subtle text-[9px] font-bold text-text-muted">
          PDF
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="" className="h-12 w-10 object-cover" />
      )}
      <span className="block bg-bg-subtle px-1 text-center text-[9px] text-text-muted">
        {index + 1}
      </span>
    </button>
  );
}
