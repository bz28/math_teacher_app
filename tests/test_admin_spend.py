"""GET /v1/admin/spend — what we paid, where it went, and where the month
is heading.

The numbers here go in front of investors and districts, so the tests are
about not misstating spend:

- internal calls and teachers' preview-as-student work are out unless
  asked for — neither is customer usage
- teacher and student rows read the one whose-call rule, and what no
  teacher owns is a row of its own rather than vanishing
- the trend keeps empty buckets, the month and projection use one
  calendar, and the projection's range comes from real full weeks
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
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.user import User
from api.routes.admin_spend import spend_headline
from tests.conftest import auth_headers

_RECENT = datetime.now(UTC) - timedelta(hours=1)


class _World:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


def _user(role: str, school: School | None, **kw: Any) -> User:
    return User(
        email=f"{role}_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
        grade_level=10, role=role, name=kw.pop("name", role.title()),
        school_id=school.id if school else None, **kw,
    )


def _call(cost: float, **kw: Any) -> LLMCall:
    return LLMCall(
        function=kw.pop("function", "ai_grading"), model=kw.pop("model", "claude-opus-5-5"),
        input_tokens=100, output_tokens=50, latency_ms=10.0, cost_usd=cost,
        success=True, created_at=kw.pop("created_at", _RECENT), **kw,
    )


async def _seed() -> _World:
    """Two schools; a student's graded homework; a teacher's own call; an
    admin's internal call; a teacher's preview student."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submissions, assignments, sections, "
            "courses, schools, users RESTART IDENTITY CASCADE",
        ))
        radnor = School(name="Radnor", contact_name="H", contact_email="h@r.com")
        lower = School(name="Lower Merion", contact_name="L", contact_email="l@m.com")
        s.add_all([radnor, lower])
        await s.flush()
        admin = _user("admin", None)
        teacher = _user("teacher", radnor, name="Ms T")
        student = _user("student", radnor, name="Sam")
        other = _user("student", lower, name="Olu")
        preview = _user("student", radnor, name="Preview", is_preview=True)
        s.add_all([admin, teacher, student, other, preview])
        await s.flush()
        preview.preview_owner_id = teacher.id
        course = Course(school_id=radnor.id, name="Alg", subject="math")
        s.add(course)
        await s.flush()
        section = Section(course_id=course.id, name="P1")
        s.add(section)
        await s.flush()
        hw = Assignment(
            course_id=course.id, teacher_id=teacher.id, title="HW", type="homework",
            total_points=10,
        )
        s.add(hw)
        await s.flush()
        sub = Submission(
            assignment_id=hw.id, student_id=student.id, section_id=section.id,
            status="submitted", submitted_at=_RECENT,
        )
        preview_sub = Submission(
            assignment_id=hw.id, student_id=preview.id, section_id=section.id,
            status="submitted", submitted_at=_RECENT,
        )
        s.add_all([sub, preview_sub])
        await s.flush()
        s.add_all([
            # Sam's homework graded: counts for Sam AND Ms T.
            _call(4.0, function="ai_grading", school_id=radnor.id,
                  user_id=student.id, submission_id=sub.id),
            # Ms T's own generation call.
            _call(1.0, function="generate_questions", model="claude-sonnet-4-6",
                  school_id=radnor.id, user_id=teacher.id),
            # A Lower Merion student's tutoring: no Radnor teacher owns it.
            _call(2.0, function="step_chat", model="claude-sonnet-4-6",
                  school_id=lower.id, user_id=other.id),
            # Internal: an admin's call, stamped with no school.
            _call(8.0, function="bank_chat", user_id=admin.id),
            # Preview-as-student: real rows, not customer usage.
            _call(16.0, function="ai_grading", school_id=radnor.id,
                  user_id=preview.id, submission_id=preview_sub.id),
        ])
        await s.commit()
        return _World(
            admin_id=str(admin.id), teacher_id=str(teacher.id),
            student_id=str(student.id), radnor_id=str(radnor.id),
            lower_id=str(lower.id),
        )


async def _get(client: AsyncClient, w: _World, **params: Any) -> dict[str, Any]:
    r = await client.get(
        "/v1/admin/spend", params=params,
        headers=auth_headers(create_access_token(w.admin_id, "admin")),
    )
    assert r.status_code == 200, r.text
    return r.json()


def _rows(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["label"]: r for r in body["rows"]}


async def test_internal_and_preview_are_left_out_by_default(client: AsyncClient) -> None:
    w = await _seed()
    body = await _get(client, w)
    assert body["total_cost"] == pytest.approx(7.0)  # 4 + 1 + 2
    assert body["headline"]["cost_30d"] == pytest.approx(7.0)
    assert sum(p["cost"] for p in body["series"]) == pytest.approx(7.0)

    everything = await _get(client, w, include_internal=True)
    assert everything["total_cost"] == pytest.approx(31.0)


async def test_function_rows_carry_share_and_cost_per_call(client: AsyncClient) -> None:
    w = await _seed()
    rows = _rows(await _get(client, w, group_by="function"))
    assert rows["ai_grading"]["cost"] == pytest.approx(4.0)
    assert rows["ai_grading"]["share"] == pytest.approx(4 / 7, abs=1e-4)
    assert rows["ai_grading"]["cost_per_call"] == pytest.approx(4.0)
    assert list(rows) == ["ai_grading", "step_chat", "generate_questions"]


async def test_school_rows_and_the_concentration_note(client: AsyncClient) -> None:
    w = await _seed()
    body = await _get(client, w, group_by="school")
    rows = _rows(body)
    assert rows["Radnor"]["key"] == w.radnor_id
    assert rows["Radnor"]["cost"] == pytest.approx(5.0)
    assert rows["Lower Merion"]["cost"] == pytest.approx(2.0)
    assert "Internal" not in rows
    assert body["concentration"] == {
        "schools_with_spend": 2,
        "top_school_id": w.radnor_id,
        "top_school_name": "Radnor",
        "top_school_share": pytest.approx(5 / 7, abs=1e-4),
    }


async def test_teacher_rows_read_the_whose_call_rule(client: AsyncClient) -> None:
    """Ms T owns her own call and her student's graded homework; the Lower
    Merion tutoring call is no teacher's and is its own row."""
    w = await _seed()
    rows = _rows(await _get(client, w, group_by="teacher"))
    assert rows["Ms T"]["key"] == w.teacher_id
    assert rows["Ms T"]["cost"] == pytest.approx(5.0)
    assert rows["not tied to a teacher"]["key"] is None
    assert rows["not tied to a teacher"]["cost"] == pytest.approx(2.0)


async def test_student_rows_leave_out_preview_students(client: AsyncClient) -> None:
    w = await _seed()
    rows = _rows(await _get(client, w, group_by="student"))
    assert rows["Sam"]["cost"] == pytest.approx(4.0)
    assert rows["Olu"]["cost"] == pytest.approx(2.0)
    assert "Preview" not in rows
    assert rows["not tied to a student"]["cost"] == pytest.approx(1.0)


async def test_school_scope(client: AsyncClient) -> None:
    w = await _seed()
    body = await _get(client, w, school_id=w.lower_id, group_by="model")
    assert body["total_cost"] == pytest.approx(2.0)
    assert _rows(body)["claude-sonnet-4-6"]["calls"] == 1


async def test_series_keeps_empty_buckets_and_ends_with_the_partial_one(
    client: AsyncClient,
) -> None:
    w = await _seed()
    for bucket, periods in (("day", 30), ("week", 12), ("month", 6)):
        series = (await _get(client, w, bucket=bucket))["series"]
        assert len(series) == periods
        assert series[-1]["partial"] is True
        assert all(not p["partial"] for p in series[:-1])
        # The hour-old calls land in one bucket (the current one, or the
        # one before it just after midnight UTC); every other is a zero.
        assert sum(p["cost"] for p in series) == pytest.approx(7.0)
        assert [p["cost"] for p in series if p["cost"]] == [pytest.approx(7.0)]


async def test_invalid_input_is_a_400_or_422(client: AsyncClient) -> None:
    w = await _seed()
    token = create_access_token(w.admin_id, "admin")
    for params in ({"school_id": "nope"}, {"group_by": "planet"}, {"bucket": "year"}):
        r = await client.get("/v1/admin/spend", params=params, headers=auth_headers(token))
        assert r.status_code in (400, 422), params


async def test_requires_admin(client: AsyncClient) -> None:
    w = await _seed()
    r = await client.get(
        "/v1/admin/spend", headers=auth_headers(create_access_token(w.teacher_id, "teacher")),
    )
    assert r.status_code == 403


# --------------------------------------------------------------------------
# The headline, on a fixed clock
# --------------------------------------------------------------------------

async def test_month_projection_and_its_range_from_full_weeks() -> None:
    """Thursday 26 Nov 2026, noon: $24 so far this month over 25.5 days. A
    quiet full week still counts once spend has started — it is the low
    end of the range."""
    now = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE llm_calls RESTART IDENTITY CASCADE"))
        s.add_all([
            _call(5.0, created_at=datetime(2026, 10, 20, tzinfo=UTC)),  # last month
            _call(7.0, created_at=datetime(2026, 11, 3, tzinfo=UTC)),   # wk of 2 Nov
            _call(14.0, created_at=datetime(2026, 11, 10, tzinfo=UTC)),  # wk of 9 Nov
            # wk of 16 Nov: nothing.
            _call(3.0, created_at=datetime(2026, 11, 24, tzinfo=UTC)),  # this week
        ])
        await s.commit()
        h = await spend_headline(s, [], now)

    elapsed = 25.5
    assert h["month_start"] == "2026-11-01"
    assert h["this_month"] == pytest.approx(24.0)
    assert h["last_month"] == pytest.approx(5.0)
    assert h["projected_month_end"] == pytest.approx(24.0 / elapsed * 30, abs=1e-3)
    # wk of 19 Oct had $5 too: spend starts there, so 5 full weeks count:
    # 19 Oct $5, 26 Oct $0, 2 Nov $7, 9 Nov $14, 16 Nov $0.
    assert h["range_weeks"] == 5
    remaining_weeks = 4.5 / 7
    assert h["projected_low"] == pytest.approx(24.0, abs=1e-3)
    assert h["projected_high"] == pytest.approx(24.0 + 14.0 * remaining_weeks, abs=1e-3)
    assert h["projected_low"] <= h["projected_month_end"] <= h["projected_high"]
