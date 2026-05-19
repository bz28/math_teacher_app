"""Tests for GET /v1/admin/schools/{school_id}/students.

Same role as the per-teacher roster but scoped to a whole school —
spans every course owned by every teacher of the school.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def _truncate() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE section_enrollments, sections, courses, "
            "course_teachers, schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _seed_school_with_two_teachers() -> dict[str, str]:
    """An institutional school with two teachers, each owning one
    course with one section. Three students total: one in teacher A's
    section, one in teacher B's, one in BOTH (the distinct case
    across teachers within the same school)."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="admin", name="A",
        )
        school = School(
            name=f"Lincoln {tag}",
            kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Contact",
            contact_email=f"c_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher_a = User(
            email=f"ta_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Teacher A", school_id=school.id,
        )
        teacher_b = User(
            email=f"tb_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Teacher B", school_id=school.id,
        )
        s.add_all([teacher_a, teacher_b])
        await s.flush()
        course_a = Course(name=f"Alg {tag}", subject="math", school_id=school.id)
        course_b = Course(name=f"Geo {tag}", subject="math", school_id=school.id)
        s.add_all([course_a, course_b])
        await s.flush()
        s.add_all([
            CourseTeacher(course_id=course_a.id, teacher_id=teacher_a.id, role="owner"),
            CourseTeacher(course_id=course_b.id, teacher_id=teacher_b.id, role="owner"),
        ])
        sec_a = Section(course_id=course_a.id, name="P1")
        sec_b = Section(course_id=course_b.id, name="P1")
        s.add_all([sec_a, sec_b])
        await s.flush()

        students = [
            User(
                email=f"stu_{i}_{tag}@t.com",
                password_hash=hash_password("x"),
                grade_level=8, role="student", name=f"Student {i}",
                school_id=school.id,
            )
            for i in range(3)
        ]
        s.add_all(students)
        await s.flush()
        s.add_all([
            SectionEnrollment(section_id=sec_a.id, course_id=course_a.id, student_id=students[0].id),
            SectionEnrollment(section_id=sec_b.id, course_id=course_b.id, student_id=students[1].id),
            # Student 2 → both courses
            SectionEnrollment(section_id=sec_a.id, course_id=course_a.id, student_id=students[2].id),
            SectionEnrollment(section_id=sec_b.id, course_id=course_b.id, student_id=students[2].id),
        ])
        await s.commit()
        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "school_id": str(school.id),
            "student_ids": [str(s.id) for s in students],
        }


@pytest.mark.asyncio
async def test_school_roster_lists_distinct_students_across_teachers(
    client: AsyncClient,
) -> None:
    seeded = await _seed_school_with_two_teachers()
    resp = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["school"]["id"] == seeded["school_id"]
    assert body["total_students"] == 3
    returned_ids = {s["id"] for s in body["students"]}
    assert returned_ids == set(seeded["student_ids"])


@pytest.mark.asyncio
async def test_school_roster_404_on_missing(client: AsyncClient) -> None:
    seeded = await _seed_school_with_two_teachers()
    bogus = uuid.uuid4()
    resp = await client.get(
        f"/v1/admin/schools/{bogus}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_school_roster_requires_admin(client: AsyncClient) -> None:
    seeded = await _seed_school_with_two_teachers()
    student_token = create_access_token(seeded["student_ids"][0], "student")
    resp = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}/students",
        headers=auth_headers(student_token),
    )
    assert resp.status_code == 403
