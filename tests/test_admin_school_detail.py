"""Integration tests for GET /v1/admin/schools/{school_id}.

The detail endpoint returns the teacher → section → student hierarchy
that drives the SchoolDetail page. These tests pin the load-bearing
behaviours:

  * The tree groups sections under their owner teacher, and students
    under each section.
  * Per-section student_count / submitted_count are exact.
  * Section cost_30d rolls up the per-submission AI spend attributed
    via LLMCall.submission_id → submission → section.
  * A teacher's gen_cost_30d is their non-submission (authoring) spend —
    submission-tied calls are NOT double-counted there.
  * School students carry NO subscription / plan fields.
  * A student enrolled in several sections appears under each.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submission_grades, submissions, "
            "assignments, section_enrollments, sections, units, "
            "course_teachers, courses, schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


def _llm_call(
    *,
    user_id: uuid.UUID | None,
    submission_id: uuid.UUID | None,
    cost: float,
    created_at: datetime,
    function: str = "ai_grading",
) -> LLMCall:
    return LLMCall(
        user_id=user_id,
        submission_id=submission_id,
        function=function,
        model="claude-sonnet-test",
        input_tokens=100,
        output_tokens=50,
        latency_ms=1000.0,
        cost_usd=cost,
        success=True,
        retry_count=0,
        created_at=created_at,
    )


@pytest.fixture
async def seeded() -> dict[str, Any]:
    """One institutional school, two teachers each owning a course/section.

    Enrollment:
      * Section A1 (teacher Anna): stu1, stu2   → student_count 2
      * Section B1 (teacher Bob):  stu2, stu3   → student_count 2
      * stu2 sits in BOTH sections (the multi-section case)

    Submissions + grades:
      * sub1 = stu1 in A1, graded 80
      * sub2 = stu2 in A1, graded 100   → A1 submitted_count 2
      * sub3 = stu2 in B1, graded 60    → B1 submitted_count 1 (stu3 none)

    LLM spend (all inside the 30d window):
      * A1: $0.50 + $0.50 (sub1) + $0.30 (sub2) = $1.30 rolled up
      * B1: $0.20 (sub3)
      * Anna generation: $2.00 (submission_id NULL) — teacher-level only
    """
    await _wipe()
    now = datetime.now(UTC)
    recent = now - timedelta(hours=1)

    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        school = School(
            name="Lincoln High",
            kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Contact", contact_email="c@s.com",
        )
        s.add_all([admin, school])
        await s.flush()

        anna = User(
            email=f"anna_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Anna", school_id=school.id,
        )
        bob = User(
            email=f"bob_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Bob", school_id=school.id,
        )
        stu1 = User(
            email=f"s1_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Stu One", school_id=school.id,
        )
        stu2 = User(
            email=f"s2_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Stu Two", school_id=school.id,
        )
        stu3 = User(
            email=f"s3_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Stu Three", school_id=school.id,
        )
        s.add_all([anna, bob, stu1, stu2, stu3])
        await s.flush()

        course_a = Course(school_id=school.id, name="Algebra", subject="math")
        course_b = Course(school_id=school.id, name="Geometry", subject="math")
        s.add_all([course_a, course_b])
        await s.flush()
        s.add_all([
            CourseTeacher(course_id=course_a.id, teacher_id=anna.id, role="owner"),
            CourseTeacher(course_id=course_b.id, teacher_id=bob.id, role="owner"),
        ])
        unit_a = Unit(course_id=course_a.id, name="U-A", position=0)
        unit_b = Unit(course_id=course_b.id, name="U-B", position=0)
        s.add_all([unit_a, unit_b])
        sec_a = Section(course_id=course_a.id, name="Period 1")
        sec_b = Section(course_id=course_b.id, name="Period 2")
        s.add_all([sec_a, sec_b])
        await s.flush()

        s.add_all([
            SectionEnrollment(section_id=sec_a.id, course_id=course_a.id, student_id=stu1.id),
            SectionEnrollment(section_id=sec_a.id, course_id=course_a.id, student_id=stu2.id),
            SectionEnrollment(section_id=sec_b.id, course_id=course_b.id, student_id=stu2.id),
            SectionEnrollment(section_id=sec_b.id, course_id=course_b.id, student_id=stu3.id),
        ])

        asn_a = Assignment(
            course_id=course_a.id, unit_ids=[unit_a.id], teacher_id=anna.id,
            title="HW A", type="homework", status="published", content={"problems": []},
        )
        asn_b = Assignment(
            course_id=course_b.id, unit_ids=[unit_b.id], teacher_id=bob.id,
            title="HW B", type="homework", status="published", content={"problems": []},
        )
        s.add_all([asn_a, asn_b])
        await s.flush()

        sub1 = Submission(assignment_id=asn_a.id, student_id=stu1.id, section_id=sec_a.id, submitted_at=recent)
        sub2 = Submission(assignment_id=asn_a.id, student_id=stu2.id, section_id=sec_a.id, submitted_at=recent)
        sub3 = Submission(assignment_id=asn_b.id, student_id=stu2.id, section_id=sec_b.id, submitted_at=recent)
        s.add_all([sub1, sub2, sub3])
        await s.flush()

        s.add_all([
            SubmissionGrade(submission_id=sub1.id, final_score=80.0, graded_at=recent),
            SubmissionGrade(submission_id=sub2.id, final_score=100.0, graded_at=recent),
            SubmissionGrade(submission_id=sub3.id, final_score=60.0, graded_at=recent),
        ])

        # Per-submission spend → rolls up to the section.
        s.add_all([
            _llm_call(user_id=stu1.id, submission_id=sub1.id, cost=0.50, created_at=recent),
            _llm_call(user_id=stu1.id, submission_id=sub1.id, cost=0.50, created_at=recent, function="image_extract"),
            _llm_call(user_id=stu2.id, submission_id=sub2.id, cost=0.30, created_at=recent),
            _llm_call(user_id=stu2.id, submission_id=sub3.id, cost=0.20, created_at=recent),
        ])
        # Anna's authoring/generation spend — no submission → teacher level.
        s.add(_llm_call(
            user_id=anna.id, submission_id=None, cost=2.00,
            created_at=recent, function="generate_questions",
        ))

        await s.commit()
        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_token": create_access_token(str(stu1.id), "student"),
            "school_id": str(school.id),
            "anna_id": str(anna.id),
            "bob_id": str(bob.id),
            "stu2_id": str(stu2.id),
            "stu3_id": str(stu3.id),
        }


async def test_detail_returns_teacher_section_student_tree(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()

    # Teachers come back ordered by name: Anna, Bob.
    names = [t["name"] for t in data["teachers"]]
    assert names == ["Anna", "Bob"]

    anna = data["teachers"][0]
    bob = data["teachers"][1]

    # Each teacher owns exactly one section.
    assert len(anna["sections"]) == 1
    assert len(bob["sections"]) == 1
    sec_a = anna["sections"][0]
    sec_b = bob["sections"][0]

    # Per-section student counts (distinct enrollments).
    assert sec_a["student_count"] == 2
    assert sec_b["student_count"] == 2

    # Distinct submitters per section.
    assert sec_a["submitted_count"] == 2  # stu1 + stu2
    assert sec_b["submitted_count"] == 1  # only stu2 submitted


async def test_section_cost_rolls_up_via_submission_id(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    data = r.json()
    sec_a = data["teachers"][0]["sections"][0]
    sec_b = data["teachers"][1]["sections"][0]

    # A1: $0.50 + $0.50 + $0.30 = $1.30. B1: $0.20.
    assert sec_a["cost_30d"] == pytest.approx(1.30)
    assert sec_b["cost_30d"] == pytest.approx(0.20)


async def test_generation_cost_stays_at_teacher_level(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    data = r.json()
    anna, bob = data["teachers"]

    # Anna's one non-submission call = $2.00; it must NOT leak into a
    # section cost, and it's the only thing in her generation bucket.
    assert anna["gen_cost_30d"] == pytest.approx(2.00)
    assert anna["gen_call_count_30d"] == 1
    # Bob authored nothing.
    assert bob["gen_cost_30d"] == pytest.approx(0.0)
    assert bob["gen_call_count_30d"] == 0


async def test_students_have_no_plan_and_carry_grades(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    data = r.json()
    sec_a = data["teachers"][0]["sections"][0]

    for stu in sec_a["students"]:
        # School students have NO individual plan — the field is gone.
        assert "subscription_tier" not in stu
        assert "subscription_status" not in stu
        assert "plan" not in stu

    by_id = {s["id"]: s for s in sec_a["students"]}
    # stu2's A1 grade is 100 (its single graded submission in A1).
    assert by_id[seeded["stu2_id"]]["avg_score"] == pytest.approx(100.0)
    assert by_id[seeded["stu2_id"]]["submission_count"] == 1


async def test_multi_section_student_appears_under_each(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    data = r.json()
    sec_a = data["teachers"][0]["sections"][0]
    sec_b = data["teachers"][1]["sections"][0]

    a_ids = {s["id"] for s in sec_a["students"]}
    b_ids = {s["id"] for s in sec_b["students"]}
    # stu2 is enrolled in both sections → appears under each.
    assert seeded["stu2_id"] in a_ids
    assert seeded["stu2_id"] in b_ids

    # In B1, stu3 never submitted: 0 submissions, no grade.
    b_by_id = {s["id"]: s for s in sec_b["students"]}
    assert b_by_id[seeded["stu3_id"]]["submission_count"] == 0
    assert b_by_id[seeded["stu3_id"]]["avg_score"] is None


async def test_detail_404_on_missing(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{uuid.uuid4()}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 404


async def test_detail_requires_admin(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_id']}",
        headers=auth_headers(seeded["student_token"]),
    )
    assert r.status_code == 403
