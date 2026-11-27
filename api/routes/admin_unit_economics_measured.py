"""The usage rates the margin simulator defaults to — measured, not typed.

A simulator seeded with a guess ("8 homeworks a month") prices a school
at six times what it actually uses. Every default it shows comes from
here, read over the same window and school scope as the unit costs:

  submissions per student per month   by assignment type
  students per teacher                rostered users in scope

"Per student" means per student who handed something in during the
window. Enrolled-but-silent students do not cost anything, and counting
them would dilute the rate a district's active classes actually run at.
"""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import Assignment, Submission
from api.models.user import User
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL, Window

_DAYS_PER_MONTH = 30.0
SUBMISSION_KINDS = ("homework", "quiz", "test", "practice")

# A per-month rate extrapolated from a window far shorter than a month is
# arithmetic, not measurement: five homeworks in the hour after a model
# switch read as 720 a month. Rates off a shorter window are returned
# but flagged, and the dashboard won't seed a default from them. The
# residual per-user rates share the threshold.
MIN_RATE_DAYS = 7.0


def _user_scope(school_id: str | None, exclude_internal: bool) -> list[Any]:
    """Which users count, by the same rule the call scope uses."""
    if school_id == INTERNAL_SCHOOL_SENTINEL:
        return [User.school_id.is_(None)]
    if school_id:
        return [User.school_id == school_id]
    if exclude_internal:
        return [User.school_id.isnot(None)]
    return []


async def measured_rates(
    db: AsyncSession, window: Window, school_id: str | None, exclude_internal: bool,
) -> dict[str, Any]:
    users = _user_scope(school_id, exclude_internal)
    days = (window.end - window.start).total_seconds() / 86400.0
    months = days / _DAYS_PER_MONTH

    handed_in = (
        select(Submission.id, Submission.student_id, Assignment.type)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(User, User.id == Submission.student_id)
        .where(window.covers(Submission.submitted_at), *users)
        .subquery()
    )
    by_kind = {
        r.type: int(r.n)
        for r in (
            await db.execute(
                select(handed_in.c.type, func.count().label("n"))
                .group_by(handed_in.c.type),
            )
        ).all()
    }
    active = (
        await db.execute(select(func.count(func.distinct(handed_in.c.student_id))))
    ).scalar() or 0

    def per_student_month(kind: str) -> float | None:
        if not active or months <= 0:
            return None
        return by_kind.get(kind, 0) / active / months

    roles = {
        r.role: int(r.n)
        for r in (
            await db.execute(
                select(User.role, func.count().label("n"))
                .where(User.role.in_(("teacher", "student")), *users)
                .group_by(User.role),
            )
        ).all()
    }
    teachers = roles.get("teacher", 0)
    students = roles.get("student", 0)
    return {
        "window_too_short": days < MIN_RATE_DAYS,
        "active_students": int(active),
        "submissions": {k: by_kind.get(k, 0) for k in SUBMISSION_KINDS},
        "submissions_per_student_month": {
            k: per_student_month(k) for k in SUBMISSION_KINDS
        },
        "teachers": teachers,
        "students": students,
        # Divides every teacher-side cost.
        "students_per_teacher": (students / teachers) if teachers else None,
    }
