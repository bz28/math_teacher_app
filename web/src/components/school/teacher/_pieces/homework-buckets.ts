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
 * "Completed" means the teacher is *done*: every grade that was turned in
 * is PUBLISHED to students (students who never turned it in don't hold it
 * open). Because AI grading
 * auto-sets `final_score` on submit, `graded` tracks `submitted` almost
 * immediately, so it is NOT a "done" signal — `published`
 * (grade_published_at, set by "Publish grades") is. A past-due HW whose
 * grades aren't all published still owes the teacher review/publish work,
 * so it lands in NEEDS GRADING (where the review card surfaces it), not
 * COMPLETED. Active (not-past-due) homeworks route purely by due date —
 * students are still working, so we never nag "needs grading" early.
 */
/** Every grade that was turned in is out to students as it stands:
 *  published, and none edited since (a republish is still owed). */
function allGradesOut(hw: TeacherAssignment): boolean {
  return hw.published === hw.submitted && hw.republish === 0;
}

/**
 * A homework is "Completed" once it's past due and the teacher owes it
 * nothing: every grade that was turned in is published and unedited
 * since. Students who never turned it in don't keep it open — that isn't
 * grading she can do; the row says "N missing" instead. Single source of
 * truth shared by the timeline bucketing and the "Completed" status
 * filter so the two can't drift.
 */
export function isHomeworkCompleted(
  hw: TeacherAssignment,
  now: number = Date.now(),
): boolean {
  if (hw.status !== "published" || !hw.due_at) return false;
  return new Date(hw.due_at).getTime() < now && allGradesOut(hw);
}

/**
 * How many students are missing a past-due homework: never turned it in,
 * and not inside an extension of their own (`extended`). 0 before the
 * due date.
 */
export function missingCount(
  hw: TeacherAssignment,
  now: number = Date.now(),
): number {
  if (hw.status !== "published" || !hw.due_at) return 0;
  if (new Date(hw.due_at).getTime() >= now) return 0;
  return Math.max(0, hw.total_students - hw.submitted - hw.extended);
}

/**
 * How many published grades a Needs-grading homework owes only a
 * republish for — every turned-in grade is out, some edited since. The
 * students already have a grade, so the card reads as a calm amber
 * "N to republish", not a red overdue alarm. 0 when any grade is still
 * unreleased, ungraded or unreviewed — that is real overdue grading
 * work. (A published grade can lose its score or its review stamp and
 * stay "published": clearing it, a forced AI regrade, a partial hand
 * grade. Those are counted in `republish` too, so `published` alone
 * can't tell.)
 */
export function republishOnlyCount(hw: TeacherAssignment): number {
  const allOutAndReviewed =
    hw.published === hw.submitted && hw.graded === hw.submitted && hw.to_review === 0;
  return allOutAndReviewed ? hw.republish : 0;
}

/** What a Needs-grading card leads with: red (border, and "N days
 *  overdue" once a full day has passed) for grading or review owed past
 *  due; calm amber "N to republish" when only edits wait on a republish. */
export type NeedsGradingAlert =
  | { tone: "red"; overdueDays: number }
  | { tone: "amber"; republish: number };

export function needsGradingAlert(
  hw: TeacherAssignment,
  now: number = Date.now(),
): NeedsGradingAlert {
  const republish = republishOnlyCount(hw);
  if (republish > 0) return { tone: "amber", republish };
  const due = hw.due_at ? new Date(hw.due_at).getTime() : null;
  const overdueDays = due !== null && now > due ? Math.floor((now - due) / 86_400_000) : 0;
  return { tone: "red", overdueDays };
}

/**
 * Students on a Completed homework still inside their own extended due
 * date — shown as "N extended" so its jump back to Needs grading when
 * one turns in isn't a surprise. 0 before the class due date (nobody is
 * "extended" yet) or for a draft.
 */
export function extendedCount(
  hw: TeacherAssignment,
  now: number = Date.now(),
): number {
  if (hw.status !== "published" || !hw.due_at) return 0;
  return new Date(hw.due_at).getTime() < now ? hw.extended : 0;
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
      // Completed: every turned-in grade is published and unedited since.
      // `published` (not `graded`) is the real "done" signal.
      if (isHomeworkCompleted(hw, now)) {
        completed.push(hw);
        continue;
      }

      // Any other past-due HW still owes the teacher work: grades not yet
      // published (to-review / ready-to-publish), or published and edited
      // since (a republish). Route it to the review card.
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
