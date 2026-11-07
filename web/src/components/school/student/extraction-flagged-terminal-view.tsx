"use client";

import { ImageIcon } from "@/components/ui/icons";

/**
 * Terminal screen shown after the student flagged the extraction as
 * wrong. No AI grading or integrity chat ran — the submission is
 * already in the teacher's inbox for manual grading, with the student's
 * note and any lines they fixed.
 *
 * `detailsDropped`: this session's flag carried a note or fixes that
 * weren't saved, because the homework had already been sent (another
 * tab, a double tap) or had moved on. Say so rather than claim they
 * went along.
 *
 * `onRetake`: set while the student can still replace their photos for
 * a fresh reading (flagged, nothing graded, not yet retaken — the
 * server's `can_retake`). Offered quietly, below the "you're done"
 * message: most flags need nothing more, but a sideways, blurry or
 * incomplete set of photos is better fixed by the student now than
 * graded from by the teacher later.
 */
export function ExtractionFlaggedTerminalView({
  detailsDropped = false,
  onRetake,
}: {
  detailsDropped?: boolean;
  onRetake?: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="mx-auto mb-4 text-4xl" aria-hidden>
        ✉️
      </div>
      <h1 className="text-2xl font-bold text-text-primary">
        Sent to your teacher
      </h1>
      {detailsDropped ? (
        <p className="mt-3 text-sm text-text-secondary">
          This homework was already sent to your teacher, so what you just
          added wasn&rsquo;t saved. If there&rsquo;s more they should know,
          tell them directly.
        </p>
      ) : (
        <p className="mt-3 text-sm text-text-secondary">
          You said we misread your work, so your teacher will grade it from
          your photos. Anything you told us or fixed went along too.
        </p>
      )}
      <p className="mt-4 text-xs text-text-muted">
        Nothing else to do — your teacher will follow up with a grade
        when they&rsquo;ve reviewed it.
      </p>

      {onRetake && (
        <div className="mx-auto mt-10 max-w-md border-t border-border-light pt-8">
          <p className="font-serif text-xl leading-snug text-text-primary">
            Were your photos the problem?
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
            If a page was sideways, blurry or missing, take new photos and
            we&rsquo;ll read them again. Your teacher still sees your first
            ones.
          </p>
          <button
            type="button"
            onClick={onRetake}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[--radius-sm] border border-primary/40 bg-surface px-5 text-sm font-bold text-primary transition-colors hover:border-primary hover:bg-primary-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <ImageIcon className="h-4 w-4" />
            Retake photos
          </button>
        </div>
      )}
    </div>
  );
}
