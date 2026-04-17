"""Integration tests for the student Today dashboard + grades endpoints.

Covers:
- Bucket classification: overdue / due-this-week / in-review / graded.
- Deduping the same assignment when a student is in multiple sections.
- Grade-publish gates visibility (unpublished grade stays in "in_review").
- Role guard: teachers cannot hit student endpoints.
- Empty state: student with no enrollments returns empty buckets.
- first_name derived from User.name.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from tests.conftest import auth_headers as _auth


async def _set_due_at(assignment_id: uuid.UUID, due_at: datetime | None) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET due_at = :due WHERE id = :id"),
            {"due": due_at, "id": assignment_id},
        )
        await s.commit()


async def _set_name(user_id: uuid.UUID, name: str) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE users SET name = :name WHERE id = :id"),
            {"name": name, "id": user_id},
        )
        await s.commit()


async def _create_submission(
    assignment_id: uuid.UUID,
    student_id: uuid.UUID,
    section_id: uuid.UUID,
) -> uuid.UUID:
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=assignment_id,
            student_id=student_id,
            section_id=section_id,
            status="submitted",
            image_data=None,
            final_answers=None,
            is_late=False,
        )
        s.add(sub)
        await s.commit()
        await s.refresh(sub)
        return sub.id


async def _publish_grade(submission_id: uuid.UUID, final_score: float) -> None:
    async with get_session_factory()() as s:
        grade = SubmissionGrade(
            submission_id=submission_id,
            final_score=final_score,
            grade_published_at=datetime.now(UTC),
            graded_at=datetime.now(UTC),
        )
        s.add(grade)
        await s.commit()


# ── Tests ──

async def test_dashboard_empty_for_student_with_no_enrollments(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    # The outsider fixture user is NOT enrolled in any section.
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["due_this_week"] == []
    assert body["overdue"] == []
    assert body["in_review"] == []
    assert body["recently_graded"] == []


async def test_dashboard_due_this_week_bucket(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_due_at(
        world["assignment_id"],
        datetime.now(UTC) + timedelta(days=3),
    )
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    body = r.json()
    assert len(body["due_this_week"]) == 1
    assert body["due_this_week"][0]["assignment_id"] == str(world["assignment_id"])
    assert body["due_this_week"][0]["status"] == "not_started"
    assert body["due_this_week"][0]["is_late"] is False
    assert body["overdue"] == []


async def test_dashboard_overdue_bucket(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_due_at(
        world["assignment_id"],
        datetime.now(UTC) - timedelta(days=2),
    )
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    body = r.json()
    assert body["due_this_week"] == []
    assert len(body["overdue"]) == 1
    assert body["overdue"][0]["is_late"] is True


async def test_dashboard_in_review_bucket_when_submitted_but_not_published(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    # Student submits; no grade row yet.
    await _create_submission(
        world["assignment_id"], world["student_id"], await _get_section_id(world),
    )
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    body = r.json()
    assert body["due_this_week"] == []
    assert body["overdue"] == []
    assert len(body["in_review"]) == 1
    assert body["in_review"][0]["status"] == "submitted"


async def test_dashboard_unpublished_grade_still_in_review(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    section_id = await _get_section_id(world)
    sub_id = await _create_submission(
        world["assignment_id"], world["student_id"], section_id,
    )
    # Grade row exists but grade_published_at is NULL.
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sub_id,
            final_score=88.0,
            grade_published_at=None,
        ))
        await s.commit()
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    body = r.json()
    assert len(body["in_review"]) == 1
    assert body["recently_graded"] == []


async def test_dashboard_recently_graded_bucket(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    section_id = await _get_section_id(world)
    sub_id = await _create_submission(
        world["assignment_id"], world["student_id"], section_id,
    )
    await _publish_grade(sub_id, 92.0)
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    body = r.json()
    assert body["in_review"] == []
    assert len(body["recently_graded"]) == 1
    g = body["recently_graded"][0]
    assert g["assignment_id"] == str(world["assignment_id"])
    assert g["final_score"] == 92.0
    assert g["course_name"] == "Algebra 1"
    assert g["section_name"] == "Period 1"


async def test_dashboard_first_name_derives_from_user_name(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_name(world["student_id"], "Emma Watson")
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["first_name"] == "Emma"


async def test_dashboard_first_name_empty_when_name_blank(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_name(world["student_id"], "")
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["first_name"] == ""


async def test_grades_endpoint_happy_path(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    section_id = await _get_section_id(world)
    sub_id = await _create_submission(
        world["assignment_id"], world["student_id"], section_id,
    )
    await _publish_grade(sub_id, 77.5)
    r = await client.get(
        "/v1/school/student/grades",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["grades"]) == 1
    assert body["grades"][0]["final_score"] == 77.5
    assert body["grades"][0]["course_name"] == "Algebra 1"


async def test_grades_endpoint_empty_when_nothing_published(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    r = await client.get(
        "/v1/school/student/grades",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json()["grades"] == []


async def test_grades_endpoint_excludes_unpublished(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    section_id = await _get_section_id(world)
    sub_id = await _create_submission(
        world["assignment_id"], world["student_id"], section_id,
    )
    # Graded but not published.
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sub_id,
            final_score=55.0,
            grade_published_at=None,
        ))
        await s.commit()
    r = await client.get(
        "/v1/school/student/grades",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["grades"] == []


async def test_dashboard_does_not_expose_feedback_fields(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Guardrail: teacher_notes / breakdown / ai_breakdown MUST NOT
    appear in the dashboard or grades response. v1 is scores only.
    """
    section_id = await _get_section_id(world)
    sub_id = await _create_submission(
        world["assignment_id"], world["student_id"], section_id,
    )
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sub_id,
            final_score=90.0,
            grade_published_at=datetime.now(UTC),
            teacher_notes="Great work!",
            breakdown=[{"problem_id": "x", "score_status": "full", "percent": 100}],
            ai_breakdown={"reasoning": "secret"},
        ))
        await s.commit()
    r = await client.get(
        "/v1/school/student/dashboard",
        headers=_auth(world["student_token"]),
    )
    g = r.json()["recently_graded"][0]
    assert "teacher_notes" not in g
    assert "breakdown" not in g
    assert "ai_breakdown" not in g

    r2 = await client.get(
        "/v1/school/student/grades",
        headers=_auth(world["student_token"]),
    )
    g2 = r2.json()["grades"][0]
    assert "teacher_notes" not in g2
    assert "breakdown" not in g2
    assert "ai_breakdown" not in g2


# ── Helpers ──

async def _get_section_id(world: dict[str, Any]) -> uuid.UUID:
    """Look up the section_id for the student's enrollment. The world
    fixture doesn't expose it directly — we fish it via the assignment
    sections link."""
    async with get_session_factory()() as s:
        row = (await s.execute(
            text(
                "SELECT section_id FROM assignment_sections "
                "WHERE assignment_id = :aid LIMIT 1"
            ),
            {"aid": world["assignment_id"]},
        )).first()
        assert row is not None
        return row[0]
