import { Modal } from "@/components/ui/modal";
import type { TeacherSubmissionRow } from "@/lib/api";

// ────────────────────────────────────────────────────────────────────
// "Grade all" (page header). Sits BEFORE Publish because it's the
// earlier step: you can't publish what hasn't been graded.
//
// Only renders when there is ungraded submitted work. That makes it
// self-explaining — its presence means "there's something to grade",
// and it disappears once the class is done rather than sitting there
// inert inviting a pointless click.
//
// The count is the point of the label. "Grade all" alone doesn't tell
// a teacher whether they're about to spend on 2 submissions or 30.
// ────────────────────────────────────────────────────────────────────

export function GradeAllButton({
  ungradedCount,
  busy,
  onClick,
}: {
  ungradedCount: number;
  busy: boolean;
  onClick: () => void;
}) {
  if (ungradedCount === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-[--radius-pill] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-[color:var(--color-surface-alt-2)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <>
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
          />
          Grading…
        </>
      ) : (
        <>
          Grade {ungradedCount} ungraded
        </>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Regrade confirmation — the regrade is destructive to any manual
// edits on the submission (override semantics). Confirm dialog
// spells that out so the teacher doesn't lose work by accident.
// ────────────────────────────────────────────────────────────────────

export function RegradeConfirmDialog({
  submissionId,
  row,
  regrading,
  error,
  onClose,
  onConfirm,
}: {
  submissionId: string | null;
  row: TeacherSubmissionRow | null;
  regrading: boolean;
  /** Failure message from the last regrade attempt. Rendered inline
   *  so the teacher sees it without having to dismiss the modal; the
   *  drift banner underneath would otherwise be covered by the overlay. */
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const open = submissionId !== null;
  const published = !!row?.grade_published_at;
  return (
    <Modal open={open} onClose={onClose} dismissible={!regrading} label="Regrade submission">
      <h2 className="text-lg font-bold text-text-primary">
        Regrade with current rubric?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        The AI will re-grade this submission using the rubric in your
        Grading setup. Any manual edits you made on this submission
        will be replaced.
      </p>
      {published && (
        <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          This grade is already published. The student will keep seeing
          the old grade until you republish.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] px-3 py-2 text-xs font-semibold text-[color:var(--color-error)]  dark:bg-[color:var(--color-error-light)] ">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={regrading}
          className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={regrading}
          className="rounded-[--radius-md] bg-[color:var(--color-warning-dark)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[color:var(--color-warning)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[color:var(--color-warning)]  "
        >
          {regrading ? "Regrading…" : "Regrade"}
        </button>
      </div>
    </Modal>
  );
}
