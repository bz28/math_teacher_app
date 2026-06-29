"""GET /v1/teacher/needs-attention — the cross-course "Needs you today"
triage queue. One row per submission needing the teacher, prioritized
flagged → overdue → ungraded → dirty. The reason buckets must mirror the
courses-dashboard math (a row counted by to_review/flagged there must
appear here), the queue is owner-gated, and it leaks no grades — only
routing metadata.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _seed() -> dict[str, uuid.UUID | str]:
    """A teacher + course + section + one enrolled student. Returns the
    ids tests need to attach submissions in varied states."""
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera",
        )
        student = User(
            email=f"student_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8, role="student", name="Jordan Diaz",
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()

        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))
        await s.commit()
        return {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "course_id": course.id,
            "section_id": section.id,
            "unit_id": unit.id,
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
        }


async def _publish_hw(
    w: dict[str, uuid.UUID | str],
    *,
    due_at: datetime | None,
    title: str = "HW 1",
) -> uuid.UUID:
    async with get_session_factory()() as s:
        a = Assignment(
            course_id=w["course_id"], unit_ids=[w["unit_id"]],
            teacher_id=w["teacher_id"], title=title, type="homework",
            status="published", content={"problems": []}, due_at=due_at,
        )
        s.add(a)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=a.id, section_id=w["section_id"],
            published_at=datetime.now(UTC),
        ))
        await s.commit()
        return a.id


async def _add_submission(
    w: dict[str, uuid.UUID | str],
    hw_id: uuid.UUID,
    *,
    student_id: uuid.UUID | None = None,
) -> uuid.UUID:
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id,
            student_id=student_id or w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        await s.commit()
        return sub.id


async def _get(w: dict[str, uuid.UUID | str], client: AsyncClient) -> dict:
    r = await client.get("/v1/teacher/needs-attention", headers=_auth(w["teacher_token"]))
    assert r.status_code == 200, r.text
    return r.json()


async def test_empty_when_nothing_pending(client: AsyncClient) -> None:
    w = await _seed()
    body = await _get(w, client)
    assert body == {"items": [], "total": 0}


async def test_ungraded_submission_surfaces(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    await _add_submission(w, hw)
    body = await _get(w, client)
    assert body["total"] == 1
    item = body["items"][0]
    assert item["reason"] == "ungraded"
    # Routing metadata is complete — the frontend builds the deep-link
    # from these, and renders who/what without a second fetch.
    assert item["student_name"] == "Jordan Diaz"
    assert item["course_name"] == "Algebra 1"
    assert item["assignment_title"] == "HW 1"
    assert item["section_name"] == "Period 3"
    assert item["course_id"] == str(w["course_id"])
    assert item["section_id"] == str(w["section_id"])
    assert item["assignment_id"] == str(hw)
    assert item["student_id"] == str(w["student_id"])
    # No grade/score field leaks.
    assert "final_score" not in item
    assert "score" not in item


async def test_overdue_ungraded_is_overdue_reason(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=datetime.now(UTC) - timedelta(days=2))
    await _add_submission(w, hw)
    body = await _get(w, client)
    assert body["items"][0]["reason"] == "overdue"


async def test_flagged_trumps_ungraded(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    sub_id = await _add_submission(w, hw)
    async with get_session_factory()() as s:
        s.add(IntegrityCheckSubmission(
            submission_id=sub_id, status="complete", disposition="flag_for_review",
        ))
        await s.commit()
    body = await _get(w, client)
    # Submission is both ungraded and flagged; flagged wins the bucket.
    assert body["total"] == 1
    assert body["items"][0]["reason"] == "flagged"


async def test_dirty_published_grade_surfaces(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    sub_id = await _add_submission(w, hw)
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sub_id, final_score=92.0, published_final_score=85.0,
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()
    body = await _get(w, client)
    assert body["items"][0]["reason"] == "dirty"


async def test_clean_published_grade_excluded(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    sub_id = await _add_submission(w, hw)
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sub_id, final_score=85.0, published_final_score=85.0,
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()
    body = await _get(w, client)
    assert body == {"items": [], "total": 0}


async def test_priority_ordering(client: AsyncClient) -> None:
    """flagged → overdue → ungraded → dirty. Seed one of each on its own
    HW + student and assert the returned order matches the priority."""
    w = await _seed()
    # Extra enrolled students so each row is a distinct submission.
    async with get_session_factory()() as s:
        extra: list[uuid.UUID] = []
        for i in range(3):
            st = User(
                email=f"s{i}_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=8,
                role="student", name=f"Student {i}",
            )
            s.add(st)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=w["section_id"], course_id=w["course_id"], student_id=st.id,
            ))
            extra.append(st.id)
        await s.commit()

    now = datetime.now(UTC)
    hw_flagged = await _publish_hw(w, due_at=None, title="Flagged HW")
    hw_overdue = await _publish_hw(w, due_at=now - timedelta(days=1), title="Overdue HW")
    hw_ungraded = await _publish_hw(w, due_at=now + timedelta(days=5), title="Ungraded HW")
    hw_dirty = await _publish_hw(w, due_at=None, title="Dirty HW")

    flagged_sub = await _add_submission(w, hw_flagged, student_id=w["student_id"])
    await _add_submission(w, hw_overdue, student_id=extra[0])
    await _add_submission(w, hw_ungraded, student_id=extra[1])
    dirty_sub = await _add_submission(w, hw_dirty, student_id=extra[2])

    async with get_session_factory()() as s:
        s.add(IntegrityCheckSubmission(
            submission_id=flagged_sub, status="complete", disposition="flag_for_review",
        ))
        s.add(SubmissionGrade(
            submission_id=dirty_sub, final_score=90.0, published_final_score=80.0,
            grade_published_at=now,
        ))
        await s.commit()

    body = await _get(w, client)
    reasons = [it["reason"] for it in body["items"]]
    assert reasons == ["flagged", "overdue", "ungraded", "dirty"], reasons


async def test_preview_student_excluded(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    async with get_session_factory()() as s:
        preview = User(
            email=f"preview_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Preview", is_preview=True,
        )
        s.add(preview)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=w["section_id"], course_id=w["course_id"], student_id=preview.id,
        ))
        s.add(Submission(
            assignment_id=hw, student_id=preview.id,
            section_id=w["section_id"], status="submitted",
        ))
        await s.commit()
    body = await _get(w, client)
    assert body == {"items": [], "total": 0}


async def test_owner_gated_other_teacher_sees_nothing(client: AsyncClient) -> None:
    w1 = await _seed()
    w2 = await _seed()
    hw = await _publish_hw(w1, due_at=None)
    await _add_submission(w1, hw)
    # w2 owns a different course — must not see w1's pending work.
    body = await _get(w2, client)
    assert body == {"items": [], "total": 0}
    # w1 does see it.
    assert (await _get(w1, client))["total"] == 1


async def test_unenrolled_after_submit_drops(client: AsyncClient) -> None:
    w = await _seed()
    hw = await _publish_hw(w, due_at=None)
    await _add_submission(w, hw)
    async with get_session_factory()() as s:
        await s.execute(
            SectionEnrollment.__table__.delete().where(
                SectionEnrollment.student_id == w["student_id"],
            ),
        )
        await s.commit()
    body = await _get(w, client)
    assert body == {"items": [], "total": 0}
