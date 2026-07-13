import type { TeacherAssignment } from "@/lib/api";

export interface BucketedHomeworks {
  needsGrading: TeacherAssignment[];
  dueThisWeek: TeacherAssignment[];
  upcoming: TeacherAssignment[];
  completed: TeacherAssignment[];
}

/**
 * Sorts published homeworks into the four timeline buckets. Pure — pass
 * `now` in tests; production calls default to `Date.now()`.
 *
 * "Completed" means the teacher is *done*: the whole class submitted and
 * every one of those grades is PUBLISHED to students. Because AI grading
 * auto-sets `final_score` on submit, `graded` tracks `submitted` almost
 * immediately, so it is NOT a "done" signal — `published`
 * (grade_published_at, set by "Publish grades") is. A past-due HW whose
 * grades aren't all published still owes the teacher review/publish work,
 * so it lands in NEEDS GRADING (where the review card surfaces it), not
 * COMPLETED. Active (not-past-due) homeworks route purely by due date —
 * students are still working, so we never nag "needs grading" early.
 */
/**
 * A homework is "Completed" only once it's past due, the whole class has
 * submitted, and every one of those grades is PUBLISHED to students
 * (`published`, set by "Publish grades" — not `graded`, which AI grading
 * sets on submit). Single source of truth shared by the timeline
 * bucketing and the "Completed" status filter so the two can't drift.
 */
export function isHomeworkCompleted(
  hw: TeacherAssignment,
  now: number = Date.now(),
): boolean {
  if (hw.status !== "published" || !hw.due_at) return false;
  const isPastDue = new Date(hw.due_at).getTime() < now;
  return (
    isPastDue &&
    hw.submitted > 0 &&
    hw.published === hw.submitted &&
    hw.submitted >= hw.total_students
  );
}

export function bucketHomeworks(
  homeworks: TeacherAssignment[],
  now: number = Date.now(),
): BucketedHomeworks {
  const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;

  const needsGrading: TeacherAssignment[] = [];
  const dueThisWeek: TeacherAssignment[] = [];
  const upcoming: TeacherAssignment[] = [];
  const completed: TeacherAssignment[] = [];

  for (const hw of homeworks) {
    if (hw.status !== "published") {
      // Drafts always go to upcoming
      upcoming.push(hw);
      continue;
    }

    const dueTime = hw.due_at ? new Date(hw.due_at).getTime() : null;
    const isPastDue = dueTime !== null && dueTime < now;

    if (isPastDue) {
      // Completed: whole class submitted AND every submitted grade is
      // published. `published` (not `graded`) is the real "done" signal.
      if (isHomeworkCompleted(hw, now)) {
        completed.push(hw);
        continue;
      }

      // Any other past-due HW still owes the teacher work: grades not yet
      // published (to-review / ready-to-publish) or overdue with missing
      // submissions — i.e. `submitted > published || submitted <
      // total_students`. Route it to the review card.
      needsGrading.push(hw);
      continue;
    }

    // Not past due yet — students are still working, so never nag "needs
    // grading" over unpublished grades. Route by due date only.
    // Due this week: due within 7 days.
    if (dueTime !== null && dueTime <= weekFromNow) {
      dueThisWeek.push(hw);
      continue;
    }

    // Everything else → upcoming (due > 7 days, or no due date)
    upcoming.push(hw);
  }

  // Sort within buckets
  needsGrading.sort(sortByDueAsc);
  dueThisWeek.sort(sortByDueAsc);
  upcoming.sort(sortUpcoming);
  completed.sort(sortByDueDesc);

  return { needsGrading, dueThisWeek, upcoming, completed };
}

function sortByDueAsc(a: TeacherAssignment, b: TeacherAssignment): number {
  if (a.due_at && b.due_at) {
    const diff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    if (diff !== 0) return diff;
  } else if (a.due_at) {
    return -1;
  } else if (b.due_at) {
    return 1;
  }
  return a.title.localeCompare(b.title);
}

function sortByDueDesc(a: TeacherAssignment, b: TeacherAssignment): number {
  if (a.due_at && b.due_at) {
    const diff = new Date(b.due_at).getTime() - new Date(a.due_at).getTime();
    if (diff !== 0) return diff;
  } else if (a.due_at) {
    return 1;
  } else if (b.due_at) {
    return -1;
  }
  return a.title.localeCompare(b.title);
}

/** Drafts first, then by due date ascending. */
function sortUpcoming(a: TeacherAssignment, b: TeacherAssignment): number {
  const aDraft = a.status !== "published" ? 0 : 1;
  const bDraft = b.status !== "published" ? 0 : 1;
  if (aDraft !== bDraft) return aDraft - bDraft;
  return sortByDueAsc(a, b);
}
