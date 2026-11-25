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
// Publish button (page header). HW-wide counts. Four states:
//   • pending + dirty > 0              → primary CTA opens confirmation
//   • graded > 0, no pending, no dirty → "All grades published" pill
//   • nothing graded                   → "No grades to publish" pill
// The button label flips between "Publish" (fresh-only), "Republish"
// (dirty-only), and "Publish & republish" (mixed) so the teacher sees
// what the action will actually do.
// ────────────────────────────────────────────────────────────────────

export function PublishButton({
  pendingTotal,
  dirtyTotal,
  gradedTotal,
  onOpen,
}: {
  pendingTotal: number;
  dirtyTotal: number;
  gradedTotal: number;
  onOpen: () => void;
}) {
  const toRelease = pendingTotal + dirtyTotal;
  if (toRelease === 0) {
    if (gradedTotal === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-3 py-1.5 text-xs font-semibold text-text-muted">
          No grades to publish
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-3 py-1.5 text-xs font-semibold text-text-muted">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
        All grades published
      </span>
    );
  }
  const verb =
    pendingTotal === 0 ? "Republish" : dirtyTotal === 0 ? "Publish" : "Publish & republish";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
    >
      {verb} {toRelease} {toRelease === 1 ? "grade" : "grades"} →
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Confirmation dialog before publishing. Makes the HW-wide scope
// explicit when there are grades in other sections — the button was
// clicked from one section's view but the action affects all of them.
// ────────────────────────────────────────────────────────────────────

export function PublishConfirmDialog({
  open,
  onClose,
  pendingInSection,
  pendingOtherSections,
  dirtyInSection,
  dirtyOtherSections,
  reviewedToPublish,
  unreviewedToPublish,
  flaggedToPublish,
  graphToPublish,
  publishing,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  pendingInSection: number;
  pendingOtherSections: number;
  dirtyInSection: number;
  dirtyOtherSections: number;
  /** How many of the to-release grades the teacher has explicitly
   *  approved vs left unapproved. Sum === total. Drives the unapproved
   *  warning + whether "Publish only approved" is offered. */
  reviewedToPublish: number;
  unreviewedToPublish: number;
  /** Submissions about to be published whose integrity check flagged
   *  them for review and the teacher hasn't resolved yet. Drives the
   *  soft confirm — a warning, never a block. */
  flaggedToPublish: number;
  /** Submissions about to be published with graph items still waiting
   *  on the teacher's ✓/✗. Those items keep their points until marked.
   *  A warning, never a block. */
  graphToPublish: number;
  publishing: boolean;
  error: string | null;
  onConfirm: (reviewedOnly?: boolean) => void;
}) {
  const pendingTotal = pendingInSection + pendingOtherSections;
  const dirtyTotal = dirtyInSection + dirtyOtherSections;
  const total = pendingTotal + dirtyTotal;
  const otherSections = pendingOtherSections + dirtyOtherSections;
  const verb =
    pendingTotal === 0 ? "Republish" : dirtyTotal === 0 ? "Publish" : "Publish & republish";
  const body =
    pendingTotal === 0
      ? "Students will see the updated scores immediately."
      : dirtyTotal === 0
        ? "Students will see their scores immediately. Ungraded submissions aren\u2019t affected."
        : "Students will see the new and updated scores immediately. Ungraded submissions aren\u2019t affected.";
  // Offer the safer path only when there's a meaningful split — some
  // approved AND some not. If everything's approved there's nothing to
  // hold back; if nothing's approved, "only approved" would publish
  // zero, so we don't show it.
  const offerReviewedOnly = reviewedToPublish > 0 && unreviewedToPublish > 0;
  return (
    <Modal open={open} onClose={onClose} dismissible={!publishing} label="Confirm grade publishing">
      <h2 className="text-lg font-bold text-text-primary">
        {verb} {total} {total === 1 ? "grade" : "grades"}?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
      {/* Unapproved warning — make it explicit that grades the teacher
       *  hasn't approved are about to go out, so publishing them is an
       *  informed choice, not a blind one. */}
      {unreviewedToPublish > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <span className="font-semibold">{unreviewedToPublish}</span>{" "}
          {unreviewedToPublish === 1
            ? "grade you haven’t approved"
            : "grades you haven’t approved"}{" "}
          will be published
          {reviewedToPublish > 0 ? (
            <> ({reviewedToPublish} already approved)</>
          ) : null}
          . Publish anyway?
        </p>
      )}
      {dirtyTotal > 0 && pendingTotal > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-3 py-2 text-xs text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <span className="font-semibold">{dirtyTotal}</span>{" "}
          {dirtyTotal === 1 ? "is an edit" : "are edits"} to already-published grades.
        </p>
      )}
      {/* Soft integrity confirm — a flagged-for-review submission is
       *  about to go out unresolved. Warn, don't block: the teacher can
       *  still publish (legit reasons exist), but they make the call
       *  with eyes open instead of by accident. */}
      {flaggedToPublish > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-error)]/30 bg-[color:var(--color-error-light)] px-3 py-2 text-xs text-[color:var(--color-error)]">
          <span aria-hidden>⚑ </span>
          <span className="font-semibold">{flaggedToPublish}</span>{" "}
          {flaggedToPublish === 1
            ? "submission is flagged for review"
            : "submissions are flagged for review"}{" "}
          and not yet resolved. Publish anyway, or close this and review
          {flaggedToPublish === 1 ? " it" : " them"} first?
        </p>
      )}
      {/* Graph items the check couldn't decide. Its own quiet look,
       *  with the "?" the checklist uses for those items, so it doesn't
       *  read as a second unapproved warning. */}
      {graphToPublish > 0 && (
        <p className="mt-3 flex gap-2 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          <span
            aria-hidden
            className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[color:var(--color-warning-dark)]/30 bg-[color:var(--color-warning-bg)] text-[10px] font-bold text-[color:var(--color-warning-dark)]"
          >
            ?
          </span>
          <span>
            <span className="font-semibold text-text-primary">{graphToPublish}</span>{" "}
            {graphToPublish === 1
              ? "grade still has graph items to check"
              : "grades still have graph items to check"}
            . Those items count as correct until you mark them; a ✗ lowers
            the score the next time you publish.
          </span>
        </p>
      )}
      {otherSections > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          This includes <span className="font-semibold">{otherSections}</span>{" "}
          {otherSections === 1 ? "grade" : "grades"} from other sections
          of this homework.
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-[color:var(--color-error)]">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={publishing}
          className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        {offerReviewedOnly && (
          <button
            type="button"
            onClick={() => onConfirm(true)}
            disabled={publishing}
            className="rounded-[--radius-md] border border-primary/40 bg-primary-bg px-4 py-2 text-xs font-bold text-primary transition-colors hover:border-primary/70 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Publish only approved ({reviewedToPublish})
          </button>
        )}
        <button
          type="button"
          onClick={() => onConfirm(false)}
          disabled={publishing}
          className="rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {publishing
            ? "Publishing\u2026"
            : offerReviewedOnly
              ? "Publish all"
              : `${verb} grades`}
        </button>
      </div>
    </Modal>
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
