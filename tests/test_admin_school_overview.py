"""Integration tests for /v1/admin/schools/{school_id}/overview.

Seeds two schools' worth of data plus an internal (no-school) LLM
call set, then hits the endpoint to verify:

- Cost numbers reflect the seeded LLMCall sums
- Top classes / teachers reflect the join chain to Course/Section
- Cross-school isolation: school A's overview never sees school B
- Internal scope (`/internal/overview`) is_internal=true, with the
  per-school surfaces (top_spenders, integrity disposition, health)
  empty by design
- Bogus UUIDs return 404 instead of 500
- Non-admin tokens return 403

The fixture pattern mirrors `world` from conftest.py — wipe the
relevant tables, seed everything in one async session, return the
ids the tests need.
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
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    """Truncate every table the seed touches. CASCADE handles FK chains
    (sections → submissions → llm_calls etc)."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submission_grades, submissions, "
            "assignment_sections, assignments, sections, units, courses, "
            "schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


def _llm_call(
    *,
    school_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    submission_id: uuid.UUID | None,
    function: str,
    cost: float,
    created_at: datetime,
    success: bool = True,
) -> LLMCall:
    """Build an LLMCall row with sensible defaults so tests stay terse."""
    return LLMCall(
        user_id=user_id,
        school_id=school_id,
        submission_id=submission_id,
        function=function,
        model="claude-sonnet-test",
        input_tokens=100,
        output_tokens=50,
        latency_ms=1234.0,
        cost_usd=cost,
        success=success,
        retry_count=0,
        created_at=created_at,
    )


@pytest.fixture
async def seeded() -> dict[str, Any]:
    """Seed two schools + an internal user, each with a course/section/
    assignment/submission/LLM-call set. Returns the ids tests assert on.

    School A: 5 LLM calls totaling $5.00 this month, on one section/teacher.
    School B: 2 LLM calls totaling $0.50 this month — used to verify A's
        overview never includes B's spend.
    Internal: 2 LLM calls totaling $0.20, school_id=NULL.

    All `created_at` are `now - 1 hour`, which lands inside both this
    month and this week regardless of when the test runs (modulo the
    rare first-hour-of-the-month case, which is acceptable noise).
    """
    await _wipe()
    now = datetime.now(UTC)
    in_window = now - timedelta(hours=1)

    async with get_session_factory()() as s:
        # ── Admin user (no school) ──
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99,
            role="admin",
            name="Admin",
        )
        # ── Schools ──
        school_a = School(
            name="School A",
            contact_name="A Contact",
            contact_email="a@s.com",
        )
        school_b = School(
            name="School B",
            contact_name="B Contact",
            contact_email="b@s.com",
        )
        s.add_all([admin, school_a, school_b])
        await s.flush()

        # ── Teachers + students per school ──
        teacher_a = User(
            email=f"ta_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Teacher A", school_id=school_a.id,
        )
        student_a = User(
            email=f"sa_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Student A", school_id=school_a.id,
        )
        teacher_b = User(
            email=f"tb_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Teacher B", school_id=school_b.id,
        )
        student_b = User(
            email=f"sb_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Student B", school_id=school_b.id,
        )
        # Internal user — no school. Their LLM calls land in the
        # internal bucket because _log_and_persist denormalizes
        # users.school_id (here: None).
        internal_user = User(
            email=f"int_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=10,
            role="student", name="Internal", school_id=None,
        )
        s.add_all([teacher_a, student_a, teacher_b, student_b, internal_user])
        await s.flush()

        # ── Course / Unit / Section per school ──
        course_a = Course(
            school_id=school_a.id, name="Algebra A", subject="math",
        )
        course_b = Course(
            school_id=school_b.id, name="Algebra B", subject="math",
        )
        s.add_all([course_a, course_b])
        await s.flush()

        unit_a = Unit(course_id=course_a.id, name="U-A", position=0)
        unit_b = Unit(course_id=course_b.id, name="U-B", position=0)
        s.add_all([unit_a, unit_b])
        await s.flush()

        section_a = Section(course_id=course_a.id, name="Period 1")
        section_b = Section(course_id=course_b.id, name="Period 1")
        s.add_all([section_a, section_b])
        await s.flush()

        # ── Assignment + AssignmentSection (published this week) ──
        assignment_a = Assignment(
            course_id=course_a.id, unit_ids=[unit_a.id],
            teacher_id=teacher_a.id, title="HW A", type="homework",
            status="published", content={"problems": []},
        )
        assignment_b = Assignment(
            course_id=course_b.id, unit_ids=[unit_b.id],
            teacher_id=teacher_b.id, title="HW B", type="homework",
            status="published", content={"problems": []},
        )
        s.add_all([assignment_a, assignment_b])
        await s.flush()

        s.add_all([
            AssignmentSection(
                assignment_id=assignment_a.id, section_id=section_a.id,
                published_at=in_window,
            ),
            AssignmentSection(
                assignment_id=assignment_b.id, section_id=section_b.id,
                published_at=in_window,
            ),
        ])

        # ── Submissions (this week) ──
        sub_a = Submission(
            assignment_id=assignment_a.id, student_id=student_a.id,
            section_id=section_a.id, status="submitted",
            submitted_at=in_window,
        )
        sub_b = Submission(
            assignment_id=assignment_b.id, student_id=student_b.id,
            section_id=section_b.id, status="submitted",
            submitted_at=in_window,
        )
        s.add_all([sub_a, sub_b])
        await s.flush()

        # ── LLM calls ──
        # School A: 5 calls × $1.00 = $5.00, all this month.
        # One marked failed to drive failed_calls_24h = 1.
        for i in range(5):
            s.add(_llm_call(
                school_id=school_a.id, user_id=student_a.id,
                submission_id=sub_a.id, function="ai_grading",
                cost=1.0, created_at=in_window,
                success=(i != 4),
            ))
        # School B: 2 calls × $0.25 = $0.50.
        for _ in range(2):
            s.add(_llm_call(
                school_id=school_b.id, user_id=student_b.id,
                submission_id=sub_b.id, function="ai_grading",
                cost=0.25, created_at=in_window,
            ))
        # Internal bucket: 2 calls × $0.10 = $0.20, no school, no submission.
        for _ in range(2):
            s.add(_llm_call(
                school_id=None, user_id=internal_user.id,
                submission_id=None, function="image_extract",
                cost=0.10, created_at=in_window,
            ))

        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_token": create_access_token(str(student_a.id), "student"),
            "school_a_id": str(school_a.id),
            "school_b_id": str(school_b.id),
            "teacher_a_id": str(teacher_a.id),
            "section_a_id": str(section_a.id),
            "submission_a_id": str(sub_a.id),
        }


async def test_school_a_overview_reflects_seeded_data(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """Cost / top-spenders / health for School A match the seed exactly."""
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_a_id']}/overview",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["school_id"] == seeded["school_a_id"]
    assert data["school_name"] == "School A"
    assert data["is_internal"] is False

    # 5 calls × $1.00 = $5.00 this month.
    assert data["cost"]["this_month"] == pytest.approx(5.0)
    # All 5 calls share the same submission → cost-per-submission == $5.
    assert data["cost"]["cost_per_submission"] == pytest.approx(5.0)
    # by_function should have exactly one row, ai_grading, count=5.
    by_fn = data["cost"]["by_function"]
    assert len(by_fn) == 1
    assert by_fn[0]["function"] == "ai_grading"
    assert by_fn[0]["count"] == 5
    assert by_fn[0]["cost"] == pytest.approx(5.0)

    # Top classes → exactly one section with $5 spend.
    classes = data["top_spenders"]["classes"]
    assert len(classes) == 1
    assert classes[0]["section_id"] == seeded["section_a_id"]
    assert classes[0]["section_name"] == "Period 1"
    assert classes[0]["course_name"] == "Algebra A"
    assert classes[0]["cost"] == pytest.approx(5.0)

    # Top teachers → exactly Teacher A.
    teachers = data["top_spenders"]["teachers"]
    assert len(teachers) == 1
    assert teachers[0]["teacher_id"] == seeded["teacher_a_id"]
    assert teachers[0]["cost"] == pytest.approx(5.0)

    # Top submissions this week → exactly the one we seeded, with 5 calls.
    top_subs = data["top_spenders"]["submissions_this_week"]
    assert len(top_subs) == 1
    assert top_subs[0]["submission_id"] == seeded["submission_a_id"]
    assert top_subs[0]["call_count"] == 5

    # 1 of the 5 calls was failed; counts hit both 24h and 7d windows.
    assert data["quality"]["failed_calls_24h"] == 1
    assert data["quality"]["failed_calls_7d"] == 1

    # Health this week — 1 active section, 1 teacher, 1 student, 1 HW
    # published, 1 submission.
    h = data["health"]["this_week"]
    assert h == {
        "active_classes": 1,
        "active_teachers": 1,
        "active_students": 1,
        "hws_published": 1,
        "submissions": 1,
    }


async def test_cross_school_isolation(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """School B's overview must NOT include School A's $5 spend."""
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_b_id']}/overview",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["school_name"] == "School B"
    # School B seeded with 2 × $0.25 = $0.50.
    assert data["cost"]["this_month"] == pytest.approx(0.5)
    # And the only top-class/teacher should belong to School B's section.
    classes = data["top_spenders"]["classes"]
    assert len(classes) == 1
    assert classes[0]["course_name"] == "Algebra B"
    # No School A teachers/sections leaked in.
    assert all(c["section_id"] != seeded["section_a_id"] for c in classes)


async def test_internal_scope(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """`/internal/overview` returns is_internal=true and only counts
    school_id IS NULL calls. Per-school surfaces are empty by design."""
    r = await client.get(
        "/v1/admin/schools/internal/overview",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["is_internal"] is True
    assert data["school_name"] == "Internal (no-school)"
    # 2 × $0.10 = $0.20.
    assert data["cost"]["this_month"] == pytest.approx(0.2)
    # No submission_id on internal calls → 0 cost-per-submission.
    assert data["cost"]["cost_per_submission"] == pytest.approx(0.0)

    # Per-school surfaces are intentionally empty in internal scope.
    assert data["top_spenders"]["classes"] == []
    assert data["top_spenders"]["teachers"] == []
    assert data["top_spenders"]["submissions_this_week"] == []
    assert data["quality"]["integrity_disposition"] == []
    assert data["quality"]["unreadable_per_teacher"] == []
    assert data["quality"]["ai_override_rate"] is None

    # Health zeros (internal scope has no submissions).
    h = data["health"]["this_week"]
    assert h == {
        "active_classes": 0,
        "active_teachers": 0,
        "active_students": 0,
        "hws_published": 0,
        "submissions": 0,
    }


async def test_bogus_uuid_returns_404(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """A well-formed but non-existent UUID returns 404, not 500."""
    nope = str(uuid.uuid4())
    r = await client.get(
        f"/v1/admin/schools/{nope}/overview",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 404


async def test_malformed_uuid_returns_404(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """A non-UUID path segment returns 404 via our defensive UUID parse,
    not asyncpg's invalid-text-representation 500."""
    r = await client.get(
        "/v1/admin/schools/not-a-uuid/overview",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 404


async def test_non_admin_forbidden(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """A student token gets 403 from require_admin."""
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_a_id']}/overview",
        headers=auth_headers(seeded["student_token"]),
    )
    assert r.status_code == 403


async def test_no_auth_returns_401(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """No bearer token → FastAPI's HTTPBearer dependency rejects with 401."""
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_a_id']}/overview",
    )
    assert r.status_code == 401
