"use client";

import { FigureDisplay } from "@/components/shared/figure-display";
import { MathText } from "@/components/shared/math-text";

/** Where a practice set's versions came from, looked up by the review
 *  page so the workshop can show each version beside its original. */
export interface PracticeOrigin {
  setTitle: string;
  /** A published set shows an approved version to students at once. */
  setPublished: boolean;
  homeworkTitle: string;
  homeworkHref: string;
  /** The homework's problems, keyed by bank item id. */
  problems: Record<string, OriginalProblem>;
}

export interface OriginalProblem {
  position: number;
  question: string;
  figure_svg: string | null;
}

/**
 * Banner over a practice version in the workshop. It says which
 * homework problem this is a version of, shows that original so the
 * teacher can compare without leaving the queue, and says plainly
 * what approving does. Every version still needs its own Approve.
 *
 * Without an origin (a version opened from the question bank, or one
 * whose original has since left the homework) it falls back to saying
 * what kind of item this is.
 */
export function PracticeVersionBanner({
  parentId,
  origin,
}: {
  parentId: string;
  origin?: PracticeOrigin;
}) {
  const original = origin?.problems[parentId];

  if (!origin || !original) {
    return (
      <div className="mb-4 rounded-[--radius-md] border border-border-light bg-bg-subtle px-4 py-3 text-[13px] leading-snug text-text-secondary">
        <span className="font-semibold text-text-primary">Practice version.</span>{" "}
        Approving makes it extra practice on its original problem. It
        isn&apos;t added to a homework.
      </div>
    );
  }

  return (
    <div className="mb-4 overflow-hidden rounded-[--radius-md] border border-border-light bg-bg-subtle">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3">
        <p className="text-sm font-semibold text-text-primary">
          Practice version of #{original.position} in {origin.homeworkTitle}
        </p>
        <a
          href={origin.homeworkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Open the homework →
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <p className="px-4 pt-0.5 text-[13px] leading-snug text-text-secondary">
        {origin.setPublished
          ? `Approving adds it to ${origin.setTitle}, which is published, so students can practice it right away.`
          : `Approving adds it to ${origin.setTitle}. Students see it only after you publish the set.`}
      </p>
      <div className="mx-4 mb-3 mt-2.5 rounded-[--radius-sm] border-l-2 border-border bg-surface px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
          Original &middot; homework #{original.position}
        </p>
        {original.figure_svg && (
          <FigureDisplay svg={original.figure_svg} className="mt-1.5 max-h-32" />
        )}
        <div className="mt-1 text-[13px] leading-relaxed text-text-secondary">
          <MathText text={original.question} />
        </div>
      </div>
    </div>
  );
}
