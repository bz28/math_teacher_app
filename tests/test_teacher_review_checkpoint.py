"""Integration tests for the teacher "trust checkpoint" — the review
state that distinguishes a grade the teacher vouched for from an
AI-suggested one they never opened.

Covers three contracts:
  • POST /teacher/submissions/{id}/mark-reviewed is the SOLE writer of the
    review stamp: it stamps reviewed_at on an existing grade (called by the
    frontend once every problem is addressed) and 400s when there's nothing
    to review (ungraded / skipped-unreadable).
  • PATCH /teacher/submissions/{id}/grade records the grade (final_score +
    graded_at) but NEVER stamps reviewed_at — saving one problem's grade
    does not mean the whole submission is reviewed. An un-grade (empty
    breakdown) clears every grade field, including any prior stamp. And
    editing an ALREADY-approved grade REVOKES the approval (clears
    reviewed_at/reviewed_by) so a changed grade can't publish under a stale
    approval — the teacher must re-approve the version they just changed.
  • POST /teacher/assignments/{id}/publish-grades with reviewed_only=True
    releases only the vetted grades, leaving unopened AI suggestions
    unpublished.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password

# Bound at import time — BEFORE conftest's autouse `_mock_integrity_ai`
# fixture patches `api.core.grading_ai.run_ai_grading_for_submission` to a
# no-op. `patch` rebinds the module ATTRIBUTE, not this already-captured
# name, so `_real_run_ai_grading` stays the genuine implementation and the
# force-regrade test can exercise the real reviewed_at-clearing logic while
# the grader LLM call underneath stays mocked.
from api.core.grading_ai import (
    run_ai_grading_for_submission as _real_run_ai_grading,
)
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _seed_hw(
    *, n_submissions: int = 1, n_problems: int = 1
) -> dict[str, Any]:
    """Seed a teacher + published HW (`n_problems` problems) + `n_submissions`
    student submissions (no grade rows). Returns the teacher token, assignment
    + section ids, the first `bank_item_id` (back-compat) plus the full
    `bank_item_ids` list, and the submission ids in creation order so tests
    can attach grades however they need."""
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

        bank_items: list[QuestionBankItem] = []
        for i in range(n_problems):
            p = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=f"P{i + 1}", question="Solve x^2 - 5x + 6 = 0",
                solution_steps=[], final_answer="x=2,3",
                distractors=["a", "b", "c"], status="approved",
                source="generated",
            )
            s.add(p)
            bank_items.append(p)
        await s.flush()
        bank_item_ids = [str(p.id) for p in bank_items]
        assignment.content = {"problem_ids": bank_item_ids}
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
            "bank_item_id": bank_item_ids[0],
            "bank_item_ids": bank_item_ids,
            "submission_ids": submission_ids,
        }


async def _add_grade(
    submission_id: uuid.UUID,
    *,
    final_score: float | None,
    reviewed: bool,
    ai_grading_status: str | None = None,
) -> None:
    """Attach a SubmissionGrade directly so a test can build an exact
    review state (e.g. an AI-suggested-but-unreviewed row, or a vetted
    one) without driving the grade endpoint."""
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


async def test_edit_grade_does_not_stamp_review(client: AsyncClient) -> None:
    """Saving a grade records the grade (final_score + graded_at) but does
    NOT stamp reviewed_at — saving is not reviewing. An un-grade (empty
    breakdown) still clears every grade field."""
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
    assert r.json()["final_score"] == 100.0
    # The grade is recorded but the submission is NOT reviewed yet.
    assert r.json()["reviewed_at"] is None
    grade = await _get_grade(sub_id)
    assert grade.final_score == 100.0
    assert grade.graded_at is not None
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None

    # Un-grade: clearing the breakdown clears every grade field.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=_auth(world["teacher_token"]),
        json={"breakdown": []},
    )
    assert r.status_code == 200, r.text
    assert r.json()["final_score"] is None
    assert r.json()["reviewed_at"] is None
    grade = await _get_grade(sub_id)
    assert grade.final_score is None
    assert grade.graded_at is None
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None


async def test_edit_after_approval_revokes_it(client: AsyncClient) -> None:
    """Editing a grade AFTER it was approved REVOKES the approval — approval
    means "I vouched for THIS grade," so a change invalidates it. The row
    returns to "not reviewed" (reviewed_at/reviewed_by null) and a
    publish-reviewed-only excludes it until the teacher re-approves. This is
    the guard that a changed grade can't ship under a stale approval."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    hdr = _auth(world["teacher_token"])

    # Grade the problem, then approve it via the sole review writer.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=hdr,
        json={"breakdown": [
            {"problem_id": world["bank_item_id"], "score_status": "full"},
        ]},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed", headers=hdr,
    )
    assert r.status_code == 200, r.text
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None
    assert grade.final_score == 100.0

    # Now EDIT the grade (full -> zero). The edit revokes the approval.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=hdr,
        json={"breakdown": [
            {"problem_id": world["bank_item_id"], "score_status": "zero"},
        ]},
    )
    assert r.status_code == 200, r.text
    # The response reflects the now-unreviewed state so the client can revert.
    assert r.json()["reviewed_at"] is None
    assert r.json()["final_score"] == 0.0

    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None
    # The edited grade itself is intact — only the approval was revoked.
    assert grade.final_score == 0.0
    assert grade.graded_at is not None

    # "Publish only approved" now excludes it — the stale approval is gone.
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=hdr,
        json={"reviewed_only": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 0
    assert (await _get_grade(sub_id)).grade_published_at is None


async def test_regrade_after_approval_revokes_it(client: AsyncClient) -> None:
    """A force-regrade AFTER approval REVOKES the approval — same rationale as
    an edit: the regrade replaces the grade the approval vouched for. The row
    returns to "not reviewed" (reviewed_at/reviewed_by null) and a
    publish-reviewed-only excludes it until the teacher re-approves. Guards the
    server half of the review-page regrade-coherence fix (the client mirrors
    this optimistically). Drives the real grading path with the grader LLM
    call mocked, so no real Claude call is made."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    hdr = _auth(world["teacher_token"])

    # Grade the problem, then approve it via the sole review writer.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=hdr,
        json={"breakdown": [
            {"problem_id": world["bank_item_id"], "score_status": "full"},
        ]},
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed", headers=hdr,
    )
    assert r.status_code == 200, r.text
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None

    # Force-regrade with the grader LLM mocked to return a fresh full grade
    # on problem position 1 (maps to bank_item_ids[0]).
    fresh = {"grades": [{
        "problem_position": 1,
        "score_status": "full",
        "confidence": 0.9,
        "student_feedback": "Correct — nice work.",
        "reasoning": "matches the key",
    }]}
    with patch(
        "api.core.grading_ai.grade_submission_with_ai",
        new=AsyncMock(return_value=fresh),
    ):
        async with get_session_factory()() as s:
            await _real_run_ai_grading(
                sub_id, {"steps": [], "confidence": 0.9}, s, force=True,
            )
            await s.commit()

    # The regrade wrote a fresh grade AND cleared the stale approval.
    grade = await _get_grade(sub_id)
    assert grade.final_score == 100.0
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None

    # "Publish only approved" now excludes it — the stale approval is gone.
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=hdr,
        json={"reviewed_only": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 0
    assert (await _get_grade(sub_id)).grade_published_at is None


async def test_reviewed_only_after_all_problems_addressed(
    client: AsyncClient,
) -> None:
    """The all-addressed contract end to end on a 3-problem HW:

      • grading ONE problem leaves reviewed_at null (not reviewed),
      • grading the rest still leaves it null (a grade save never stamps),
      • the explicit mark-reviewed call — which the frontend fires only once
        every problem is addressed — is what finally stamps it.

    Guards the exact bug this change closes: a single grade save must not
    let "publish only reviewed" release a partially-vetted submission.
    """
    world = await _seed_hw(n_problems=3)
    sub_id = world["submission_ids"][0]
    pids = world["bank_item_ids"]
    headers = _auth(world["teacher_token"])

    # Grade just the first problem.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=headers,
        json={"breakdown": [{"problem_id": pids[0], "score_status": "full"}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None
    assert (await _get_grade(sub_id)).reviewed_at is None

    # Grade the remaining two — still just saving, still not reviewed.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=headers,
        json={"breakdown": [
            {"problem_id": pids[0], "score_status": "full"},
            {"problem_id": pids[1], "score_status": "zero"},
            {"problem_id": pids[2], "score_status": "full"},
        ]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None
    assert (await _get_grade(sub_id)).reviewed_at is None

    # Now everything is addressed — the frontend fires mark-reviewed.
    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is not None
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None


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


async def test_unmark_reviewed_clears_stamp(client: AsyncClient) -> None:
    """The manual "Undo approval" path: unmark-reviewed clears reviewed_at
    /reviewed_by on an approved grade without touching the score, so it
    drops back to "not reviewed"."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _add_grade(sub_id, final_score=88.0, reviewed=True)

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/unmark-reviewed",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None

    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None
    # The grade itself is untouched.
    assert grade.final_score == 88.0


async def test_unmark_reviewed_idempotent_on_unreviewed(
    client: AsyncClient,
) -> None:
    """Unmarking an already-unreviewed grade is a no-op that still 200s —
    a double-click (or undo of a never-approved grade) can't 400."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _add_grade(sub_id, final_score=70.0, reviewed=False)

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/unmark-reviewed",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None
    assert (await _get_grade(sub_id)).reviewed_at is None


async def test_unmark_then_publish_reviewed_only_holds_it_back(
    client: AsyncClient,
) -> None:
    """Undoing an approval removes the grade from the "publish only
    approved" set — the end-to-end point of the undo path."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _add_grade(sub_id, final_score=90.0, reviewed=True)

    # Walk the approval back.
    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/unmark-reviewed",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    # "Publish only approved" now releases nothing.
    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=_auth(world["teacher_token"]),
        json={"reviewed_only": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 0
    assert (await _get_grade(sub_id)).grade_published_at is None


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
