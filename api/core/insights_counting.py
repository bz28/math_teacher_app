"""Which grades count toward Student Insights, and what counts as a struggle.

Shared by the Insights read (`api.routes.teacher_insights`) and the reasons
writer (`api.core.reteach_reasons`), so the problem a teacher sees flagged
and the problem whose reasons get written are decided by the same rule.

Which grades count is the load-bearing part (`counted_breakdown`): the
teacher sees and approves every AI grade, so an AI draft never counts.
"""

from collections.abc import Iterable
from typing import Any

SCORE_STATUSES = ("full", "partial", "zero")

# Reteach rule. A problem is flagged when at least half the counted
# grades fell short of full credit, once enough are counted to mean
# something. Struggle shows up as partial credit: on real homework the
# worst problem had only 6–21% of students under half marks, so the old
# "more than half scored under 50%" rule flagged 1 of 186 problems.
FLAG_MIN_COUNTED = 5


def counted_breakdown(grade: Any) -> list[dict[str, Any]] | None:
    """The per-problem grades that count toward insights, or None.

    - Approved (`reviewed_at` set; hand grades self-approve) → the live
      breakdown. Edits after approval keep the approval, by design.
    - Otherwise published (`grade_published_at` set) → the snapshot the
      student was shown, never the live column: a forced AI regrade
      clears `reviewed_at` but keeps the publish stamp, leaving an unseen
      AI draft in `breakdown`.
    - Otherwise → not counted. An unapproved AI draft never counts.

    `grade` is anything carrying the SubmissionGrade columns (the model,
    or a column row from a query). An empty list is the "un-graded"
    signal (a retracted grade), so it counts as nothing — as does a
    breakdown with no well-formed entries.
    """
    if grade is None:
        return None
    if grade.reviewed_at is not None:
        rows = grade.breakdown
    elif grade.grade_published_at is not None:
        rows = grade.published_breakdown
    else:
        return None
    if not isinstance(rows, list) or not rows:
        return None
    valid = [e for e in rows if isinstance(e, dict) and e.get("score_status") in SCORE_STATUSES]
    return valid or None


def missed_full_credit(entry: dict[str, Any]) -> bool:
    """Short of full credit. Every grade writes `percent` (auto for full
    and zero, required for partial); fall back on the status if it's
    missing."""
    pct = entry.get("percent")
    if isinstance(pct, int | float) and not isinstance(pct, bool):
        return pct < 100
    return bool(entry["score_status"] != "full")


def is_flagged(counted: int, missed: int) -> bool:
    return counted >= FLAG_MIN_COUNTED and missed * 2 >= counted


def tally(problem_ids: Iterable[str], breakdowns: Iterable[list[dict[str, Any]] | None]) -> dict[str, list[int]]:
    """`[counted, missed]` per problem, from each student's counted
    breakdown. Entries join to problems on `problem_id` (= bank_item_id),
    never list position — grading and hydration can drop or reorder; an
    entry for a problem no longer on the homework is ignored."""
    out: dict[str, list[int]] = {pid: [0, 0] for pid in problem_ids}
    for counted in breakdowns:
        for e in counted or ():
            t = out.get(str(e.get("problem_id")))
            if t is not None:
                t[0] += 1
                t[1] += missed_full_credit(e)
    return out
