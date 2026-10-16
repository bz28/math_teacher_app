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
        # Inherits source HW's title prefixed with "[Practice]" so
        # cross-type surfaces can distinguish the two at a glance.
        assert practice.title == "[Practice] HW 1"

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


# ── Chosen problems, count, periods, and adding to a set ──────────


async def _hw_world() -> dict[str, Any]:
    """A homework with three problems assigned to two periods."""
    from api.models.assignment import AssignmentSection
    from api.models.course import Course, CourseTeacher
    from api.models.question_bank import QuestionBankItem
    from api.models.section import Section
    from api.models.unit import Unit

    async with get_session_factory()() as s:
        teacher = User(email=f"t_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T")
        course = Course(name="Algebra 1", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id))
        unit = Unit(course_id=course.id, name="U", position=0)
        p1, p3 = Section(course_id=course.id, name="Period 1"), Section(course_id=course.id, name="Period 3")
        s.add_all([unit, p1, p3])
        await s.flush()
        hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id, title="HW 6",
                        type="homework", status="published", content={"problem_ids": []})
        s.add(hw)
        await s.flush()
        items = [QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                                  title=f"Q{i}", question=f"Q{i}", final_answer="1",
                                  status="approved", source="generated") for i in (1, 2, 3)]
        s.add_all(items)
        await s.flush()
        hw.content = {"problem_ids": [str(i.id) for i in items]}
        s.add_all([AssignmentSection(assignment_id=hw.id, section_id=p.id) for p in (p1, p3)])
        await s.commit()
        return {
            "token": create_access_token(str(teacher.id), "teacher"),
            "course": course.id, "hw": hw.id, "unit": unit.id,
            "items": [i.id for i in items], "p1": p1.id, "p3": p3.id,
        }


async def _jobs_for(practice_id: Any) -> list[QuestionBankGenerationJob]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(QuestionBankGenerationJob).where(
                QuestionBankGenerationJob.originating_assignment_id == uuid.UUID(str(practice_id)),
            )
        )).scalars().all())


async def test_clone_chosen_problems_for_one_period(client: AsyncClient) -> None:
    from api.models.assignment import AssignmentSection

    w = await _hw_world()
    q1, _q2, q3 = w["items"]
    with patch("api.routes.teacher_assignments.schedule_generation_job") as sched:
        r = await client.post(
            f"/v1/teacher/courses/{w['course']}/assignments/{w['hw']}/clone-as-practice",
            json={"item_ids": [str(q3), str(q1)], "count": 3, "section_ids": [str(w["p3"])]},
            headers=_auth(w["token"]),
        )
    assert r.status_code == 201, r.text
    body = r.json()
    # A set for some of the homework's periods names them.
    assert body["title"] == "[Practice] HW 6 · Period 3"
    assert sched.call_count == 2
    jobs = await _jobs_for(body["id"])
    assert {(j.parent_question_id, j.requested_count) for j in jobs} == {(q1, 3), (q3, 3)}
    async with get_session_factory()() as s:
        sections = (await s.execute(
            select(AssignmentSection.section_id).where(AssignmentSection.assignment_id == uuid.UUID(body["id"]))
        )).scalars().all()
    assert sections == [w["p3"]]


async def test_clone_rejects_problems_or_periods_off_the_homework(client: AsyncClient) -> None:
    w = await _hw_world()
    url = f"/v1/teacher/courses/{w['course']}/assignments/{w['hw']}/clone-as-practice"
    h = _auth(w["token"])
    with patch("api.routes.teacher_assignments.schedule_generation_job"):
        for payload in (
            {"item_ids": [str(uuid.uuid4())]},
            {"item_ids": []},
            {"section_ids": [str(uuid.uuid4())]},
            {"count": 6},
        ):
            r = await client.post(url, json=payload, headers=h)
            assert r.status_code in (400, 422), (payload, r.text)


async def test_add_problems_to_an_existing_set(client: AsyncClient) -> None:
    w = await _hw_world()
    q1, q2, _q3 = w["items"]
    h = _auth(w["token"])
    with patch("api.routes.teacher_assignments.schedule_generation_job") as sched:
        created = (await client.post(
            f"/v1/teacher/courses/{w['course']}/assignments/{w['hw']}/clone-as-practice",
            json={"item_ids": [str(q1)], "count": 3}, headers=h,
        )).json()
        r = await client.post(
            f"/v1/teacher/courses/{w['course']}/assignments/{created['id']}/practice-problems",
            json={"item_ids": [str(q2)], "count": 5}, headers=h,
        )
        assert r.status_code == 201, r.text
        assert sched.call_count == 2
        # A homework can't take problems this way, and neither can a
        # practice set with problems from another homework.
        bad = await client.post(
            f"/v1/teacher/courses/{w['course']}/assignments/{w['hw']}/practice-problems",
            json={"item_ids": [str(q2)]}, headers=h,
        )
        assert bad.status_code == 400
        off_hw = await client.post(
            f"/v1/teacher/courses/{w['course']}/assignments/{created['id']}/practice-problems",
            json={"item_ids": [str(uuid.uuid4())]}, headers=h,
        )
        assert off_hw.status_code == 400
    jobs = await _jobs_for(created["id"])
    assert {(j.parent_question_id, j.requested_count) for j in jobs} == {(q1, 3), (q2, 5)}
    # Full title: the set covers every period of the homework.
    assert created["title"] == "[Practice] HW 6"


async def test_practice_problems_follow_homework_order(client: AsyncClient) -> None:
    """Versions come back in the homework's problem order, not the
    order concurrent generation jobs happened to finish."""
    from datetime import UTC, datetime, timedelta

    from api.models.question_bank import QuestionBankItem
    from api.services.bank import approved_practice_items

    w = await _hw_world()
    q1, q2, q3 = w["items"]
    async with get_session_factory()() as s:
        hw = await s.get(Assignment, w["hw"])
        assert hw is not None
        practice = Assignment(course_id=w["course"], unit_ids=[w["unit"]], teacher_id=hw.teacher_id,
                              title="P", type="practice", status="draft", source_homework_id=w["hw"])
        s.add(practice)
        await s.flush()
        t0 = datetime.now(UTC)
        # Finished out of order: Q3's version first, then Q1's two, then Q2's.
        for n, parent in enumerate((q3, q1, q2, q1)):
            s.add(QuestionBankItem(course_id=w["course"], unit_id=w["unit"], originating_assignment_id=practice.id,
                                   parent_question_id=parent, title=f"v{n}", question=f"v{n}", final_answer="1",
                                   status="approved", source="practice", created_at=t0 + timedelta(seconds=n)))
        await s.commit()
        ordered = await approved_practice_items(s, practice)
    assert [(i.parent_question_id, i.title) for i in ordered] == [
        (q1, "v1"), (q1, "v3"), (q2, "v2"), (q3, "v0"),
    ]
