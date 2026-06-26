"""Integration tests for the teacher "trust checkpoint" — the review
state that distinguishes a grade the teacher vouched for from an
AI-suggested one they never opened.

Covers three contracts:
  • POST /teacher/submissions/{id}/mark-reviewed stamps reviewed_at on an
    existing grade (the no-edit "I looked, I agree" path) and 400s when
    there's nothing to review (ungraded / skipped-unreadable).
  • PATCH /teacher/submissions/{id}/grade auto-stamps reviewed_at on any
    score edit (editing == reviewing) and clears it on an un-grade.
  • POST /teacher/assignments/{id}/publish-grades with reviewed_only=True
    releases only the vetted grades, leaving unopened AI suggestions
    unpublished.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _seed_hw(*, n_submissions: int = 1) -> dict[str, Any]:
    """Seed a teacher + published 1-problem HW + `n_submissions` student
    submissions (no grade rows). Returns the teacher token, assignment +
    section ids, the single bank_item_id, and the submission ids in
    creation order so tests can attach grades however they need."""
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="T",
        )
        s.add(teacher)
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()

        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 1", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        p1 = QuestionBankItem(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id,
            title="P1", question="Solve x^2 - 5x + 6 = 0",
            solution_steps=[], final_answer="x=2,3",
            distractors=["a", "b", "c"], status="approved", source="generated",
        )
        s.add(p1)
        await s.flush()
        assignment.content = {"problem_ids": [str(p1.id)]}
        await s.flush()

        submission_ids: list[uuid.UUID] = []
        for _ in range(n_submissions):
            student = User(
                email=f"student_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"),
                grade_level=8, role="student", name="S",
            )
            s.add(student)
            await s.flush()
            sub = Submission(
                assignment_id=assignment.id, student_id=student.id,
                section_id=section.id, status="submitted",
            )
            s.add(sub)
            await s.flush()
            submission_ids.append(sub.id)

        await s.commit()
        return {
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
            "assignment_id": assignment.id,
            "section_id": section.id,
            "bank_item_id": str(p1.id),
            "submission_ids": submission_ids,
        }


async def _add_grade(
    submission_id: uuid.UUID,
    *,
    final_score: float | None,
    reviewed: bool,
    ai_grading_status: str | None = None,
) -> None:
    """Attach a SubmissionGrade directly (bypassing the grade endpoint so
    we can build an AI-suggested-but-unreviewed row, which the endpoint
    would otherwise auto-stamp)."""
    async with get_session_factory()() as s:
        now = datetime.now(UTC)
        s.add(SubmissionGrade(
            submission_id=submission_id,
            breakdown=[] if final_score is None else [
                {"problem_id": str(uuid.uuid4()), "score_status": "full",
                 "percent": 100.0, "feedback": None},
            ],
            final_score=final_score,
            graded_at=now if final_score is not None else None,
            ai_grading_status=ai_grading_status,
            reviewed_by=None,
            reviewed_at=now if reviewed else None,
        ))
        await s.commit()


async def _get_grade(submission_id: uuid.UUID) -> SubmissionGrade:
    async with get_session_factory()() as s:
        from sqlalchemy import select
        return (await s.execute(
            select(SubmissionGrade).where(
                SubmissionGrade.submission_id == submission_id
            )
        )).scalar_one()


async def test_mark_reviewed_stamps_reviewed_at(client: AsyncClient) -> None:
    """An AI-suggested grade (final_score set, reviewed_at null) becomes
    reviewed on the explicit no-edit click."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _add_grade(sub_id, final_score=88.0, reviewed=False)

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is not None

    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None


async def test_mark_reviewed_rejects_ungraded(client: AsyncClient) -> None:
    """Nothing to review on a submission with no grade row at all."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400, r.text


async def test_mark_reviewed_rejects_skipped_unreadable(
    client: AsyncClient,
) -> None:
    """A skipped-unreadable row has no AI grade to vouch for — 400, the
    teacher grades it by hand instead."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _add_grade(
        sub_id, final_score=None, reviewed=False,
        ai_grading_status="skipped_unreadable",
    )

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400, r.text

    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is None


async def test_edit_grade_autostamps_review(client: AsyncClient) -> None:
    """Editing any problem score IS reviewing — the grade endpoint stamps
    reviewed_at, and an un-grade (empty breakdown) clears it again."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]

    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=_auth(world["teacher_token"]),
        json={"breakdown": [
            {"problem_id": world["bank_item_id"], "score_status": "full"},
        ]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is not None
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None

    # Un-grade: clearing the breakdown clears the review stamp.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=_auth(world["teacher_token"]),
        json={"breakdown": []},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None


async def test_publish_reviewed_only_releases_vetted_grades(
    client: AsyncClient,
) -> None:
    """reviewed_only=True publishes only the grade the teacher vetted; a
    follow-up publish-all releases the remaining AI-suggested one."""
    world = await _seed_hw(n_submissions=2)
    reviewed_sub, unreviewed_sub = world["submission_ids"]
    await _add_grade(reviewed_sub, final_score=90.0, reviewed=True)
    await _add_grade(unreviewed_sub, final_score=70.0, reviewed=False)

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=_auth(world["teacher_token"]),
        json={"reviewed_only": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 1

    assert (await _get_grade(reviewed_sub)).grade_published_at is not None
    assert (await _get_grade(unreviewed_sub)).grade_published_at is None

    # Publish all picks up the still-unpublished AI suggestion.
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=_auth(world["teacher_token"]),
        json={"reviewed_only": False},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 1
    assert (await _get_grade(unreviewed_sub)).grade_published_at is not None


async def test_publish_defaults_to_all_without_body(
    client: AsyncClient,
) -> None:
    """No body == publish everything (back-compat with the original
    no-arg call shape)."""
    world = await _seed_hw(n_submissions=2)
    reviewed_sub, unreviewed_sub = world["submission_ids"]
    await _add_grade(reviewed_sub, final_score=90.0, reviewed=True)
    await _add_grade(unreviewed_sub, final_score=70.0, reviewed=False)

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 2
