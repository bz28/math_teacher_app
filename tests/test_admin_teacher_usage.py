"""Tests for the rich teacher-usage rollup on GET
/v1/admin/users/{teacher_id}/students — the header KPI strip + section
enrichment powering the redesigned TeacherDetail page.

Covers the aggregations the founder scans:
- homeworks / practice / published / problems-per-homework from Assignment
- submissions received / graded / students reached from Submission+Grade
- generations count from QuestionBankGenerationJob
- creation cadence (homeworks/week + last created)
- per-section student_count + last_activity, student section membership
- school breadcrumb context (kind) + teacher last_active_at
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.audit_log import record_activity
from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.middleware.auth import CurrentUser
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankGenerationJob
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def _truncate() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE section_enrollments, submissions, submission_grades, "
            "assignments, question_bank_generation_jobs, sections, units, courses, "
            "course_teachers, activity_log, schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _seed() -> dict[str, str]:
    """Indie teacher with a section (2 students), 2 homeworks (3 + 5
    problems; one published), 1 practice set, 2 submissions (one graded),
    and 1 generation job."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="Admin",
        )
        school = School(
            name=f"School {tag}", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="C", contact_email=f"c_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"teacher_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Teacher", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name=f"Algebra {tag}", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        section = Section(course_id=course.id, name="Period 1")
        s.add_all([unit, section])
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

        hw1 = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 1", type="homework", status="published",
            content={"problem_ids": ["a", "b", "c"]},
        )
        hw2 = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 2", type="homework", status="draft",
            content={"problem_ids": ["a", "b", "c", "d", "e"]},
        )
        practice = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Practice", type="practice", status="draft",
            content={"problem_ids": ["a"]},
        )
        s.add_all([hw1, hw2, practice])
        await s.flush()

        sub0 = Submission(
            assignment_id=hw1.id, student_id=students[0].id, section_id=section.id,
        )
        sub1 = Submission(
            assignment_id=hw1.id, student_id=students[1].id, section_id=section.id,
        )
        s.add_all([sub0, sub1])
        await s.flush()
        # One graded submission (graded_at stamped); the other ungraded.
        s.add(SubmissionGrade(
            submission_id=sub0.id, final_score=0.9, graded_at=datetime.now(UTC),
        ))
        s.add(QuestionBankGenerationJob(
            course_id=course.id, unit_id=unit.id, originating_assignment_id=hw1.id,
            created_by_id=teacher.id, requested_count=5, produced_count=5, status="done",
        ))
        await s.commit()

        # A teacher action drives the header "last active" verdict.
        await record_activity(
            s,
            CurrentUser(user_id=teacher.id, role="teacher", name="Teacher"),
            "assignment.publish", "assignment", hw1.id, {"title": "HW 1"},
        )
        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "teacher_id": str(teacher.id),
            "school_id": str(school.id),
            "section_id": str(section.id),
            "student_ids": [str(st.id) for st in students],
        }


@pytest.mark.asyncio
async def test_usage_rollup(client: AsyncClient) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/users/{seeded['teacher_id']}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    u = resp.json()["usage"]
    assert u["homeworks_created"] == 2
    assert u["practice_sets"] == 1
    assert u["published"] == 1
    assert u["problems_per_homework"] == 4.0  # (3 + 5) / 2
    assert u["submissions_received"] == 2
    assert u["graded"] == 1
    assert u["students_reached"] == 2
    assert u["generations"] == 1
    assert u["homeworks_per_week"] is not None and u["homeworks_per_week"] > 0
    assert u["last_created_at"] is not None


@pytest.mark.asyncio
async def test_header_context(client: AsyncClient) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/users/{seeded['teacher_id']}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    t = resp.json()["teacher"]
    # School breadcrumb context — indie teacher's synthetic school.
    assert t["school"] is not None
    assert t["school"]["id"] == seeded["school_id"]
    assert t["school"]["kind"] == SCHOOL_KIND_INDIVIDUAL
    # Teacher recency comes from ActivityLog, not sessions.
    assert t["last_active_at"] is not None


@pytest.mark.asyncio
async def test_section_and_student_enrichment(client: AsyncClient) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/users/{seeded['teacher_id']}/students",
        headers=auth_headers(seeded["admin_token"]),
    )
    body = resp.json()
    section = body["sections"][0]
    assert section["id"] == seeded["section_id"]
    assert section["student_count"] == 2
    # Both students submitted to hw1 in this section → last activity set.
    assert section["last_activity_at"] is not None
    # Every student carries the section(s) they belong to for the
    # click-to-filter roster interaction.
    for stu in body["students"]:
        assert seeded["section_id"] in stu["section_ids"]


@pytest.mark.asyncio
async def test_empty_teacher_usage_is_zeroed(client: AsyncClient) -> None:
    """A brand-new teacher with no assignments returns clean zeros, not
    nulls or errors — the KPI strip must render for the empty case."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="Admin",
        )
        school = School(
            name=f"School {tag}", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="C", contact_email=f"c_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()
        teacher = User(
            email=f"teacher_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Teacher", school_id=school.id,
        )
        s.add(teacher)
        await s.commit()
        admin_token = create_access_token(str(admin.id), "admin")
        teacher_id = str(teacher.id)

    resp = await client.get(
        f"/v1/admin/users/{teacher_id}/students",
        headers=auth_headers(admin_token),
    )
    assert resp.status_code == 200, resp.text
    u = resp.json()["usage"]
    assert u["homeworks_created"] == 0
    assert u["practice_sets"] == 0
    assert u["problems_per_homework"] is None
    assert u["homeworks_per_week"] is None
    assert u["last_created_at"] is None
    assert u["students_reached"] == 0
    assert u["generations"] == 0
