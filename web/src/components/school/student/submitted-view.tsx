"use client";

import type { StudentSubmission } from "@/lib/api";

interface Props {
  submission: StudentSubmission;
}

/**
 * Read-only view of a submitted homework. Renders the uploaded work
 * image (the only thing the student turns in v1) plus the submission
 * timestamp and late badge.
 *
 * The integrity-checker PR will add a per-problem section here for
 * the Vision-extracted answers + the understanding-check chat
 * results — that's why StudentSubmission.final_answers is still on
 * the API shape even though we don't render it yet.
 */
export function SubmittedView({ submission }: Props) {
  const submittedAt = new Date(submission.submitted_at);
  return (
    <div className="mt-8 rounded-[--radius-md] border border-green-500 bg-green-50 p-6 dark:bg-green-500/10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">✓ Submitted</h2>
        <div className="text-xs font-medium text-text-muted">
          {submittedAt.toLocaleString()}
          {submission.is_late && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
              LATE
            </span>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-semibold text-text-primary">Your work</div>
        {/* image_data is always a full data URL (data:image/<type>;base64,...)
            since the SubmissionPanel now keeps the prefix intact. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={submission.image_data ?? ""}
          alt="Your submitted homework"
          className="mt-2 max-h-[600px] w-full rounded-[--radius-sm] border border-border object-contain"
        />
      </div>
    </div>
  );
}
