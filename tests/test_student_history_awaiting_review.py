"""A student's history (GET .../students/{id}/grades) tells a grade that
exists but isn't published apart from work nobody has graded.

The page said "Not graded yet" for all of them, so a teacher scanning one
student's record couldn't see that a grade was sitting on their desk. Each
row now says whether an AI grade awaits approval ("awaiting_review") or a
finished grade awaits only Publish ("graded_unpublished"), with the draft
score that would publish. Approval is `reviewed_at`, as everywhere else.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.course import CourseTeacher
from api.models.section_enrollment import SectionEnrollment
from tests.conftest import auth_headers


async def _enrollment(s: Any, world: dict[str, Any]) -> SectionEnrollment:
    """The world's student's enrollment, with the world's teacher put on the
    course (the world fixture leaves the course teacherless)."""
    enrollment: SectionEnrollment = (await s.execute(
        select(SectionEnrollment).where(SectionEnrollment.student_id == world["student_id"])
    )).scalar_one()
    s.add(CourseTeacher(course_id=enrollment.course_id, teacher_id=world["teacher_id"], role="owner"))
    return enrollment


async def _grade(world: dict[str, Any], **fields: Any) -> tuple[str, str]:
    """Turn in the world's homework with a grade carrying `fields`; return
    (course_id, section_id) for the history URL."""
    async with get_session_factory()() as s:
        enrollment = await _enrollment(s, world)
        sub = Submission(
            assignment_id=world["assignment_id"], student_id=world["student_id"],
            section_id=enrollment.section_id, status="submitted", files=[], is_late=False,
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(submission_id=sub.id, graded_at=datetime.now(UTC), **fields))
        await s.commit()
        return str(enrollment.course_id), str(enrollment.section_id)


async def _row(client: AsyncClient, world: dict[str, Any], course_id: str, section_id: str) -> dict[str, Any]:
    r = await client.get(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/students/{world['student_id']}/grades",
        headers=auth_headers(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    rows = r.json()["published_hws"]
    assert len(rows) == 1
    row: dict[str, Any] = rows[0]
    return row


async def test_unapproved_ai_grade_reads_as_awaiting_review(client: AsyncClient, world: dict[str, Any]) -> None:
    course_id, section_id = await _grade(world, ai_score=74.96, final_score=74.96)
    row = await _row(client, world, course_id, section_id)
    assert row["final_score"] is None
    assert (row["draft_state"], row["draft_score"]) == ("awaiting_review", 75.0)


async def test_cleared_ai_grade_is_not_awaiting_review(client: AsyncClient, world: dict[str, Any]) -> None:
    """Clearing an AI grade keeps its ai_score but empties final_score:
    nothing is waiting to be approved."""
    course_id, section_id = await _grade(world, ai_score=70.0, final_score=None)
    row = await _row(client, world, course_id, section_id)
    assert row["draft_state"] is None


async def test_awaiting_score_is_the_one_that_would_publish(client: AsyncClient, world: dict[str, Any]) -> None:
    """A late penalty already came off final_score; the row shows that, not
    the raw AI score."""
    course_id, section_id = await _grade(world, ai_score=85.0, final_score=76.5, late_penalty=8.5)
    row = await _row(client, world, course_id, section_id)
    assert (row["draft_state"], row["draft_score"]) == ("awaiting_review", 76.5)


async def test_approved_ai_grade_is_graded_not_published(client: AsyncClient, world: dict[str, Any]) -> None:
    """Approving moves the row on to "Graded, not published", never back to
    "Not graded yet"."""
    course_id, section_id = await _grade(
        world, ai_score=80.0, final_score=80.0,
        reviewed_by=world["teacher_id"], reviewed_at=datetime.now(UTC),
    )
    row = await _row(client, world, course_id, section_id)
    assert (row["draft_state"], row["draft_score"]) == ("graded_unpublished", 80.0)


async def test_hand_grade_is_graded_not_published(client: AsyncClient, world: dict[str, Any]) -> None:
    course_id, section_id = await _grade(
        world, final_score=90.0, reviewed_by=world["teacher_id"], reviewed_at=datetime.now(UTC),
    )
    row = await _row(client, world, course_id, section_id)
    assert (row["draft_state"], row["draft_score"]) == ("graded_unpublished", 90.0)


async def test_partial_hand_grade_is_partly_graded(client: AsyncClient, world: dict[str, Any]) -> None:
    """A hand grade covering only some problems is left unstamped (Publish
    only reviewed won't release it): it isn't "Graded, not published"."""
    course_id, section_id = await _grade(world, final_score=50.0)
    row = await _row(client, world, course_id, section_id)
    assert row["draft_state"] == "partly_graded"


async def test_approval_is_reviewed_at_even_without_reviewer(client: AsyncClient, world: dict[str, Any]) -> None:
    """reviewed_by goes NULL when the approving teacher's account is deleted;
    reviewed_at still says it was approved."""
    course_id, section_id = await _grade(
        world, ai_score=80.0, final_score=80.0, reviewed_at=datetime.now(UTC),
    )
    row = await _row(client, world, course_id, section_id)
    assert row["draft_state"] == "graded_unpublished"


async def test_published_grade_shows_its_score_not_awaiting(client: AsyncClient, world: dict[str, Any]) -> None:
    now = datetime.now(UTC)
    course_id, section_id = await _grade(
        world, ai_score=60.0, final_score=60.0,
        grade_published_at=now, published_final_score=60.0,
    )
    row = await _row(client, world, course_id, section_id)
    assert row["final_score"] == 60.0
    assert row["draft_state"] is None


async def test_submission_without_ai_grade_is_not_awaiting(client: AsyncClient, world: dict[str, Any]) -> None:
    course_id, section_id = await _grade(world)
    row = await _row(client, world, course_id, section_id)
    assert row["final_score"] is None
    assert row["draft_state"] is None


async def test_another_students_ai_grade_does_not_leak(client: AsyncClient, world: dict[str, Any]) -> None:
    """The waiting grade is the student's own: the outsider's AI grade on
    the same homework never marks this student's row."""
    async with get_session_factory()() as s:
        enrollment = await _enrollment(s, world)
        s.add(SectionEnrollment(
            section_id=enrollment.section_id, course_id=enrollment.course_id,
            student_id=world["outsider_id"],
        ))
        sub = Submission(
            assignment_id=world["assignment_id"], student_id=world["outsider_id"],
            section_id=enrollment.section_id, status="submitted", files=[], is_late=False,
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(submission_id=sub.id, ai_score=90.0, final_score=90.0))
        await s.commit()
        course_id, section_id = str(enrollment.course_id), str(enrollment.section_id)
    row = await _row(client, world, course_id, section_id)
    assert row["draft_state"] is None
