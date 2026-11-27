"""The admin rail's school switcher must actually scope every page.

The switcher used to select only which school "Teachers & classes"
opened; the AI-quality tabs and the Teacher-reports inbox
ignored it and always answered for the whole platform. Each of those
endpoints now takes `school_id`, and this file pins, per endpoint:

- scoped to A, the answer is A's rows only — B's never leak in;
- unscoped ("All schools"), the answer is every school's rows, counted
  once — A + B add up to the total rather than double counting;
- rows that belong to no school (admin/system LLM calls with
  `school_id IS NULL`) and preview (shadow) students never appear in a
  school's scope.

Every assertion on the scoped side would fail if the filter were
removed, because B's rows would be counted too.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.session import Session
from api.models.teacher_report import TeacherReport
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

pytestmark = pytest.mark.asyncio


def _user(role: str, name: str, school_id: uuid.UUID | None, **kw: Any) -> User:
    return User(
        email=f"{name.lower().replace(' ', '')}_{uuid.uuid4().hex[:6]}@t.com",
        password_hash=hash_password("x"), grade_level=99 if role == "admin" else 9,
        role=role, name=name, school_id=school_id, **kw,
    )


async def _school(
    s: Any, name: str, *, students: int, reports: int, cost: float,
    with_preview: bool = False,
) -> dict[str, Any]:
    """One school with `students` real students, each of whom submitted
    one handwriting-confirmed, teacher-reviewed homework and ran one
    tutoring session; `reports` open teacher reports;
    and one LLM call costing `cost`.

    `with_preview` adds a preview (shadow) student who did all the same
    things — the rows a school's scope must NOT count.
    """
    recent = datetime.now(UTC) - timedelta(hours=1)
    school = School(
        name=name, kind=SCHOOL_KIND_INSTITUTIONAL,
        contact_name="C", contact_email=f"c_{uuid.uuid4().hex[:6]}@s.edu",
    )
    s.add(school)
    await s.flush()

    teacher = _user("teacher", f"{name} Teacher", school.id)
    course = Course(name=f"{name} Algebra", subject="math", school_id=school.id)
    s.add_all([teacher, course])
    await s.flush()
    unit = Unit(course_id=course.id, name="U", position=0)
    section = Section(course_id=course.id, name="P1")
    s.add_all([unit, section])
    await s.flush()
    asg = Assignment(
        course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
        title="HW", type="homework", status="published", content={"problems": []},
    )
    s.add(asg)
    await s.flush()

    kids = [_user("student", f"{name} Kid {i}", school.id) for i in range(students)]
    if with_preview:
        kids.append(_user("student", f"{name} Preview", school.id, is_preview=True))
    s.add_all(kids)
    await s.flush()

    for kid in kids:
        sub = Submission(
            assignment_id=asg.id, student_id=kid.id, section_id=section.id,
            status="submitted", submitted_at=recent,
            extraction={"steps": [{"problem_position": 1, "step_num": 1,
                                   "latex": "x = 2", "plain_english": ""}],
                        "final_answers": [], "confidence": 0.9},
            extraction_confirmed_at=recent,
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id,
            ai_breakdown={"grades": [{"score_status": "partial", "percent": 60}]},
            breakdown=[{"score_status": "full", "percent": 100}],
            graded_at=recent, reviewed_at=recent,
        ))
        s.add(Session(user_id=kid.id, problem="p", problem_type="algebra"))

    for i in range(reports):
        s.add(TeacherReport(
            teacher_id=teacher.id, teacher_name=teacher.name,
            school_id=school.id, kind="wrong_grade", note=f"{name} report {i}",
        ))

    s.add(LLMCall(
        function="decompose", model="claude", input_tokens=1, output_tokens=1,
        latency_ms=100.0, cost_usd=cost, success=True,
        user_id=teacher.id, school_id=school.id,
    ))
    return {"id": str(school.id), "course": course.name}


@pytest.fixture
async def world() -> dict[str, Any]:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE teacher_reports, "
            "llm_calls, sessions, submission_grades, submissions, assignments, "
            "section_enrollments, sections, units, course_teachers, courses, "
            "teacher_invites, schools, users RESTART IDENTITY CASCADE"
        ))
        admin = _user("admin", "Admin", None)
        s.add(admin)
        await s.flush()
        a = await _school(s, "Alpha", students=1, reports=1, cost=1.0, with_preview=True)
        b = await _school(s, "Beta", students=2, reports=2, cost=2.0)
        # An admin/system call: belongs to no school, so it must appear in
        # "All schools" and in no school's scope.
        s.add(LLMCall(
            function="judge", model="claude", input_tokens=1, output_tokens=1,
            latency_ms=100.0, cost_usd=4.0, success=True, user_id=admin.id,
        ))
        await s.commit()
        return {"token": create_access_token(str(admin.id), "admin"), "a": a, "b": b}


async def _get(client: AsyncClient, world: dict[str, Any], url: str,
               school: str | None) -> dict[str, Any]:
    params = {"school_id": world[school]["id"]} if school else {}
    res = await client.get(url, params=params, headers=auth_headers(world["token"]))
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


async def test_reports_inbox_is_scoped(client: AsyncClient, world: dict[str, Any]) -> None:
    url = "/v1/admin/reports?status=open"
    a = await _get(client, world, url, "a")
    b = await _get(client, world, url, "b")
    every = await _get(client, world, url, None)

    assert [r["note"] for r in a["reports"]] == ["Alpha report 0"]
    assert a["counts"]["open"] == 1
    assert {r["school_id"] for r in b["reports"]} == {world["b"]["id"]}
    assert b["counts"]["open"] == 2
    assert every["counts"]["open"] == 3
    assert len(every["reports"]) == 3


async def test_grading_quality_is_scoped(client: AsyncClient, world: dict[str, Any]) -> None:
    url = "/v1/admin/grading-quality"
    a = await _get(client, world, url, "a")
    b = await _get(client, world, url, "b")
    every = await _get(client, world, url, None)

    # Alpha's preview student is excluded (existing convention), leaving
    # its one real student.
    assert a["summary"]["reviewed_submissions"] == 1
    assert a["summary"]["ai_graded_submissions"] == 1
    assert b["summary"]["reviewed_submissions"] == 2
    assert every["summary"]["reviewed_submissions"] == 3
    assert [c["course"] for c in a["by_course"]] == [world["a"]["course"]]


async def test_grading_overrides_drill_is_scoped(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    url = "/v1/admin/grading-quality/overrides"
    a = await _get(client, world, url, "a")
    every = await _get(client, world, url, None)

    assert {c["course"] for c in a["cases"]} == {world["a"]["course"]}
    assert a["total_count"] == 1
    assert every["total_count"] == 3


async def test_extraction_quality_is_scoped(client: AsyncClient, world: dict[str, Any]) -> None:
    url = "/v1/admin/extraction-quality"
    a = await _get(client, world, url, "a")
    b = await _get(client, world, url, "b")
    every = await _get(client, world, url, None)

    # The preview student's confirmed read is NOT counted: a teacher
    # trying the student view is not evidence about the reader.
    assert a["summary"]["settled"] == 1
    assert b["summary"]["settled"] == 2
    assert every["summary"]["settled"] == 3
    assert {c["course"] for c in a["cases"]} == {world["a"]["course"]}
    assert a["total_count"] == 1


async def test_llm_calls_and_users_are_scoped(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """These two already filtered; the dashboard now actually sends the
    rail's school to them. Pinned so a regression shows up here too."""
    calls_a = await _get(client, world, "/v1/admin/llm-calls?hours=24", "a")
    calls_all = await _get(client, world, "/v1/admin/llm-calls?hours=24", None)
    assert calls_a["total_count"] == 1
    assert calls_a["total_cost_window"] == 1.0
    assert calls_all["total_count"] == 3

    users_a = await _get(client, world, "/v1/admin/users", "a")
    assert {u["name"] for u in users_a["users"]} == {"Alpha Teacher", "Alpha Kid 0"}
