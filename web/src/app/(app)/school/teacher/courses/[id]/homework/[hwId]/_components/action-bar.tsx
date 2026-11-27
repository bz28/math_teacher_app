"use client";

// ────────────────────────────────────────────────────────────────────
// Sticky action bar — viewport-pinned footer with Preview as student
// (left) and Publish/Unpublish (right). Includes a small validation
// hint on the left when Publish is blocked, so the teacher knows what
// to fix without hovering the disabled button.
//
// When `confirming` is set, the bar replaces the normal row with a
// soft-confirm UI: what looks off (no due date, graph checklists not
// checked), a way to fix each, and "Publish anyway". Renders adjacent
// to the click target so the teacher doesn't have to hunt for the
// dialog after pressing Publish on a long-scrolled HW.
// ────────────────────────────────────────────────────────────────────
/** What the publish soft-confirm shows: the sentence, and which fixes
 *  to offer (graph checklists to review, a due date to add). */
export type PublishConfirm = {
  warning: string;
  /** Graph checklists unchecked or not written yet. */
  checklists: number;
  noDueDate: boolean;
};

export function ActionBar({
  isPublished,
  canPublish,
  missingForPublish,
  pointsSummary,
  busy,
  previewLoading,
  onPublish,
  onUnpublish,
  onPreviewAsStudent,
  confirming,
  onReviewChecklists,
  onAddDueDate,
  onConfirmPublish,
}: {
  isPublished: boolean;
  canPublish: boolean;
  missingForPublish: string[];
  /** "100 points · 7 problems, 14–15 each", for a homework; null else. */
  pointsSummary: string | null;
  busy: boolean;
  previewLoading: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onPreviewAsStudent: () => void;
  /** Set while the publish soft-confirm is showing. */
  confirming: PublishConfirm | null;
  onReviewChecklists: () => void;
  onAddDueDate: () => void;
  onConfirmPublish: () => void;
}) {
  return (
    <div
      // On a phone it sits on the teacher bottom nav (h-16), which would
      // otherwise cover it; on desktop it's flush and clears the safe area.
      className="fixed inset-x-0 bottom-16 z-40 border-t border-border-light bg-surface/95 px-4 pt-3 pb-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] backdrop-blur md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {confirming ? (
          <>
            <span className="min-w-0 flex-1 text-xs font-semibold text-[color:var(--color-warning-dark)] ">
              ⚠ {confirming.warning}
            </span>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {confirming.checklists > 0 && (
                <button
                  type="button"
                  onClick={onReviewChecklists}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-bold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
                >
                  Review {confirming.checklists === 1 ? "it" : "them"}
                </button>
              )}
              {confirming.noDueDate && (
                <button
                  type="button"
                  onClick={onAddDueDate}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-xs font-bold text-text-secondary hover:bg-[color:var(--color-surface-alt-2)] disabled:opacity-50"
                >
                  Add due date
                </button>
              )}
              <button
                type="button"
                onClick={onConfirmPublish}
                disabled={busy}
                className="rounded-[--radius-md] bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                Publish anyway
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1 text-[11px] text-text-muted">
              {!isPublished && missingForPublish.length > 0 ? (
                <span>Missing: {missingForPublish.join(", ")}</span>
              ) : (
                pointsSummary && (
                  <span className="text-text-secondary">
                    {pointsSummary}
                    {" · "}
                    <a href="#homework-points" className="font-semibold text-primary hover:underline">
                      Edit points
                    </a>
                  </span>
                )
              )}
            </div>
            {/* Same reason as the section-review action strip: allow a
                wrap on narrow screens instead of widening the page. */}
            <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:shrink-0">
              <button
                type="button"
                onClick={onPreviewAsStudent}
                disabled={busy || previewLoading}
                className="text-xs font-semibold text-text-secondary hover:text-primary disabled:opacity-50"
              >
                {previewLoading ? "Switching…" : "Preview as student →"}
              </button>
              {isPublished ? (
                <button
                  type="button"
                  onClick={onUnpublish}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-4 py-2 text-sm font-bold text-[color:var(--color-warning-dark)] hover:bg-[color:var(--color-warning-bg)] disabled:opacity-50  dark:bg-[color:var(--color-warning)]/10 "
                >
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={busy || !canPublish}
                  title={
                    canPublish
                      ? "Publish — locks the questions in the bank"
                      : `Missing: ${missingForPublish.join(", ")}`
                  }
                  className={`rounded-[--radius-md] px-5 py-2 text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
                    canPublish
                      ? "bg-green-600 hover:bg-green-700 hover:shadow"
                      : "cursor-not-allowed bg-gray-400 dark:bg-gray-600"
                  }`}
                >
                  Publish ▸
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
