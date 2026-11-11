"""Keeping a turn-in when a newer one replaces it.

A submission is one row per student per homework, and the row is always
the latest turn-in. Two things replace it: a retake of photos the student
flagged (before anything was graded), and a turn-in after the teacher
reopened the homework for that student (`Submission.reopened_at`). Either
way the turn-in it replaces is kept whole as a `SubmissionAttempt` —
nothing a student wrote or a teacher graded is ever lost.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy import Table, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import Submission, SubmissionAttempt, SubmissionGrade
from api.models.grading_job import GradingJob
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)


async def _rows(db: AsyncSession, table: Any, where: Any) -> list[dict[str, Any]]:
    """Every column of the matching rows, JSON-ready (ids and dates as
    strings). Read through the table, so deferred columns come too."""
    t: Table = table.__table__
    result = await db.execute(select(t).where(where))
    return [jsonable_encoder(dict(r)) for r in result.mappings().all()]


async def archive_attempt(
    db: AsyncSession,
    sub: Submission,
    *,
    reason: str,
    replaced_at: datetime,
    reopened_by: uuid.UUID | None = None,
    with_grade: bool = False,
) -> SubmissionAttempt:
    """Add `sub`'s current turn-in to its attempts, numbered after the
    ones already kept. `sub` must carry its files and reading (loaded).

    `with_grade` also keeps its grade row and understanding check, as
    they are — for a reopen, which replaces graded work. The caller
    clears those off the live submission in the same transaction
    (`clear_grading`)."""
    number = (await db.execute(
        select(func.coalesce(func.max(SubmissionAttempt.number), 0))
        .where(SubmissionAttempt.submission_id == sub.id)
    )).scalar_one() + 1
    grade: dict[str, Any] | None = None
    integrity: dict[str, Any] | None = None
    if with_grade:
        grades = await _rows(db, SubmissionGrade, SubmissionGrade.submission_id == sub.id)
        grade = grades[0] if grades else None
        checks = await _rows(db, IntegrityCheckSubmission, IntegrityCheckSubmission.submission_id == sub.id)
        if checks:
            check_id = checks[0]["id"]
            integrity = {
                "check": checks[0],
                "problems": await _rows(
                    db, IntegrityCheckProblem,
                    IntegrityCheckProblem.integrity_check_submission_id == uuid.UUID(check_id),
                ),
                "turns": await _rows(
                    db, IntegrityConversationTurn,
                    IntegrityConversationTurn.integrity_check_submission_id == uuid.UUID(check_id),
                ),
            }
    attempt = SubmissionAttempt(
        submission_id=sub.id,
        number=number,
        reason=reason,
        files=sub.files,
        extraction=sub.extraction,
        extraction_edits=sub.extraction_edits,
        extraction_edited_at=sub.extraction_edited_at,
        extraction_confirmed_at=sub.extraction_confirmed_at,
        extraction_flagged_at=sub.extraction_flagged_at,
        extraction_flag_note=sub.extraction_flag_note,
        submitted_at=sub.submitted_at,
        is_late=sub.is_late,
        grade=grade,
        integrity=integrity,
        replaced_at=replaced_at,
        reopened_by=reopened_by,
    )
    db.add(attempt)
    await db.flush()
    return attempt


async def clear_grading(db: AsyncSession, submission_id: uuid.UUID) -> None:
    """Drop the grade, understanding check and grading job of the turn-in
    a reopen replaced — after `archive_attempt(with_grade=True)` kept
    them — so the new turn-in starts the normal path from nothing."""
    await db.execute(delete(SubmissionGrade).where(SubmissionGrade.submission_id == submission_id))
    await db.execute(
        delete(IntegrityCheckSubmission).where(IntegrityCheckSubmission.submission_id == submission_id)
    )
    await db.execute(delete(GradingJob).where(GradingJob.submission_id == submission_id))
