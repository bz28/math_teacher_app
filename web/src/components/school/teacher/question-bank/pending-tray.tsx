"use client";

// Prominent banner that surfaces the count of pending questions and
// gives the teacher a one-click entry into review mode. Renders only
// when there's something to review. Replaces the old "Review pending"
// header button + the post-generation "Review now" link by being
// always visible (when relevant) regardless of which status tab the
// teacher is on.
export function PendingTray({
  pendingCount,
  onReview,
}: {
  pendingCount: number;
  onReview: () => void;
}) {
  if (pendingCount === 0) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-lg] border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="min-w-0">
        <div className="font-bold text-amber-900 dark:text-amber-200">
          ⚡ {pendingCount} question{pendingCount === 1 ? "" : "s"} waiting for review
        </div>
        <div className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
          Review and assign to a homework to make them available to students.
        </div>
      </div>
      <button
        type="button"
        onClick={onReview}
        className="shrink-0 rounded-[--radius-md] bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700"
      >
        Review now →
      </button>
    </div>
  );
}
