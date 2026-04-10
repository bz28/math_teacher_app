"use client";

// Banner displayed at the top of the approved view when there are
// pending items to review. Distinguishes between new questions
// (generated primaries) and variations (practice children) so the
// teacher knows the shape of work waiting.

export function ReviewBanner({
  newQuestionCount,
  variationCount,
  onReview,
}: {
  /** Pending items where source === "generated" and no parent. */
  newQuestionCount: number;
  /** Pending items where source === "practice" (has a parent). */
  variationCount: number;
  onReview: () => void;
}) {
  const total = newQuestionCount + variationCount;
  if (total === 0) return null;

  const parts: string[] = [];
  if (newQuestionCount > 0) {
    parts.push(
      `${newQuestionCount} new question${newQuestionCount === 1 ? "" : "s"}`,
    );
  }
  if (variationCount > 0) {
    parts.push(
      `${variationCount} variation${variationCount === 1 ? "" : "s"}`,
    );
  }
  const message = parts.join(" + ") + " need review";

  return (
    <div className="flex items-center justify-between gap-3 rounded-[--radius-lg] border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <span className="font-bold text-amber-900 dark:text-amber-200">
        &#9888;&#65039; {message}
      </span>
      <button
        type="button"
        onClick={onReview}
        className="shrink-0 rounded-[--radius-md] bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700"
      >
        Review now &#8594;
      </button>
    </div>
  );
}
