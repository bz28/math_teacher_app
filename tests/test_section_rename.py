"""PATCH /v1/teacher/courses/{course_id}/sections/{section_id} — rename a section.

Covers happy path (with strip), validation rejection (empty after
strip), and cross-course IDOR (section belongs to a different course
than the URL).
"""
import uuid

import pytest
from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.section import Section
from api.models.user import User

from .conftest import auth_headers


@pytest.fixture
async def teacher_with_section() -> dict[str, str]:
    """A teacher who owns a course with a section. Plus a second
    course (also owned by this teacher) used for the cross-course
    IDOR test."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(
            email=f"rename_teacher_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="RT",
        )
        s.add(teacher)
        await s.flush()

        course_a = Course(name=f"Algebra {tag}", subject="math")
        course_b = Course(name=f"Geometry {tag}", subject="math")
        s.add_all([course_a, course_b])
        await s.flush()

        s.add_all([
            CourseTeacher(course_id=course_a.id, teacher_id=teacher.id, role="owner"),
            CourseTeacher(course_id=course_b.id, teacher_id=teacher.id, role="owner"),
        ])

        section_a = Section(course_id=course_a.id, name="Period 1")
        s.add(section_a)
        await s.commit()
        await s.refresh(section_a)

        return {
            "token": create_access_token(str(teacher.id), "teacher"),
            "course_a_id": str(course_a.id),
            "course_b_id": str(course_b.id),
            "section_a_id": str(section_a.id),
        }


async def test_rename_section_strips_and_persists(
    client: AsyncClient, teacher_with_section: dict[str, str],
) -> None:
    headers = auth_headers(teacher_with_section["token"])
    course_id = teacher_with_section["course_a_id"]
    section_id = teacher_with_section["section_a_id"]

    r = await client.patch(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}",
        headers=headers,
        json={"name": "  Period 2  "},
    )
    assert r.status_code == 200, r.text

    # Verify persistence by reading back via GET section.
    r2 = await client.get(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}",
        headers=headers,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["name"] == "Period 2"  # stripped


async def test_rename_rejects_empty_name(
    client: AsyncClient, teacher_with_section: dict[str, str],
) -> None:
    headers = auth_headers(teacher_with_section["token"])
    course_id = teacher_with_section["course_a_id"]
    section_id = teacher_with_section["section_a_id"]

    r = await client.patch(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}",
        headers=headers,
        json={"name": "   "},
    )
    assert r.status_code == 422, r.text


async def test_rename_rejects_section_in_other_course(
    client: AsyncClient, teacher_with_section: dict[str, str],
) -> None:
    """Section A belongs to course A. Hitting it via course B's URL
    must 404 (the _get_section_in_course IDOR guard). Even though the
    teacher owns both courses, the section must be addressed via its
    real parent course."""
    headers = auth_headers(teacher_with_section["token"])
    other_course_id = teacher_with_section["course_b_id"]
    section_id = teacher_with_section["section_a_id"]

    r = await client.patch(
        f"/v1/teacher/courses/{other_course_id}/sections/{section_id}",
        headers=headers,
        json={"name": "Hijack"},
    )
    assert r.status_code == 404, r.text


async def test_rename_omitted_name_is_noop(
    client: AsyncClient, teacher_with_section: dict[str, str],
) -> None:
    """Empty body (name omitted) is a valid request — just no-op."""
    headers = auth_headers(teacher_with_section["token"])
    course_id = teacher_with_section["course_a_id"]
    section_id = teacher_with_section["section_a_id"]

    r = await client.patch(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}",
        headers=headers,
        json={},
    )
    assert r.status_code == 200, r.text
