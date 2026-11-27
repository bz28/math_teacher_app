"use client";

import Link from "next/link";
import { generatingLabel } from "@/lib/generation-progress";

// ────────────────────────────────────────────────────────────────────
// Empty hero — shown in the Problems section when there are no
// problems AND nothing is generating. Turns the dead-end into a clear
// next action.
// ────────────────────────────────────────────────────────────────────
export function ProblemsEmptyHero({
  disabled,
  onGenerate,
}: {
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-5 rounded-[--radius-xl] border border-border-light bg-[color:var(--color-surface-alt-2)]/50 px-8 py-12 text-center">
      <div className="text-5xl" aria-hidden="true">✨</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        Let&apos;s add some problems
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        Generate with AI in ~30 seconds, grounded in your uploaded materials.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        className="mt-5 inline-flex items-center gap-2 rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark hover:shadow disabled:opacity-50"
      >
        ✨ Generate problems
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Generating hero — shown in the Problems section while a gen job is
// in flight and zero problems have landed yet. Mirrors the empty-hero
// aesthetic so an in-flight gen reads as a deliberate "we're on it"
// state, not a stalled skeleton. Live count comes from the polled job.
// ────────────────────────────────────────────────────────────────────
export function ProblemsGeneratingHero({
  requestedCount,
  producedCount,
  reading,
}: {
  requestedCount: number;
  producedCount: number;
  reading: boolean;
}) {
  // role="status" announces text changes politely — drives the "X of Y
  // ready" subcopy update so screen-reader users hear progress.
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-5 rounded-[--radius-xl] border border-dashed border-primary/40 bg-primary-bg/20 px-8 py-12 text-center"
    >
      <div className="animate-pulse text-5xl" aria-hidden="true">✨</div>
      <h3 className="mt-4 text-lg font-bold text-text-primary">
        {generatingLabel(requestedCount, reading)}
      </h3>
      <p className="mt-1 text-xs text-text-muted">
        {producedCount > 0 && requestedCount > 0
          ? `${producedCount} of ${requestedCount} ready — they'll land in the review queue as the AI finishes each one.`
          : reading
            ? "The AI is copying each problem from your pages and working out its solution. They'll land in the review queue for you to approve."
            : "The AI is writing them from your unit and materials. Usually about 30 seconds."}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Generation-stalled banner — persistent surfacing of a failed gen job.
// A failed job (backend error or the poll-ceiling timeout) otherwise
// drops out of the "generating" set, so the progress strip just
// disappears and a zero-produced run falls through to the empty hero
// as if nothing happened. This banner keeps the failure visible with a
// one-click re-fire (reuses the existing Generate-more trigger — no new
// backend retry semantics) and reassures that anything the job DID
// produce is safe in the pending-review queue.
// ────────────────────────────────────────────────────────────────────
export function GenerationStalledBanner({
  shortfall,
  savedCount,
  disabled,
  onRetry,
}: {
  shortfall: number;
  savedCount: number;
  disabled: boolean;
  onRetry: () => void;
}) {
  const noun = shortfall === 1 ? "problem" : "problems";
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-4 flex flex-col gap-3 rounded-[--radius-xl] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none" aria-hidden="true">⚠️</span>
        <div>
          <p className="text-sm font-bold text-[color:var(--color-error)]">
            {`Generation stalled — ${shortfall} ${noun} didn’t come through`}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {savedCount > 0
              ? `Anything already produced is safe in Pending review below — nothing was lost. Try again to finish the set.`
              : `Nothing came through this time. Try again — anything produced lands safely in Pending review.`}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        title={disabled ? "Unpublish to generate more" : "Re-run generation"}
        className="shrink-0 self-start rounded-[--radius-md] bg-[color:var(--color-error)] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50 sm:self-auto"
      >
        Try again
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pending review is the primary CTA when generation produced
// anything. Solid amber-tinted card (no gradient — washes out the
// text) with high-contrast copy.
// ────────────────────────────────────────────────────────────────────
export function PendingReviewLink({ count, href }: { count: number; href: string }) {
  return (
    <Link
      href={href}
      className="mt-4 flex items-center justify-between gap-3 rounded-[--radius-xl] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-5 py-4 shadow-sm transition-all hover:border-[color:var(--color-warning)]/50 hover:bg-[color:var(--color-warning-bg)] hover:shadow  dark:bg-[color:var(--color-warning)]/10 dark:hover:bg-[color:var(--color-warning)]/20"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">🔔</span>
        <div>
          <p className="text-sm font-bold text-text-primary">
            {count} {count === 1 ? "problem" : "problems"} {count === 1 ? "needs" : "need"} your review
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Approve to add them to this homework, reject to drop them.
          </p>
        </div>
      </div>
      <span className="shrink-0 rounded-[--radius-md] bg-[color:var(--color-warning-dark)] px-4 py-2 text-xs font-bold text-white">
        Review ▸
      </span>
    </Link>
  );
}
