"""Late policy: when a homework closes, and what lateness costs.

`Assignment.late_policy` is one of:

- `none` — turn in any time, nothing taken off. Late work is still marked
  late so the teacher can see it.
- `penalty_per_day` — late work loses 10 percentage points of its score for
  every started 24 hours after the due date, up to all of it. 85% turned in
  25 hours late is 85 − 20 = 65%.
- `no_credit` — the homework closes at the due date: a turn-in after it is
  refused. Work that is late anyway (the due date moved after it came in) is
  worth nothing.

The due date that counts is the student's *effective* one (`effective_due_at`
and friends): the class due date. A homework with no due date is never late
and never closes.

The penalty is applied in exactly one place, `set_final_score`, which every
writer of `SubmissionGrade.final_score` goes through. `final_score` is the
score after the penalty — what the gradebook, averages, exports and the
student see — and `late_penalty` holds the points it took off, so the score
before it is always `final_score + late_penalty`. Publishing snapshots both.
The teacher can waive it per student (`late_penalty_waived`); the penalty
is a visible line on the review page she approves, never a silent cut.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from api.models.assignment import Assignment, Submission, SubmissionGrade

LATE_POLICY_NONE = "none"
LATE_POLICY_PENALTY_PER_DAY = "penalty_per_day"
LATE_POLICY_NO_CREDIT = "no_credit"
LatePolicy = Literal["none", "penalty_per_day", "no_credit"]

PENALTY_PER_DAY = 10.0
MAX_PENALTY = 100.0
_DAY = timedelta(hours=24)


# ── Effective due date ──


async def effective_due_at(
    db: AsyncSession, assignment: Assignment, student_id: uuid.UUID,
) -> datetime | None:
    """The due date that counts for this student on this homework."""
    return (await effective_due_dates(db, assignment, [student_id]))[student_id]


async def effective_due_dates(
    db: AsyncSession, assignment: Assignment, student_ids: Iterable[uuid.UUID],
) -> dict[uuid.UUID, datetime | None]:
    """`effective_due_at` for several students on one homework."""
    return dict.fromkeys(student_ids, assignment.due_at)


async def student_due_dates(
    db: AsyncSession, student_id: uuid.UUID, assignments: Iterable[Assignment],
) -> dict[uuid.UUID, datetime | None]:
    """`effective_due_at` for one student across several homeworks, keyed
    by assignment id."""
    return {a.id: a.due_at for a in assignments}


# ── The rule ──


def days_late(submitted_at: datetime, due_at: datetime | None) -> int:
    """Started 24-hour periods after the due date. Turned in at the due
    date exactly is on time; a minute after is one day late."""
    if due_at is None or submitted_at <= due_at:
        return 0
    return math.ceil((submitted_at - due_at) / _DAY)


def is_closed(policy: str, due_at: datetime | None, now: datetime) -> bool:
    """Is a `no_credit` homework past its due date, so turn-ins are refused?"""
    return policy == LATE_POLICY_NO_CREDIT and due_at is not None and now > due_at


def policy_penalty(policy: str, days: int) -> float:
    """Percentage points the policy takes off for `days` late, before any
    waiver or the floor at zero."""
    if days <= 0:
        return 0.0
    if policy == LATE_POLICY_PENALTY_PER_DAY:
        return min(PENALTY_PER_DAY * days, MAX_PENALTY)
    if policy == LATE_POLICY_NO_CREDIT:
        return MAX_PENALTY
    return 0.0


def submission_penalty(assignment: Assignment, sub: Submission, due_at: datetime | None) -> float:
    """The policy's penalty for this turn-in against its effective due
    date `due_at` — for a caller that has already looked that up."""
    return policy_penalty(assignment.late_policy, days_late(sub.submitted_at, due_at))


async def late_penalty_for(db: AsyncSession, assignment: Assignment, sub: Submission) -> float:
    """The policy's penalty for this turn-in, before any waiver."""
    return submission_penalty(assignment, sub, await effective_due_at(db, assignment, sub.student_id))


# What a student is told when a turn-in is refused. No date in it: the API
# has no time zone for the student, and a UTC date reads a day off for an
# evening deadline. The homework page shows the date in their own time zone.
HOMEWORK_CLOSED_DETAIL = (
    "This homework closed at its due date — ask your teacher to reopen it."
)


# ── Applying it ──


def set_final_score(grade: SubmissionGrade, raw: float | None, penalty: float) -> None:
    """Write `final_score` from the score the problems add up to (`raw`)
    and the policy's penalty for this turn-in. The one writer of
    `final_score` and `late_penalty`, so the two can never disagree."""
    if raw is None:
        grade.final_score = None
        grade.late_penalty = 0.0
        return
    applied = 0.0 if grade.late_penalty_waived else min(max(penalty, 0.0), max(raw, 0.0))
    grade.final_score = raw - applied
    grade.late_penalty = applied


def lateness_out(
    assignment: Assignment, sub: Submission, due_at: datetime | None, grade: SubmissionGrade | None,
) -> dict[str, Any]:
    """The lateness fields the teacher's review page shows for a turn-in:
    its effective due date, how late it was, what the policy takes off
    for that, what was actually taken off the live grade, and whether she
    waived it."""
    days = days_late(sub.submitted_at, due_at)
    return {
        "due_at": due_at,
        "days_late": days,
        "policy_late_penalty": policy_penalty(assignment.late_policy, days),
        "late_penalty": grade.late_penalty if grade else 0.0,
        "late_penalty_waived": bool(grade and grade.late_penalty_waived),
    }


def score_before_penalty(grade: SubmissionGrade) -> float | None:
    if grade.final_score is None:
        return None
    return grade.final_score + (grade.late_penalty or 0.0)


async def refresh_lateness(db: AsyncSession, assignment: Assignment) -> None:
    """Re-derive every submission's lateness on `assignment` after its due
    date or late policy changed: `is_late`, and the penalty on any grade.
    A score that moved gets a fresh `graded_at`; a published one reads as
    changed-since-publishing until the teacher republishes it."""
    subs = (await db.execute(
        select(Submission)
        .options(load_only(Submission.id, Submission.student_id, Submission.submitted_at, Submission.is_late))
        .where(Submission.assignment_id == assignment.id)
    )).scalars().all()
    if not subs:
        return
    grades = {
        g.submission_id: g for g in (await db.execute(
            select(SubmissionGrade)
            .where(SubmissionGrade.submission_id.in_([s.id for s in subs]))
            .with_for_update()
        )).scalars().all()
    }
    due = await effective_due_dates(db, assignment, {s.student_id for s in subs})
    now = datetime.now(UTC)
    for sub in subs:
        sub_due = due[sub.student_id]
        sub.is_late = days_late(sub.submitted_at, sub_due) > 0
        grade = grades.get(sub.id)
        if grade is None or grade.final_score is None:
            continue
        before = grade.final_score
        set_final_score(grade, score_before_penalty(grade), submission_penalty(assignment, sub, sub_due))
        if abs(grade.final_score - before) > 1e-6:
            grade.graded_at = now
