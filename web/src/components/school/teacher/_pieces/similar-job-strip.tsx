import type { BankJob } from "@/lib/api";

/**
 * Inline progress strip for an in-flight generate-similar job whose
 * parent is the current workshop question. Three states: working,
 * done (with Review CTA), failed.
 */
export function SimilarJobStrip({
  job,
  onReview,
}: {
  job: BankJob;
  onReview: () => void;
}) {
  if (job.status === "failed") {
    return (
      <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs font-semibold text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        ❌ Make similar failed: {job.error_message ?? "unknown error"}
      </div>
    );
  }
  if (job.status === "done") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-green-200 bg-green-50 px-6 py-2 text-xs font-semibold text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300">
        <span>
          ✨ {job.produced_count} new variation
          {job.produced_count === 1 ? "" : "s"} ready for review
        </span>
        <button
          type="button"
          onClick={onReview}
          className="rounded-[--radius-sm] bg-green-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-800"
        >
          Review them →
        </button>
      </div>
    );
  }
  // queued or running
  const progressText =
    job.produced_count > 0
      ? `Generating variations… ${job.produced_count}/${job.requested_count}`
      : `Generating ${job.requested_count} variations…`;
  return (
    <div className="border-b border-blue-200 bg-blue-50 px-6 py-2 text-xs font-semibold text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
      <span className="mr-2 inline-block animate-pulse">✨</span>
      {progressText}
    </div>
  );
}
