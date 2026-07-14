"""Tests for the operator metrics on GET /v1/admin/schools.

The Schools list redesign surfaces per-school student_count,
submissions_7d, and failed_calls_24h so the operator can spot an
at-risk-yet-high-value pilot in one scan. These guard that each
subquery counts the right rows (and only those in-window).
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
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
            "TRUNCATE TABLE llm_calls, submissions, assignments, "
            "section_enrollments, sections, courses, course_teachers, "
            "schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _seed() -> dict[str, str]:
    """One institutional school with: 1 teacher, 2 enrolled students,
    2 recent submissions (in the 7d window) + 1 stale one (outside),
    and both a failed and a successful LLM call in the last 24h plus a
    failed call older than 24h (must NOT count)."""
    tag = uuid.uuid4().hex[:6]
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="A",
        )
        school = School(
            name=f"Lincoln {tag}", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Contact", contact_email=f"c_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"t_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Teacher", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name=f"Alg {tag}", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        section = Section(course_id=course.id, name="P1")
        s.add(section)
        await s.flush()
        students = [
            User(
                email=f"stu_{i}_{tag}@t.com", password_hash=hash_password("x"),
                grade_level=8, role="student", name=f"Student {i}", school_id=school.id,
            )
            for i in range(2)
        ]
        s.add_all(students)
        await s.flush()
        s.add_all([
            SectionEnrollment(section_id=section.id, course_id=course.id, student_id=st.id)
            for st in students
        ])
        assignment = Assignment(
            course_id=course.id, teacher_id=teacher.id, title="HW1",
            type="homework", unit_ids=[],
        )
        s.add(assignment)
        await s.flush()
        # Two in-window submissions + one 10 days stale (out of window).
        s.add_all([
            Submission(
                assignment_id=assignment.id, student_id=students[0].id,
                section_id=section.id, submitted_at=now - timedelta(days=1),
            ),
            Submission(
                assignment_id=assignment.id, student_id=students[1].id,
                section_id=section.id, submitted_at=now - timedelta(days=2),
            ),
        ])
        # Stale submission for student 0 on a second assignment.
        stale_assignment = Assignment(
            course_id=course.id, teacher_id=teacher.id, title="HW0",
            type="homework", unit_ids=[],
        )
        s.add(stale_assignment)
        await s.flush()
        s.add(Submission(
            assignment_id=stale_assignment.id, student_id=students[0].id,
            section_id=section.id, submitted_at=now - timedelta(days=10),
        ))

        def _call(success: bool, created_at: datetime) -> LLMCall:
            return LLMCall(
                user_id=teacher.id, school_id=school.id, function="grade",
                model="claude", input_tokens=1, output_tokens=1,
                latency_ms=1.0, cost_usd=0.01, success=success, created_at=created_at,
            )
        s.add_all([
            _call(False, now - timedelta(hours=2)),   # counts
            _call(True, now - timedelta(hours=2)),     # success — must not count
            _call(False, now - timedelta(hours=30)),   # older than 24h — must not count
        ])
        await s.commit()
        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "school_id": str(school.id),
        }


@pytest.mark.asyncio
async def test_schools_list_surfaces_operator_metrics(client: AsyncClient) -> None:
    seeded = await _seed()
    resp = await client.get("/v1/admin/schools", headers=auth_headers(seeded["admin_token"]))
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()["schools"]}
    row = rows[seeded["school_id"]]
    assert row["student_count"] == 2
    assert row["teacher_count"] == 1
    assert row["submissions_7d"] == 2  # the 10d-stale one excluded
    assert row["failed_calls_24h"] == 1  # success + >24h failure excluded


@pytest.mark.asyncio
async def test_schools_list_metrics_zero_for_empty_school(client: AsyncClient) -> None:
    """A brand-new school with no enrollment/usage reports clean zeros,
    never null — the frontend renders these as numbers."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin2_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="A",
        )
        school = School(
            name=f"Empty {tag}", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email=f"e_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.commit()
        await s.refresh(admin)
        await s.refresh(school)
        token = create_access_token(str(admin.id), "admin")
        school_id = str(school.id)

    resp = await client.get("/v1/admin/schools", headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    row = {r["id"]: r for r in resp.json()["schools"]}[school_id]
    assert row["student_count"] == 0
    assert row["submissions_7d"] == 0
    assert row["failed_calls_24h"] == 0
    assert row["last_activity_at"] is None
