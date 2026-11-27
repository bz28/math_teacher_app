"""GET /v1/teacher/courses/{id} and the course list say whether the course has any homework,
which picks the tab the course opens on (Homework once there is one,
Sections before)."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _teacher(s, name: str) -> User:
    t = User(email=f"{name}_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
             grade_level=12, role="teacher", name=name)
    s.add(t)
    await s.flush()
    return t


async def _world() -> dict:
    async with get_session_factory()() as s:
        owner = await _teacher(s, "owner")
        co = await _teacher(s, "co")
        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=owner.id, role="owner"))
        s.add(CourseTeacher(course_id=course.id, teacher_id=co.id, role="co_teacher"))
        await s.commit()
        return {"course_id": course.id, "owner_id": owner.id,
                "owner": create_access_token(str(owner.id), "teacher"),
                "co": create_access_token(str(co.id), "teacher")}


async def _has_homework(client: AsyncClient, w: dict, who: str = "owner") -> bool:
    """The course detail's answer, checked against the course list's row
    (the shell reads the list, so the two must agree)."""
    r = await client.get(f"/v1/teacher/courses/{w['course_id']}", headers=_auth(w[who]))
    assert r.status_code == 200, r.text
    listed = await client.get("/v1/teacher/courses", headers=_auth(w[who]))
    assert listed.status_code == 200, listed.text
    row = next(c for c in listed.json()["courses"] if c["id"] == str(w["course_id"]))
    assert row["has_homework"] == r.json()["has_homework"]
    return r.json()["has_homework"]


async def _add(w: dict, type_: str, status: str = "draft") -> None:
    async with get_session_factory()() as s:
        s.add(Assignment(course_id=w["course_id"], teacher_id=w["owner_id"], title="A",
                         type=type_, status=status, content={"problems": []}))
        await s.commit()


async def test_new_course_has_no_homework(client: AsyncClient) -> None:
    assert await _has_homework(client, await _world()) is False


async def test_practice_alone_is_not_homework(client: AsyncClient) -> None:
    w = await _world()
    await _add(w, "practice", "published")
    assert await _has_homework(client, w) is False


async def test_a_draft_homework_counts(client: AsyncClient) -> None:
    w = await _world()
    await _add(w, "homework")
    assert await _has_homework(client, w) is True


async def test_a_co_teachers_view_counts_the_owners_homework(client: AsyncClient) -> None:
    w = await _world()
    await _add(w, "homework")
    assert await _has_homework(client, w, "co") is True
