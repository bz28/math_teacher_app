"""Changing a homework's due dates: one date for every section, or a date
per section, on a draft or a published homework.

Lateness follows the date (late_policy): every turn-in already in is
re-derived — `is_late`, and the penalty on its grade. A published grade
whose score moves is never changed under the student: the student keeps
seeing the published snapshot (`published_final_score`), and the live
score reads as changed-since-publishing (`graded_at` after
`grade_published_at`) until the teacher republishes. Queued AI grading
moves to each student's new date.

`apply_due_dates` reports what the change does to work already in, so the
edit dialog can say it before the teacher confirms (dry run) and the
saved edit can say it after.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.late_policy import refresh_lateness
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.section import Section


@dataclass
class DueDateChange:
    """What a due-date edit does to work already turned in."""

    lateness_changed: int  # turn-ins that become late, or stop being late
    grades_changed: int  # graded turn-ins whose score moves with the penalty
    published_grades_changed: int  # of those, published: the teacher republishes


async def _snapshot(
    db: AsyncSession, assignment_id: uuid.UUID,
) -> dict[uuid.UUID, tuple[bool, float | None, bool]]:
    """submission → (is_late, final_score, grade published)."""
    rows = (await db.execute(
        select(
            Submission.id, Submission.is_late,
            SubmissionGrade.final_score, SubmissionGrade.grade_published_at,
        )
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(Submission.assignment_id == assignment_id)
    )).all()
    return {sid: (bool(late), score, published is not None) for sid, late, score, published in rows}


async def apply_due_dates(
    db: AsyncSession,
    assignment: Assignment,
    *,
    due_at: datetime | None = None,
    set_due: bool = False,
    section_due: dict[uuid.UUID, datetime] | None = None,
) -> DueDateChange:
    """Set the homework's date (`set_due`; every section follows it, None
    clears it) and/or individual sections' dates, then re-derive lateness
    and re-point queued grading. Flushes; the caller commits (or rolls
    back, for a preview)."""
    before = await _snapshot(db, assignment.id)

    if set_due:
        assignment.due_at = due_at
        await db.execute(
            update(AssignmentSection)
            .where(AssignmentSection.assignment_id == assignment.id)
            .values(due_at=due_at)
        )
    if section_due:
        if assignment.due_at is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Set the homework's due date before a date per section",
            )
        rows = {r.section_id: r for r in (await db.execute(
            select(AssignmentSection).where(
                AssignmentSection.assignment_id == assignment.id,
                AssignmentSection.section_id.in_(list(section_due)),
            )
        )).scalars().all()}
        if set(rows) != set(section_due):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="That section isn't on this homework",
            )
        for section_id, at in section_due.items():
            rows[section_id].due_at = at
    await db.flush()

    from api.core.grading_queue import reschedule_assignment

    await reschedule_assignment(db, assignment)
    await refresh_lateness(db, assignment)
    await db.flush()

    after = await _snapshot(db, assignment.id)
    lateness = grades = published = 0
    for sid, (late, score, was_published) in before.items():
        new_late, new_score, _ = after.get(sid, (late, score, was_published))
        if new_late != late:
            lateness += 1
        if score is not None and new_score is not None and abs(new_score - score) > 1e-6:
            grades += 1
            if was_published:
                published += 1
    return DueDateChange(lateness, grades, published)


async def section_due_dates(db: AsyncSession, a: Assignment) -> list[dict[str, Any]]:
    """Each of the homework's sections with its date (the homework's when
    the row has none), in section-name order."""
    rows = (await db.execute(
        select(Section.id, Section.name, AssignmentSection.due_at)
        .join(Section, Section.id == AssignmentSection.section_id)
        .where(AssignmentSection.assignment_id == a.id)
        .order_by(Section.name)
    )).all()
    return [
        {"section_id": sid, "name": name, "due_at": (at or a.due_at) if a.due_at else None}
        for sid, name, at in rows
    ]
