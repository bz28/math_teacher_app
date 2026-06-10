"""FERPA student-record-access audit log: end-to-end wiring.

Guards the bug where the audit-log helpers existed but were never
called and the read router was never registered (so the headline FERPA
feature was dead code). These tests prove:
1. A teacher reading one student's grades writes a StudentRecordAccessLog
   row (committed — GET handlers don't otherwise commit).
2. The admin read endpoint is registered and surfaces that row.
3. The endpoint is admin-only.
"""
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User

from .conftest import auth_headers


@pytest.fixture
async def grade_world() -> dict[str, uuid.UUID]:
    """Minimal world: a teacher on a course, a student enrolled in its
    section, and a global admin — enough to drive the per-student grades
    read and the admin audit-log query."""
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="Teach")
        student = User(email=f"s_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=8,
                       role="student", name="Stu")
        admin = User(email=f"a_{uuid.uuid4().hex[:6]}@t.com",
                     password_hash=hash_password("x"), grade_level=0,
                     role="admin", name="Admin")
        s.add_all([teacher, student, admin])
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id))

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(section_id=section.id, course_id=course.id,
                                student_id=student.id))
        await s.commit()

        return {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "admin_id": admin.id,
            "course_id": course.id,
            "section_id": section.id,
        }


@pytest.mark.asyncio
async def test_reading_student_grades_writes_audit_row(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    token = create_access_token(str(grade_world["teacher_id"]), "teacher")
    url = (
        f"/v1/teacher/courses/{grade_world['course_id']}"
        f"/sections/{grade_world['section_id']}"
        f"/students/{grade_world['student_id']}/grades"
    )
    resp = await client.get(url, headers=auth_headers(token))
    assert resp.status_code == 200, resp.text

    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(StudentRecordAccessLog).where(
                StudentRecordAccessLog.target_student_id == grade_world["student_id"]
            )
        )).scalars().all()
    assert len(rows) == 1, "exactly one access row should be logged"
    row = rows[0]
    assert row.accessor_user_id == grade_world["teacher_id"]
    assert row.accessor_role == "teacher"
    assert row.record_type == "grades"


@pytest.mark.asyncio
async def test_admin_audit_endpoint_surfaces_the_row(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    teacher_token = create_access_token(str(grade_world["teacher_id"]), "teacher")
    url = (
        f"/v1/teacher/courses/{grade_world['course_id']}"
        f"/sections/{grade_world['section_id']}"
        f"/students/{grade_world['student_id']}/grades"
    )
    await client.get(url, headers=auth_headers(teacher_token))

    admin_token = create_access_token(str(grade_world["admin_id"]), "admin")
    r = await client.get(
        "/v1/admin/audit-logs/student-access",
        params={"target_student_id": str(grade_world["student_id"])},
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] >= 1
    assert any(item["record_type"] == "grades" for item in data["entries"])


@pytest.mark.asyncio
async def test_audit_endpoint_is_admin_only(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    teacher_token = create_access_token(str(grade_world["teacher_id"]), "teacher")
    r = await client.get(
        "/v1/admin/audit-logs/student-access",
        headers=auth_headers(teacher_token),
    )
    assert r.status_code == 403
