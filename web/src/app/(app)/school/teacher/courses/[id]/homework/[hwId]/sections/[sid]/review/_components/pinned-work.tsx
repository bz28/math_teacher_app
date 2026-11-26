import { useState } from "react";
import { PdfView } from "@/components/ui/pdf-view";
import { WorkGalleryModal } from "@/components/school/teacher/_pieces/work-gallery";
import type { SubmissionFile } from "@/lib/api";
import { onPhotoError } from "@/lib/submission-photos";

/**
 * Student's submitted pages (images + PDFs): compact thumbnail +
 * page count that opens every file in a modal. The work is a
 * reference the teacher consults WHILE grading, so it lives in the
 * page header strip — one click away from any scroll position —
 * rather than as its own scan-path block. On the wide (3-column)
 * layout the PinnedWorkRail makes the work glanceable and this strip
 * affordance hides; below ~1100px the rail unpins and this takes over.
 */
export function StudentWorkThumbButton({
  files,
  studentName,
}: {
  files: SubmissionFile[];
  studentName: string;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const first = files[0];
  if (!first) return null;
  const firstIsPdf = first.media_type === "application/pdf";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpenAt(0)}
        className="group inline-flex items-center gap-1.5 rounded-[--radius-md] border border-border-light bg-surface px-2 py-1 text-xs font-semibold text-text-secondary transition-all hover:border-primary/40 hover:text-primary focus:border-primary focus:outline-none"
        aria-label="View student's handwritten work full size"
      >
        <span className="relative block h-7 w-10 shrink-0 overflow-hidden rounded-[--radius-sm] border border-border-light bg-[color:var(--color-surface-alt-2)]">
          {firstIsPdf ? (
            <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-text-muted">
              PDF
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={first.url}
              alt=""
              decoding="async"
              onError={() => onPhotoError(first)}
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <span>
          View work{files.length > 1 ? ` · ${files.length} pages` : ""} ↗
        </span>
      </button>
      <WorkGalleryModal
        files={files}
        studentName={studentName}
        openAt={openAt}
        onClose={() => setOpenAt(null)}
      />
    </>
  );
}

/**
 * Pinned student-work rail (wide layout, 3rd column). Promotes the
 * student's submitted pages out of the modal so they're glanceable while
 * grading — the split view. A sticky panel that keeps the first page in
 * view as the teacher scrolls the grade column; "⤢ Full" opens the same
 * lightbox for a zoom, and "📌 Pinned" collapses the inline photo to
 * reclaim vertical space (a session preference lifted to the page so it
 * persists across students). Hidden below ~1100px, where the header-strip
 * thumbnail takes over so the roster + grade column never get crushed.
 */
export function PinnedWorkRail({
  files,
  studentName,
  pinned,
  onTogglePinned,
}: {
  files: SubmissionFile[] | null;
  studentName: string | null;
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const firstName = studentName ? studentName.split(" ")[0] : null;
  const hasFiles = !!files && files.length > 0;
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[--radius-xl] border border-border-light bg-surface shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-border-light px-3 py-2.5">
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-text-secondary)]">
          {firstName ? `${firstName}'s work` : "Student's work"}
          {hasFiles && files!.length > 1 ? ` · ${files!.length} pages` : ""}
        </span>
        {hasFiles && (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={onTogglePinned}
              aria-pressed={pinned}
              className={`rounded-[--radius-sm] border px-2 py-1 text-[11px] font-semibold transition-colors ${
                pinned
                  ? "border-primary/30 bg-primary-bg text-primary"
                  : "border-border-light bg-surface text-text-muted hover:text-text-primary"
              }`}
            >
              📌 {pinned ? "Pinned" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => setOpenAt(0)}
              className="rounded-[--radius-sm] border border-border-light bg-surface px-2 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
            >
              ⤢ Full
            </button>
          </div>
        )}
      </div>
      {!hasFiles ? (
        <div className="px-3 py-10 text-center text-[11px] text-text-muted">
          No photo on this submission.
        </div>
      ) : pinned ? (
        <div className="min-h-48 flex-1 overflow-y-auto bg-[color:var(--color-surface-alt-2)]/40 p-2">
          <div className="flex flex-col gap-2">
            {files!.map((f, i) => {
              if (f.media_type === "application/pdf") {
                return (
                  <PdfView
                    key={i}
                    url={f.url}
                    className="h-[420px] w-full rounded-[--radius-sm] border border-border-light bg-white"
                  />
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setOpenAt(i)}
                  className="block w-full overflow-hidden rounded-[--radius-sm] border border-border-light"
                  aria-label={`Open page ${i + 1} full size`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={`Student handwritten submission, page ${i + 1}`}
                    loading={i === 0 ? undefined : "lazy"}
                    decoding="async"
                    onError={() => onPhotoError(f)}
                    className="w-full object-contain"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onTogglePinned}
          className="w-full px-3 py-4 text-center text-[11px] font-semibold text-text-muted hover:text-primary"
        >
          Photo collapsed — click to pin it back
        </button>
      )}
      <WorkGalleryModal
        files={files ?? []}
        studentName={studentName ?? "Student"}
        openAt={openAt}
        onClose={() => setOpenAt(null)}
      />
    </div>
  );
}
