"""Teacher actions that must leave a trace in `activity_log`.

The school console can only show what a school is DOING if the doing is
recorded. `record_activity` is called by hand at each mutation, so
coverage is whatever someone remembered — and the actions below were all
silent, which made a school mid-onboarding read as an idle one.

Two of these are load-bearing beyond the feed:

- **Integrity rulings.** A teacher deciding whether a student was
  dishonest is the most consequential judgment in the product. It was
  stamped on the check row, so it was recoverable — but only if you knew
  to go looking, and it could never appear in a timeline.
- **Deletes.** A section delete discards student work and a course delete
  takes the class with it. Those must be recorded BEFORE the row goes,
  or the entry is unreadable afterwards.

These tests assert the trace exists and carries no student identity
beyond an id — `activity_log` is a compliance surface with an explicit
keep-it-small contract.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from tests.conftest import auth_headers as _auth

pytestmark = pytest.mark.asyncio


async def _actions() -> list[ActivityLog]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(ActivityLog).order_by(ActivityLog.performed_at.asc())
        )).scalars().all())


async def _clear() -> None:
    async with get_session_factory()() as s:
        for row in (await s.execute(select(ActivityLog))).scalars().all():
            await s.delete(row)
        await s.commit()


async def _own_course(world: dict[str, Any]) -> uuid.UUID:
    """Link the fixture teacher to the course and return its id.

    The shared `world` fixture creates no CourseTeacher row, and every
    teacher course endpoint authorizes through it. Done here rather than
    in the fixture: a dozen other modules depend on `world`, and widening
    its permissions could quietly weaken an authorization assertion
    somewhere else. Same approach as tests/test_question_edits.py.
    """
    from api.models.course import Course, CourseTeacher
    from api.models.question_bank import QuestionBankItem

    async with get_session_factory()() as s:
        course_id = (await s.execute(
            select(QuestionBankItem.course_id).where(
                QuestionBankItem.id == uuid.UUID(str(world["primary_id"])),
            )
        )).scalar_one()
        exists = (await s.execute(
            select(CourseTeacher).where(
                CourseTeacher.course_id == course_id,
                CourseTeacher.teacher_id == world["teacher_id"],
            )
        )).scalar_one_or_none()
        if exists is None:
            s.add(CourseTeacher(
                course_id=course_id, teacher_id=world["teacher_id"],
            ))
        course = (await s.execute(
            select(Course).where(Course.id == course_id)
        )).scalar_one()
        if getattr(course, "teacher_id", None) is None:
            course.teacher_id = world["teacher_id"]
        await s.commit()
        return course_id


async def _course_id(world: dict[str, Any]) -> uuid.UUID:
    from api.models.question_bank import QuestionBankItem

    async with get_session_factory()() as s:
        return (await s.execute(
            select(QuestionBankItem.course_id).where(
                QuestionBankItem.id == uuid.UUID(str(world["primary_id"])),
            )
        )).scalar_one()


async def test_creating_a_section_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Opening a class period is often a school's first real action. It
    was written to stdout as an AUDIT line — real, but not queryable, so
    no timeline could ever show it."""
    await _clear()
    course_id = await _own_course(world)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Period 7"},
    )
    assert r.status_code == 201, r.text

    rows = [a for a in await _actions() if a.action == "section.create"]
    assert len(rows) == 1
    assert rows[0].action_metadata["name"] == "Period 7"
    assert rows[0].actor_role == "teacher"


async def test_deleting_a_section_is_recorded_before_the_row_goes(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A section delete discards every submission in it. Recording after
    the delete would leave an entry naming a row that no longer exists —
    so the name has to be captured first."""
    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Doomed"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    await _clear()

    r = await client.delete(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    rows = [a for a in await _actions() if a.action == "section.delete"]
    assert len(rows) == 1
    # Readable after the fact, which is the whole point of recording early.
    assert rows[0].action_metadata["name"] == "Doomed"


async def test_creating_a_course_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _clear()
    r = await client.post(
        "/v1/teacher/courses",
        headers=_auth(world["teacher_token"]),
        json={"name": "Geometry", "subject": "math"},
    )
    assert r.status_code == 201, r.text

    rows = [a for a in await _actions() if a.action == "course.create"]
    assert len(rows) == 1
    assert rows[0].action_metadata["name"] == "Geometry"


async def test_a_roster_removal_records_an_id_and_no_identity(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """`activity_log` is a compliance surface with a keep-it-SMALL
    contract. A roster change does not need a student's name or email to
    be legible, and putting them there would degrade a surface other
    people depend on."""
    from api.models.section_enrollment import SectionEnrollment

    course_id = await _own_course(world)
    async with get_session_factory()() as s:
        enrollment = (await s.execute(
            select(SectionEnrollment).where(
                SectionEnrollment.course_id == course_id,
            ).limit(1)
        )).scalar_one_or_none()
    if enrollment is None:
        pytest.skip("fixture has no enrollment to remove")

    await _clear()
    r = await client.delete(
        f"/v1/teacher/courses/{course_id}/sections/{enrollment.section_id}"
        f"/students/{enrollment.student_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    rows = [a for a in await _actions() if a.action == "section.remove_student"]
    assert len(rows) == 1
    meta = rows[0].action_metadata
    assert meta == {"student_id": str(enrollment.student_id)}
    assert "email" not in str(meta) and "name" not in meta


async def test_inviting_a_new_student_is_recorded(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """The onboarding path that was silent.

    `section.enroll_student` only fires when the invited email ALREADY has
    an account. For a brand-new student the flow is invite -> claim, and
    the claim is a student action that deliberately stays out of this log.
    Without recording the invite, a school onboarding thirty new students
    produced zero roster activity — the exact idle-school reading this
    instrumentation exists to prevent.
    """
    course_id = await _own_course(world)
    created = await client.post(
        f"/v1/teacher/courses/{course_id}/sections",
        headers=_auth(world["teacher_token"]), json={"name": "Period 9"},
    )
    assert created.status_code == 201, created.text
    section_id = created.json()["id"]
    await _clear()

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/invites",
        headers=_auth(world["teacher_token"]),
        json={"email": "brand.new.student@example.com"},
    )
    assert r.status_code in (200, 201), r.text

    rows = [a for a in await _actions() if a.action == "section.invite_student"]
    assert len(rows) == 1
    # No email. An invitee's address is not needed to make the entry
    # legible, and this table is a compliance surface.
    assert "brand.new.student" not in str(rows[0].action_metadata)
