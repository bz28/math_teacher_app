"use client";

import type { StudentHomeworkProblem, StudentSubmission } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";

interface Props {
  submission: StudentSubmission;
  problems: StudentHomeworkProblem[];
}

/**
 * Read-only view of a submitted homework. Renders below the locked
 * problem cards. Shows the uploaded image, the per-problem typed
 * answers, and the submission timestamp + late badge if applicable.
 */
export function SubmittedView({ submission, problems }: Props) {
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

      {Object.keys(submission.final_answers).length > 0 && (
        <div className="mt-5">
          <div className="text-sm font-semibold text-text-primary">Your final answers</div>
          <ul className="mt-2 space-y-2">
            {problems.map((p) => {
              const ans = submission.final_answers[p.bank_item_id];
              if (!ans) return null;
              return (
                <li key={p.bank_item_id} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                    {p.position}
                  </span>
                  <span className="text-text-secondary">
                    <MathText text={ans} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {submission.image_data && (
        <div className="mt-5">
          <div className="text-sm font-semibold text-text-primary">Your work</div>
          {/* The backend stores raw base64 (no data: prefix). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              submission.image_data.startsWith("data:")
                ? submission.image_data
                : `data:image/png;base64,${submission.image_data}`
            }
            alt="Your submitted homework"
            className="mt-2 max-h-[600px] w-full rounded-[--radius-sm] border border-border object-contain"
          />
        </div>
      )}

      {!submission.image_data && Object.keys(submission.final_answers).length === 0 && (
        <p className="mt-4 text-sm text-text-muted">No content was submitted.</p>
      )}
    </div>
  );
}
