"""The student's "one more step" nudge — `next_step` on the homework
list, the dashboard and the homework page.

Nudge only: these tests pin WHEN the nudge shows, never that anything
waits on it (grading never waits on the understanding check).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from tests.conftest import auth_headers as _auth

EXTRACTION = {"confidence": 0.9, "steps": [], "final_answers": []}


async def _submission(world: dict[str, Any], **kw: Any) -> uuid.UUID:
    async with get_session_factory()() as s:
        section_id = (await s.execute(
            select(AssignmentSection.section_id)
            .where(AssignmentSection.assignment_id == world["assignment_id"])
        )).scalar_one()
        sub = Submission(
            assignment_id=world["assignment_id"], student_id=world["student_id"],
            section_id=section_id, status="submitted",
            submitted_at=datetime.now(UTC) - timedelta(minutes=5), **kw,
        )
        s.add(sub)
        await s.commit()
        return sub.id


async def _check(sub_id: uuid.UUID, status: str, *, stale: bool = False) -> None:
    async with get_session_factory()() as s:
        s.add(IntegrityCheckSubmission(submission_id=sub_id, status=status))
        await s.commit()
    if stale:
        async with get_session_factory()() as s:
            await s.execute(
                text(
                    "UPDATE integrity_check_submissions SET updated_at = :ts "
                    "WHERE submission_id = :sid"
                ),
                {"ts": datetime.now(UTC) - timedelta(hours=13), "sid": sub_id},
            )
            await s.commit()


async def _next_steps(client: AsyncClient, world: dict[str, Any]) -> dict[str, Any]:
    """next_step as each of the three surfaces reports it."""
    h = _auth(world["student_token"])
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(Assignment.course_id).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
    aid = str(world["assignment_id"])
    listed = (await client.get(f"/v1/school/student/courses/{course_id}/homework", headers=h)).json()
    dash = (await client.get("/v1/school/student/dashboard", headers=h)).json()
    detail = (await client.get(f"/v1/school/student/homework/{aid}", headers=h)).json()
    in_review = [a for a in dash["in_review"] if a["assignment_id"] == aid]
    return {
        "list": next(a for a in listed if a["assignment_id"] == aid)["next_step"],
        "dashboard": in_review[0]["next_step"] if in_review else "absent",
        "detail": detail["next_step"],
    }


def _all(value: Any) -> dict[str, Any]:
    return {"list": value, "dashboard": value, "detail": value}


async def test_not_submitted_has_no_step(client: AsyncClient, world: dict[str, Any]) -> None:
    got = await _next_steps(client, world)
    assert got["list"] is None and got["detail"] is None


async def test_unconfirmed_reading_asks_to_confirm(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _submission(world, extraction=EXTRACTION)
    assert await _next_steps(client, world) == _all("confirm_reading")


@pytest.mark.parametrize("status", ["awaiting_student", "in_progress"])
async def test_open_check_asks_to_finish(
    client: AsyncClient, world: dict[str, Any], status: str,
) -> None:
    sub_id = await _submission(
        world, extraction=EXTRACTION, extraction_confirmed_at=datetime.now(UTC),
    )
    await _check(sub_id, status)
    assert await _next_steps(client, world) == _all("finish_check")


async def test_check_past_its_deadline_is_not_nudged(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Nothing to come back to: it's being closed as unfinished."""
    sub_id = await _submission(
        world, extraction=EXTRACTION, extraction_confirmed_at=datetime.now(UTC),
    )
    await _check(sub_id, "in_progress", stale=True)
    assert await _next_steps(client, world) == _all(None)


async def test_finished_check_has_no_step(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sub_id = await _submission(
        world, extraction=EXTRACTION, extraction_confirmed_at=datetime.now(UTC),
    )
    await _check(sub_id, "complete")
    assert await _next_steps(client, world) == _all(None)


async def test_disputed_reading_has_no_step(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _submission(
        world, extraction=EXTRACTION, extraction_flagged_at=datetime.now(UTC),
    )
    assert await _next_steps(client, world) == _all(None)


async def test_published_grade_ends_the_nudge(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A nudge next to a released grade reads as a demand; the loop has
    moved on. (The dashboard moves the homework to Recently graded.)"""
    sub_id = await _submission(world, extraction=EXTRACTION)
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sub_id, final_score=90.0, breakdown=[],
            grade_published_at=datetime.now(UTC),
            published_final_score=90.0, published_breakdown=[],
        ))
        await s.commit()
    got = await _next_steps(client, world)
    assert got == {"list": None, "dashboard": "absent", "detail": None}


async def _set_toggles(world: dict[str, Any], *, integrity: bool, ai_grading: bool) -> None:
    async with get_session_factory()() as s:
        a = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        a.integrity_check_enabled = integrity
        a.ai_grading_enabled = ai_grading
        await s.commit()


async def test_switching_the_check_off_ends_the_finish_nudge(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The teacher turned the check off after the student started it:
    nothing waits on the chat any more."""
    sub_id = await _submission(
        world, extraction=EXTRACTION, extraction_confirmed_at=datetime.now(UTC),
    )
    await _check(sub_id, "in_progress")
    await _set_toggles(world, integrity=False, ai_grading=True)
    assert await _next_steps(client, world) == _all(None)


@pytest.mark.parametrize(
    ("integrity", "ai_grading", "expected"),
    [
        (False, True, "confirm_reading"),  # AI grading still waits on it
        (True, False, "confirm_reading"),  # the check starts from it
        (False, False, None),  # nothing reads the confirm any more
    ],
)
async def test_confirm_nudge_follows_what_still_needs_it(
    client: AsyncClient, world: dict[str, Any],
    integrity: bool, ai_grading: bool, expected: str | None,
) -> None:
    await _submission(world, extraction=EXTRACTION)
    await _set_toggles(world, integrity=integrity, ai_grading=ai_grading)
    assert await _next_steps(client, world) == _all(expected)
