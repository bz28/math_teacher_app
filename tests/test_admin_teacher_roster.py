"""Tests for GET /v1/admin/users/{teacher_id}/students — the per-teacher
student roster drill-in.

Covers:
- Indie teacher's roster lists their enrolled students
- Institutional teacher's roster works the same way
- Distinct rows (one row per student even if enrolled in multiple of
  the teacher's sections)
- 404 when the id is missing or refers to a non-teacher
- Non-admin caller gets 403
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INDIVIDUAL, SCHOOL_KIND_INSTITUTIONAL, School
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


async def _seed_classroom(*, school_kind: str) -> dict[str, str]:
    """Seed an admin + teacher (linked to a school of the given kind) +
    two courses owned by the same teacher + one section in each + 3
    distinct students. Student #1 is enrolled in BOTH sections (across
    the two courses) to exercise the distinct() in the query — the
    section_enrollments uniqueness constraint blocks two enrollments
    in the same course, so duplication has to come via separate
    courses owned by the same teacher.
    """
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="admin", name="Admin",
        )
        school = School(
            name=f"School {tag}",
            kind=school_kind,
            contact_name="Contact",
            contact_email=f"c_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"teacher_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Teacher",
            school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course_a = Course(name=f"Algebra {tag}", subject="math", school_id=school.id)
        course_b = Course(name=f"Geometry {tag}", subject="math", school_id=school.id)
        s.add_all([course_a, course_b])
        await s.flush()
        s.add_all([
            CourseTeacher(course_id=course_a.id, teacher_id=teacher.id, role="owner"),
            CourseTeacher(course_id=course_b.id, teacher_id=teacher.id, role="owner"),
        ])
        section_a = Section(course_id=course_a.id, name="Period 1")
        section_b = Section(course_id=course_b.id, name="Period 1")
        s.add_all([section_a, section_b])
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
            # Student 0 → both courses (duplication case for distinct())
            SectionEnrollment(section_id=section_a.id, course_id=course_a.id, student_id=students[0].id),
            SectionEnrollment(section_id=section_b.id, course_id=course_b.id, student_id=students[0].id),
            # Student 1 → only course A
            SectionEnrollment(section_id=section_a.id, course_id=course_a.id, student_id=students[1].id),
            # Student 2 → only course B
            SectionEnrollment(section_id=section_b.id, course_id=course_b.id, student_id=students[2].id),
        ])
        await s.commit()
        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "teacher_id": str(teacher.id),
            "student_ids": [str(stu.id) for stu in students],
        }


@pytest.mark.asyncio
async def test_indie_teacher_roster_lists_enrolled_students(
    client: AsyncClient,
) -> None:
    seeded = await _seed_classroom(school_kind=SCHOOL_KIND_INDIVIDUAL)
    resp = await client.get(
        f"/v1/admin/users/{seeded['teacher_id']}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["teacher"]["id"] == seeded["teacher_id"]
    assert body["total_students"] == 3
    returned_ids = {s["id"] for s in body["students"]}
    assert returned_ids == set(seeded["student_ids"])
    # Two sections seeded (one per course); both present.
    assert len(body["sections"]) == 2

    # Student 0 was enrolled across two of the teacher's courses —
    # they appear exactly once in the roster (distinct() guard).
    enrolled_twice_id = seeded["student_ids"][0]
    assert sum(1 for s in body["students"] if s["id"] == enrolled_twice_id) == 1


@pytest.mark.asyncio
async def test_institutional_teacher_roster_works_the_same(
    client: AsyncClient,
) -> None:
    seeded = await _seed_classroom(school_kind=SCHOOL_KIND_INSTITUTIONAL)
    resp = await client.get(
        f"/v1/admin/users/{seeded['teacher_id']}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_students"] == 3


@pytest.mark.asyncio
async def test_roster_404_on_non_teacher(client: AsyncClient) -> None:
    seeded = await _seed_classroom(school_kind=SCHOOL_KIND_INDIVIDUAL)
    # A student id passed where a teacher is expected.
    student_id = seeded["student_ids"][0]
    resp = await client.get(
        f"/v1/admin/users/{student_id}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_roster_404_on_missing_id(client: AsyncClient) -> None:
    seeded = await _seed_classroom(school_kind=SCHOOL_KIND_INDIVIDUAL)
    bogus = uuid.uuid4()
    resp = await client.get(
        f"/v1/admin/users/{bogus}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_roster_requires_admin(client: AsyncClient) -> None:
    seeded = await _seed_classroom(school_kind=SCHOOL_KIND_INDIVIDUAL)
    # Use a student token instead of admin.
    student_token = create_access_token(seeded["student_ids"][0], "student")
    resp = await client.get(
        f"/v1/admin/users/{seeded['teacher_id']}/students",
        headers=auth_headers(student_token),
    )
    assert resp.status_code == 403
