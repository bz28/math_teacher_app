"""One enrollment per (student, course).

Student joining the second section of a course they're already in
should hit a 409 with a clear message naming the section they're
already in — not the DB unique-constraint error, and not a silent
duplicate.
"""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course
from api.models.section import Section
from api.models.user import User

from .conftest import auth_headers


@pytest.fixture
async def two_sections_one_course() -> dict[str, str]:
    """Build a student + a course with two sections, each with a live
    join code. Returns the student's access token and both codes.
    UUID suffixes keep the fixture idempotent across tests in the
    session (DB isn't wiped between tests)."""
    tag = uuid.uuid4().hex[:6].upper()
    async with get_session_factory()() as s:
        student = User(
            email=f"dup_enroll_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="DES",
        )
        course = Course(name=f"Algebra 1 {tag}", subject="math")
        s.add_all([student, course])
        await s.flush()

        expires = datetime.now(UTC) + timedelta(days=7)
        p1 = Section(
            course_id=course.id, name="Period 1",
            join_code=f"A{tag}", join_code_expires_at=expires,
        )
        p2 = Section(
            course_id=course.id, name="Period 2",
            join_code=f"B{tag}", join_code_expires_at=expires,
        )
        # Second course (different) to confirm we only block same-course
        # second enrollments, not "any second enrollment."
        geom = Course(name=f"Geometry {tag}", subject="math")
        s.add(geom)
        await s.flush()
        g1 = Section(
            course_id=geom.id, name="Block A",
            join_code=f"G{tag}", join_code_expires_at=expires,
        )
        s.add_all([p1, p2, g1])
        await s.commit()

        token = create_access_token(str(student.id), "student")

    return {
        "token": token,
        "code_same_course_a": f"A{tag}",
        "code_same_course_b": f"B{tag}",
        "code_other_course": f"G{tag}",
    }


async def test_second_section_same_course_rejected(
    client: AsyncClient, two_sections_one_course: dict[str, str],
) -> None:
    headers = auth_headers(two_sections_one_course["token"])

    r1 = await client.post(
        "/v1/teacher/join",
        headers=headers,
        json={"join_code": two_sections_one_course["code_same_course_a"]},
    )
    assert r1.status_code == 200, r1.text

    r2 = await client.post(
        "/v1/teacher/join",
        headers=headers,
        json={"join_code": two_sections_one_course["code_same_course_b"]},
    )
    assert r2.status_code == 409, r2.text
    # Error mentions the section they're already in — so the student
    # knows which one to leave (once leave-section exists).
    assert "Period 1" in r2.json()["detail"]


async def test_section_in_different_course_allowed(
    client: AsyncClient, two_sections_one_course: dict[str, str],
) -> None:
    headers = auth_headers(two_sections_one_course["token"])

    r1 = await client.post(
        "/v1/teacher/join",
        headers=headers,
        json={"join_code": two_sections_one_course["code_same_course_a"]},
    )
    assert r1.status_code == 200, r1.text

    r2 = await client.post(
        "/v1/teacher/join",
        headers=headers,
        json={"join_code": two_sections_one_course["code_other_course"]},
    )
    assert r2.status_code == 200, r2.text
