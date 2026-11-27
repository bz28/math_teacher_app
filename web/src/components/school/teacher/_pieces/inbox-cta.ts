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
