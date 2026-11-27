import type { SubmissionsInboxRow } from "@/lib/api";

/** A Submissions-tab row's button. It escalates with what's pending:
 *  flags first, ungraded next, then plain Review. Flags are counted
 *  whole and kind-neutral: the pills beside it say which kinds, and a
 *  short label keeps the row readable on a phone. */
export function inboxCta(
  row: Pick<SubmissionsInboxRow, "submitted" | "published" | "dirty" | "flagged">,
): string {
  const toReview = row.submitted - row.published + row.dirty;
  if (row.flagged > 0) return `Review ${row.flagged} →`;
  if (toReview > 0) return `Grade ${toReview} →`;
  if (row.dirty > 0) return "Republish →";
  return "Review →";
}

/** The "Grade next" bar's reason for a flagged row: whole and short,
 *  like the button, so on a phone the truncated line still reaches the
 *  homework's title (the pills on its row say the kinds). */
export function gradeNextFlagReason(flagged: number): string {
  return `${flagged} to look at`;
}
