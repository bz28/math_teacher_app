"use client";

import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────
// Completion screen (queue mode only)
// ─────────────────────────────────────────────────────────────────────

export function CompletionModal({
  counts,
  total,
  onClose,
  renderAsPage = false,
  next,
}: {
  counts: { approved: number; rejected: number; skipped: number };
  total: number;
  onClose: () => void;
  renderAsPage?: boolean;
  /** What the caller offers next (e.g. publishing the homework the
   *  queue fed), shown above the way back. */
  next?: ReactNode;
}) {
  const card = (
    <div
      className={
        renderAsPage
          ? "w-full rounded-[--radius-xl] border border-green-200 bg-green-50 p-10 text-center shadow-sm dark:border-green-500/30 dark:bg-green-500/10"
          : "w-full max-w-md rounded-[--radius-xl] bg-surface p-8 text-center shadow-xl"
      }
      onClick={renderAsPage ? undefined : (e) => e.stopPropagation()}
    >
      <div className="text-5xl">🎉</div>
      <h2 className="mt-3 text-lg font-bold text-text-primary">All caught up</h2>
      <p className="mt-1 text-sm text-text-muted">
        You reviewed {total} question{total === 1 ? "" : "s"}
      </p>
      <div className="mt-4 flex justify-center gap-4 text-sm">
        <span className="font-semibold text-green-700 ">
          ✓ {counts.approved} approved
        </span>
        <span className="font-semibold text-red-700 dark:text-red-400">
          ✕ {counts.rejected} rejected
        </span>
        {counts.skipped > 0 && (
          <span className="font-semibold text-text-muted">⏭ {counts.skipped} skipped</span>
        )}
      </div>
      {next}
      <button
        onClick={onClose}
        // With a next step offered, that's the primary action and the
        // way back steps down to a quiet link.
        className={
          next
            ? "mt-4 text-sm font-semibold text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
            : "mt-6 rounded-[--radius-md] bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-primary-dark"
        }
      >
        {renderAsPage ? "Back to homework" : "Done"}
      </button>
    </div>
  );

  if (renderAsPage) {
    return <div className="mx-auto max-w-2xl px-4 pb-10 pt-8">{card}</div>;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      {card}
    </div>
  );
}
