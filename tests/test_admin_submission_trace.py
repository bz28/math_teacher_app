"""Tests for the SubmissionTrace case-file join + session filter on
GET /v1/admin/llm-calls.

Covers:
- `submission` is null on the general list (no submission_id).
- `submission` carries the student / school / assignment identity plus the
  AI grade, integrity verdict, and teacher-action decisions when scoped to
  one submission_id.
- the `session_id` filter that powers the "View session" jump scopes the
  returned calls to a single conversational session.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.session import Session
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

pytestmark = pytest.mark.asyncio


async def _seed() -> dict[str, str]:
    """A full case file: school, student, admin, assignment, submission, its
    AI grade + integrity check, and two LLM calls (one carrying a session)."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, integrity_check_submissions, submission_grades, "
            "submissions, assignments, sections, units, courses, sessions, users, schools "
            "RESTART IDENTITY CASCADE"
        ))
        school = School(
            name="Riverside High", kind="institutional",
            contact_name="Head", contact_email="head@riverside.test",
        )
        s.add(school)
        await s.flush()

        admin = User(email=f"admin_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                     grade_level=99, role="admin", name="Admin")
        student = User(email=f"stu_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                       grade_level=9, role="student", name="Dana Lee", school_id=school.id)
        teacher = User(email=f"tea_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                       grade_level=99, role="teacher", name="Mr. Ford", school_id=school.id)
        s.add_all([admin, student, teacher])
        await s.flush()

        course = Course(school_id=school.id, name="Algebra II", subject="math")
        s.add(course)
        await s.flush()
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        section = Section(course_id=course.id, name="Period 1")
        s.add_all([unit, section])
        await s.flush()

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Quadratics HW 3", type="homework", status="published",
        )
        s.add(assignment)
        await s.flush()

        submission = Submission(
            assignment_id=assignment.id, student_id=student.id,
            section_id=section.id, status="graded",
        )
        s.add(submission)
        await s.flush()

        grade = SubmissionGrade(
            submission_id=submission.id, ai_score=82.0, final_score=90.0,
            graded_at=datetime.now(UTC), reviewed_at=datetime.now(UTC),
        )
        integrity = IntegrityCheckSubmission(
            submission_id=submission.id, status="complete",
            disposition="flag_for_review", headline="Answer memorized, method unclear",
            resolution="unresolved",
        )
        s.add_all([grade, integrity])
        await s.flush()

        chat_session = Session(
            user_id=student.id, problem="Solve x^2 - 4 = 0", problem_type="algebra",
        )
        s.add(chat_session)
        await s.flush()
        session_id = chat_session.id
        call_graded = LLMCall(
            function="ai_grading", model="claude-sonnet-4-6",
            input_tokens=10, output_tokens=20, latency_ms=100.0, cost_usd=0.01,
            submission_id=submission.id, session_id=session_id,
        )
        call_extract = LLMCall(
            function="image_extract", model="claude-sonnet-4-6",
            input_tokens=5, output_tokens=8, latency_ms=50.0, cost_usd=0.005,
            submission_id=submission.id,
        )
        s.add_all([call_graded, call_extract])
        await s.flush()

        ids = {
            "admin_id": str(admin.id),
            "student_id": str(student.id),
            "school_id": str(school.id),
            "submission_id": str(submission.id),
            "session_id": str(session_id),
        }
        await s.commit()
    return ids


async def test_general_list_has_null_submission(client: AsyncClient) -> None:
    ids = await _seed()
    token = create_access_token(ids["admin_id"], "admin")
    r = await client.get("/v1/admin/llm-calls?hours=8760", headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["submission"] is None


async def test_submission_case_file(client: AsyncClient) -> None:
    ids = await _seed()
    token = create_access_token(ids["admin_id"], "admin")
    r = await client.get(
        f"/v1/admin/llm-calls?submission_id={ids['submission_id']}&hours=8760",
        headers=auth_headers(token),
    )
    assert r.status_code == 200
    sub = r.json()["submission"]
    assert sub is not None
    # identity
    assert sub["student_name"] == "Dana Lee"
    assert sub["student_id"] == ids["student_id"]
    assert sub["school_name"] == "Riverside High"
    assert sub["school_id"] == ids["school_id"]
    assert sub["assignment_title"] == "Quadratics HW 3"
    assert sub["assignment_type"] == "homework"
    assert sub["status"] == "graded"
    # decisions
    assert sub["ai_score"] == 82.0
    assert sub["final_score"] == 90.0
    assert sub["reviewed_at"] is not None
    assert sub["integrity_disposition"] == "flag_for_review"
    assert sub["integrity_headline"] == "Answer memorized, method unclear"
    assert sub["integrity_status"] == "complete"


async def test_session_filter_scopes_calls(client: AsyncClient) -> None:
    ids = await _seed()
    token = create_access_token(ids["admin_id"], "admin")
    r = await client.get(
        f"/v1/admin/llm-calls?session_id={ids['session_id']}&hours=8760",
        headers=auth_headers(token),
    )
    assert r.status_code == 200
    body = r.json()
    # Only the one grading call carried this session_id.
    assert body["total_count"] == 1
    assert [c["function"] for c in body["calls"]] == ["ai_grading"]


async def test_bad_session_id_is_400(client: AsyncClient) -> None:
    ids = await _seed()
    token = create_access_token(ids["admin_id"], "admin")
    r = await client.get("/v1/admin/llm-calls?session_id=not-a-uuid", headers=auth_headers(token))
    assert r.status_code == 400
