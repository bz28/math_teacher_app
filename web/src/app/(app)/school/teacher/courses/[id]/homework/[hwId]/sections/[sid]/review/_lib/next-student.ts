// Which student the review page moves to next. Pure functions over the
// loaded roster, kept free of path aliases so the unit test runs on
// plain Node (next-student.test.ts).
import type { RosterEntry } from "./types";

export function needsTeacher(entry: RosterEntry): boolean {
  const sub = entry.submission;
  if (!sub) return false;
  // Settled state is a published-and-clean grade. Everything else —
  // ungraded, graded-but-not-published, dirty, integrity-flagged — is
  // work that wants the teacher's attention.
  if (sub.grade_published_at !== null && !sub.grade_dirty) return false;
  return true;
}

/** Still waiting on her Approve: needs her, and not yet approved. An
 *  approved grade waiting only to be published doesn't — publishing is
 *  a separate, homework-wide step. Her own preview turn-in never does. */
export function awaitsApproval(entry: RosterEntry): boolean {
  return (
    needsTeacher(entry) &&
    !entry.submission?.reviewed_at &&
    !entry.submission?.is_preview
  );
}

/** The first roster entry after `currentId` that `matches`, wrapping to
 *  the start, so a teacher working out of order still moves on. Null
 *  when no other entry matches. */
export function nextMatching(
  roster: RosterEntry[],
  currentId: string,
  matches: (entry: RosterEntry) => boolean,
): RosterEntry | null {
  const idx = roster.findIndex((e) => e.student_id === currentId);
  if (idx < 0) return null;
  for (let i = 1; i < roster.length; i++) {
    const cand = roster[(idx + i) % roster.length];
    if (matches(cand)) return cand;
  }
  return null;
}

/** Whether a press of A approves. Only a fresh press, and only when the
 *  Approve button itself would: a held A auto-repeats, and once Approve &
 *  next opened the next student, a repeat would approve them unseen. */
export function approvesOnKey(
  e: { repeat: boolean },
  canApprove: boolean,
): boolean {
  return canApprove && !e.repeat;
}
