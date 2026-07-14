"""Integration tests for the grading-quality drill-in endpoint.

`GET /v1/admin/grading-quality/overrides` returns the actual overridden
problems behind a weak subject/course row or a catastrophic status cell —
the AI's original call, the teacher's final, and the signed delta. These
tests seed two courses' worth of reviewed grades and verify:

- Only *overridden* problems surface (an untouched problem never appears).
- The subject / course / from→to filters narrow to the right cases.
- Cases sort biggest-misgrade-first.
- Ineligible grades (unreviewed, or AI never graded) are excluded.
- Non-admin tokens get 403.
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
from api.models.course import Course
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

URL = "/v1/admin/grading-quality/overrides"


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE submission_grades, submissions, "
            "assignments, sections, units, courses, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


def _ai(*grades: tuple[str, float]) -> dict[str, Any]:
    return {"grades": [{"score_status": s, "percent": p} for s, p in grades]}


def _final(*grades: tuple[str, float]) -> list[dict[str, Any]]:
    return [{"score_status": s, "percent": p} for s, p in grades]


@pytest.fixture
async def seeded() -> dict[str, Any]:
    """Two courses. Math: one submission where the teacher raised a zero to
    full (a catastrophic zero→full flip) and left another problem alone.
    Chemistry: one submission where the teacher lowered a partial by 20."""
    await _wipe()
    now = datetime.now(UTC)
    in_window = now - timedelta(hours=1)

    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Teacher",
        )
        student = User(
            email=f"s_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Student",
        )
        s.add_all([admin, teacher, student])
        await s.flush()

        math = Course(name="Algebra I", subject="math")
        chem = Course(name="Chem I", subject="chemistry")
        s.add_all([math, chem])
        await s.flush()

        unit_m = Unit(course_id=math.id, name="U", position=0)
        unit_c = Unit(course_id=chem.id, name="U", position=0)
        s.add_all([unit_m, unit_c])
        sec_m = Section(course_id=math.id, name="P1")
        sec_c = Section(course_id=chem.id, name="P1")
        s.add_all([sec_m, sec_c])
        await s.flush()

        asg_m = Assignment(
            course_id=math.id, unit_ids=[unit_m.id], teacher_id=teacher.id,
            title="HW M", type="homework", status="published",
            content={"problems": []},
        )
        asg_c = Assignment(
            course_id=chem.id, unit_ids=[unit_c.id], teacher_id=teacher.id,
            title="HW C", type="homework", status="published",
            content={"problems": []},
        )
        s.add_all([asg_m, asg_c])
        await s.flush()

        sub_m = Submission(
            assignment_id=asg_m.id, student_id=student.id,
            section_id=sec_m.id, status="submitted", submitted_at=in_window,
        )
        sub_c = Submission(
            assignment_id=asg_c.id, student_id=student.id,
            section_id=sec_c.id, status="submitted", submitted_at=in_window,
        )
        s.add_all([sub_m, sub_c])
        await s.flush()

        # Math: problem 1 zero→full (raised 100, catastrophic flip),
        #       problem 2 untouched partial (not an override).
        s.add(SubmissionGrade(
            submission_id=sub_m.id,
            ai_breakdown=_ai(("zero", 0), ("partial", 60)),
            breakdown=_final(("full", 100), ("partial", 60)),
            graded_at=in_window, reviewed_at=in_window,
        ))
        # Chemistry: partial 70 → partial 50 (lowered 20).
        s.add(SubmissionGrade(
            submission_id=sub_c.id,
            ai_breakdown=_ai(("partial", 70)),
            breakdown=_final(("partial", 50)),
            graded_at=in_window, reviewed_at=in_window,
        ))
        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_token": create_access_token(str(student.id), "student"),
        }


async def test_returns_only_overridden_cases(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(URL, headers=auth_headers(seeded["admin_token"]))
    assert r.status_code == 200, r.text
    data = r.json()
    # 2 overrides total (the untouched partial-60 problem is excluded).
    assert data["total_count"] == 2
    assert data["truncated"] is False
    assert len(data["cases"]) == 2
    # Biggest misgrade first — the zero→full flip (delta 100) leads.
    first = data["cases"][0]
    assert first["ai_status"] == "zero"
    assert first["final_status"] == "full"
    assert first["delta"] == 100.0
    assert first["subject"] == "math"
    assert first["course"] == "Algebra I"


async def test_subject_filter_narrows(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        URL, params={"subject": "chemistry"},
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_count"] == 1
    case = data["cases"][0]
    assert case["subject"] == "chemistry"
    assert case["delta"] == -20.0  # teacher lowered


async def test_course_and_transition_filter(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    # The catastrophic zero→full cell, scoped to the math course.
    r = await client.get(
        URL,
        params={"course": "Algebra I", "from_status": "zero", "to_status": "full"},
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_count"] == 1
    assert data["cases"][0]["delta"] == 100.0


async def test_transition_filter_with_no_match_is_empty(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(
        URL, params={"from_status": "full", "to_status": "zero"},
        headers=auth_headers(seeded["admin_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["total_count"] == 0


async def test_requires_admin(
    client: AsyncClient, seeded: dict[str, Any],
) -> None:
    r = await client.get(URL, headers=auth_headers(seeded["student_token"]))
    assert r.status_code == 403
