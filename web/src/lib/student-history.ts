// How a student's history row reads a grade that isn't published yet,
// worded as the review page's own markers for the same states.

export type DraftState = "awaiting_review" | "graded_unpublished" | "partly_graded";

export const DRAFT_LABEL: Record<DraftState, string> = {
  awaiting_review: "Awaiting your review",
  graded_unpublished: "Graded, not published",
  partly_graded: "Partly graded",
};

/** The score shown beside the label, or null. A partly graded score is of
 *  some problems only, so it isn't shown. Never credited to the AI: an
 *  unapproved AI grade the teacher has edited is partly hers. */
export function draftScoreText(state: DraftState, score: number): string | null {
  return state === "partly_graded" ? null : `${Math.round(score)}%`;
}
