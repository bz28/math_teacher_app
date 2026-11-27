"""The homework card's stats: `republish` and `extended`.

- `republish` — published grades the teacher edited since (the student
  still sees the old one), so a homework with `published == submitted`
  can still owe a republish and must not read as "only missing work".
- `extended` — students who haven't turned it in and whose personal due
  date (StudentDueDate) is still ahead: not missing yet.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import AssignmentSection, StudentDueDate, Submission, SubmissionGrade
from tests.conftest import auth_headers as _auth

DAY = timedelta(hours=24)


async def _stats(client: AsyncClient, world: dict[str, Any]) -> dict[str, Any]:
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}", headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def _turn_in_with_published_grade(world: dict[str, Any], score: float) -> uuid.UUID:
    async with get_session_factory()() as s:
        section_id = (await s.execute(
            select(AssignmentSection.section_id)
            .where(AssignmentSection.assignment_id == world["assignment_id"])
        )).scalar_one()
        sub = Submission(
            assignment_id=world["assignment_id"], student_id=world["student_id"],
            section_id=section_id, status="submitted", files=[],
        )
        s.add(sub)
        await s.flush()
        now = datetime.now(UTC)
        s.add(SubmissionGrade(
            submission_id=sub.id, final_score=score, published_final_score=score,
            breakdown=[], published_breakdown=[], grade_published_at=now, reviewed_at=now,
        ))
        await s.commit()
        return sub.id


async def test_a_grade_edited_after_publishing_counts_as_a_republish(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = await _turn_in_with_published_grade(world, 80.0)
    body = await _stats(client, world)
    assert (body["submitted"], body["published"], body["republish"]) == (1, 1, 0)

    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(SubmissionGrade.submission_id == sid))).scalar_one()
        g.final_score = 90.0
        await s.commit()
    body = await _stats(client, world)
    # Still "published" (the student sees a grade), but owed again.
    assert (body["published"], body["republish"]) == (1, 1)

    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(SubmissionGrade.submission_id == sid))).scalar_one()
        g.final_score = 80.0  # reverted to what the student sees
        await s.commit()
    assert (await _stats(client, world))["republish"] == 0


async def test_a_student_inside_their_own_due_date_is_extended_not_missing(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    assert (await _stats(client, world))["extended"] == 0

    async with get_session_factory()() as s:
        s.add(StudentDueDate(
            assignment_id=world["assignment_id"], student_id=world["student_id"],
            due_at=datetime.now(UTC) + 2 * DAY,
        ))
        await s.commit()
    assert (await _stats(client, world))["extended"] == 1

    # Their own date passed → missing again.
    async with get_session_factory()() as s:
        d = (await s.execute(select(StudentDueDate))).scalar_one()
        d.due_at = datetime.now(UTC) - DAY
        await s.commit()
    assert (await _stats(client, world))["extended"] == 0

    # Turned in within an extension → counted as submitted, not extended.
    async with get_session_factory()() as s:
        d = (await s.execute(select(StudentDueDate))).scalar_one()
        d.due_at = datetime.now(UTC) + DAY
        await s.commit()
    await _turn_in_with_published_grade(world, 70.0)
    body = await _stats(client, world)
    assert (body["submitted"], body["extended"]) == (1, 0)
