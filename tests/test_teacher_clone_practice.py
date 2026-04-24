"""Integration tests for POST
/v1/teacher/courses/{id}/assignments/{hw_id}/clone-as-practice.

Grounds the contract: a successful clone creates a new draft Practice
assignment with source_homework_id set and fires one generation job
per source problem via the existing parent_question_id path. The
generation worker itself is mocked — we assert on the rows the route
writes to the DB, not on the (long, AI-driven) job execution.
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.question_bank import QuestionBankGenerationJob
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    """The world fixture seeds an Assignment owned by the teacher but
    doesn't create a CourseTeacher row; the clone endpoint gates on
    course ownership via get_teacher_course, so add the link
    explicitly. Mirrors the helper in test_bank_no_variation_in_hw.py.
    """
    from api.models.course import CourseTeacher
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def _course_id_for(assignment_id: Any) -> Any:
    async with get_session_factory()() as s:
        return (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": assignment_id},
        )).scalar_one()


async def test_clone_creates_draft_practice_with_source_link(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    with patch(
        "api.routes.teacher_assignments.schedule_generation_job",
    ) as sched:
        r = await client.post(
            f"/v1/teacher/courses/{course_id}/assignments/"
            f"{world['assignment_id']}/clone-as-practice",
            headers=_auth(world["teacher_token"]),
        )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft"
    assert body["source_homework_id"] == str(world["assignment_id"])
    # Source HW in the world fixture has exactly one primary problem,
    # so we expect exactly one generation job queued.
    assert len(body["job_ids"]) == 1
    # Regression guard: the returned job id must be a real UUID,
    # not literal "None" (what we got when the route captured
    # job.id before SQLAlchemy's column default fired at flush).
    returned_job_id = body["job_ids"][0]
    assert returned_job_id != "None"
    uuid.UUID(returned_job_id)  # raises ValueError if not a uuid

    # Matching regression guard on the scheduler: every call must
    # receive a real UUID that matches what the response returned.
    # Without this, a None-valued schedule call that silently failed
    # would still produce call_count == 1.
    assert sched.call_count == 1
    scheduled_arg = sched.call_args_list[0].args[0]
    assert str(scheduled_arg) == returned_job_id

    # Verify the persisted practice assignment matches.
    async with get_session_factory()() as s:
        practice = (await s.execute(
            select(Assignment).where(Assignment.id == body["id"])
        )).scalar_one()
        assert practice.type == "practice"
        assert practice.status == "draft"
        assert practice.source_homework_id == world["assignment_id"]
        # Inherits source HW's title.
        assert practice.title == "HW 1"

        # One generation job with parent_question_id pointing at the
        # source HW's primary and requested_count=1.
        jobs = (await s.execute(
            select(QuestionBankGenerationJob).where(
                QuestionBankGenerationJob.originating_assignment_id == practice.id
            )
        )).scalars().all()
        assert len(jobs) == 1
        assert jobs[0].parent_question_id == world["primary_id"]
        # The id the route returned must match what was persisted.
        assert str(jobs[0].id) == returned_job_id
        assert jobs[0].requested_count == 1
        assert jobs[0].status == "queued"


async def test_clone_rejects_when_source_is_not_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    # Flip the world HW to type=practice so the guard trips.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET type='practice' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments/"
        f"{world['assignment_id']}/clone-as-practice",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400
    assert "homework" in r.json()["detail"].lower()


async def test_clone_rejects_empty_source_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    # Strip the HW's content so it has no problems. The clone endpoint
    # must 400 rather than create a practice set with zero jobs.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET content='{\"problems\": []}'::json WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments/"
        f"{world['assignment_id']}/clone-as-practice",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400
    assert "no problems" in r.json()["detail"].lower()


async def test_clone_rejects_outsider_teacher(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A teacher token for a user who doesn't own the course gets 403
    from get_teacher_course. The endpoint must not leak the HW's
    existence to them."""
    course_id = await _course_id_for(world["assignment_id"])
    # Do NOT link this teacher to the course — authz should reject.
    async with get_session_factory()() as s:
        other = User(
            email=f"other_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="Other",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments/"
        f"{world['assignment_id']}/clone-as-practice",
        headers=_auth(other_token),
    )
    assert r.status_code in (403, 404)


async def test_clone_returns_404_for_nonexistent_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    fake = uuid.uuid4()
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments/{fake}/clone-as-practice",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 404
