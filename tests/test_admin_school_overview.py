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
from api.models.activity_log import ActivityLog
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
            "TRUNCATE TABLE activity_log, llm_calls, submission_grades, "
            "submissions, assignment_sections, assignments, sections, units, "
            "courses, schools, users RESTART IDENTITY CASCADE"
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

    All `created_at` are pinned to a moment guaranteed to be inside the
    current calendar month AND the current ISO week — typically
    `now - 1 hour`, but clamped up to the first second of the month or
    the Monday-midnight start of the week. Without the clamps, `now - 1h`
    can spill back into last month (cost-this-month returns 0) or last
    week (submissions_this_week / health.this_week return 0) when the
    test runs in the first hour of a new month or week.
    """
    await _wipe()
    now = datetime.now(UTC)
    this_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    this_week_start = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    in_window = max(now - timedelta(hours=1), this_month_start, this_week_start)

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

        # ── ActivityLog: a teacher grade.save AFTER the last submission.
        # This leaves no student submission, so it only shows up in the
        # unified last_active_at recency (not last_activity_at). +5min
        # keeps it strictly later than in_window even at a week boundary.
        s.add(ActivityLog(
            actor_user_id=teacher_a.id,
            actor_role="teacher",
            school_id=school_a.id,
            action="grade.save",
            target_type="submission",
            target_id=sub_a.id,
            performed_at=in_window + timedelta(minutes=5),
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

    # 5 calls × $1.00 = $5.00 this month. The rolling-30d window (shown
    # in the KPI strip, matching the Schools list) sees the same spend.
    assert data["cost"]["this_month"] == pytest.approx(5.0)
    assert data["cost"]["cost_30d"] == pytest.approx(5.0)

    # A submission was seeded this week, so last-activity is populated.
    assert data["last_activity_at"] is not None

    # 1 of the 5 calls was failed; counts hit both 24h and 7d windows.
    assert data["failed_calls_24h"] == 1
    assert data["failed_calls_7d"] == 1

    # Activity this week — 1 active section, 1 teacher, 1 student, 1 HW
    # published, 1 submission.
    a = data["activity"]["this_week"]
    assert a == {
        "active_classes": 1,
        "active_teachers": 1,
        "active_students": 1,
        "hws_published": 1,
        "submissions": 1,
    }


async def test_last_active_at_folds_in_activity_log(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    """`last_active_at` = max(last submission, last ActivityLog action).

    School A's seed has a teacher `grade.save` action stamped 5 minutes
    after its last submission — a teacher write that leaves no student
    submission. So `last_active_at` must be strictly newer than
    `last_activity_at` (submission-only), which is what makes the KPI
    strip's active/at-risk reflect teacher activity, not just students.
    """
    r = await client.get(
        f"/v1/admin/schools/{seeded['school_a_id']}/overview",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["last_activity_at"] is not None
    assert data["last_active_at"] is not None
    # ISO-8601 timestamps sort lexicographically, so > compares chronology.
    assert data["last_active_at"] > data["last_activity_at"]


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
    # School B seeded with 2 × $0.25 = $0.50. The cost scope itself is
    # the isolation check now that we no longer return top-spender rows.
    assert data["cost"]["this_month"] == pytest.approx(0.5)


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

    # Activity counts zero out in internal scope (no school submissions).
    a = data["activity"]["this_week"]
    assert a == {
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
