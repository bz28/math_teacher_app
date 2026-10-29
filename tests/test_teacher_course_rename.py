"""PATCH /v1/teacher/courses/{id} renames a course — the course page's
title. Subject and grade level are set once, in New course: subject picks
the AI prompts every question in the class was made with, so the PATCH
leaves both alone even if a client sends them.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _teacher_course() -> tuple[uuid.UUID, str]:
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="T",
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra 1", subject="math", grade_level=9)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        await s.commit()
        return course.id, create_access_token(str(teacher.id), "teacher")


async def _course(client: AsyncClient, course_id: uuid.UUID, token: str) -> dict:
    r = await client.get(f"/v1/teacher/courses/{course_id}", headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


async def test_rename_keeps_subject_and_grade(client: AsyncClient) -> None:
    course_id, token = await _teacher_course()
    r = await client.patch(
        f"/v1/teacher/courses/{course_id}",
        json={"name": "  Algebra 1 — Period 3  ", "subject": "physics", "grade_level": 11},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = await _course(client, course_id, token)
    assert body["name"] == "Algebra 1 — Period 3"
    assert body["subject"] == "math"
    assert body["grade_level"] == 9


async def test_rename_rejects_blank_name(client: AsyncClient) -> None:
    course_id, token = await _teacher_course()
    r = await client.patch(
        f"/v1/teacher/courses/{course_id}", json={"name": "   "}, headers=_auth(token),
    )
    assert r.status_code == 422
    assert (await _course(client, course_id, token))["name"] == "Algebra 1"
