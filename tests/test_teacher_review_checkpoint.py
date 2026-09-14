"""Integration tests for the teacher "trust checkpoint" — the review
state that distinguishes a grade the teacher vouched for from an
AI-suggested one they never opened.

`reviewed_at` means "a teacher stands behind this grade". Covers:
  • POST /teacher/submissions/{id}/mark-reviewed — the explicit Approve on
    an AI grade: stamps reviewed_at on an existing grade and 400s when
    there's nothing to review (ungraded / skipped-unreadable).
  • PATCH /teacher/submissions/{id}/grade on a HAND grade (no AI score):
    every score is the teacher's own, so there is nothing to approve — the
    save that grades the last problem stamps reviewed_at itself, a partial
    grade stays unstamped, and un-grading a problem clears the stamp. An
    un-grade (empty breakdown) clears every grade field.
  • PATCH /grade on an AI grade never touches the stamp: editing one problem
    of an unapproved AI grade does not vouch for the rest, and editing an
    approved one is the teacher's own change to a grade she already vouched
    for, so the approval stays. A force-regrade still clears it — the AI
    replaced the grade she approved.
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
            "teacher_id": str(teacher.id),
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
    ai_graded: bool = False,
    problem_ids: list[str] | None = None,
) -> None:
    """Attach a SubmissionGrade directly so a test can build an exact
    review state (e.g. an AI-suggested-but-unreviewed row, or a vetted
    one) without driving the grade endpoint. `ai_graded` fills ai_score /
    ai_breakdown so the row reads as the AI's grade rather than a hand
    grade; `problem_ids` pins the breakdown to real problems."""
    async with get_session_factory()() as s:
        now = datetime.now(UTC)
        pids = problem_ids or [str(uuid.uuid4())]
        breakdown = [] if final_score is None else [
            {"problem_id": pid, "score_status": "full",
             "percent": 100.0, "feedback": None}
            for pid in pids
        ]
        s.add(SubmissionGrade(
            submission_id=submission_id,
            breakdown=breakdown,
            final_score=final_score,
            graded_at=now if final_score is not None else None,
            ai_score=final_score if ai_graded else None,
            ai_breakdown={"grades": []} if ai_graded else None,
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


async def test_hand_grade_self_approves_when_complete(
    client: AsyncClient,
) -> None:
    """A hand grade (no AI score) that covers every problem stamps
    reviewed_at on save — the teacher typed every score, so there is
    nothing left for her to approve. An un-grade (empty breakdown) still
    clears every grade field, the stamp included."""
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
    assert r.json()["reviewed_at"] is not None
    grade = await _get_grade(sub_id)
    assert grade.final_score == 100.0
    assert grade.graded_at is not None
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None

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


async def test_edit_after_approval_keeps_it(client: AsyncClient) -> None:
    """Editing an AI grade AFTER the teacher approved it KEEPS the approval
    — the change is her own, to a grade she already vouched for. The row
    stays approved and "publish only approved" still releases it."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    hdr = _auth(world["teacher_token"])
    await _add_grade(
        sub_id, final_score=100.0, reviewed=False, ai_graded=True,
        problem_ids=[world["bank_item_id"]],
    )

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed", headers=hdr,
    )
    assert r.status_code == 200, r.text
    approved_at = (await _get_grade(sub_id)).reviewed_at
    assert approved_at is not None

    # Now EDIT the grade (full -> zero). The approval stands.
    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=hdr,
        json={"breakdown": [
            {"problem_id": world["bank_item_id"], "score_status": "zero"},
        ]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is not None
    assert r.json()["final_score"] == 0.0

    grade = await _get_grade(sub_id)
    assert grade.reviewed_at == approved_at
    assert grade.reviewed_by is not None
    assert grade.final_score == 0.0
    assert grade.graded_at is not None

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=hdr,
        json={"reviewed_only": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 1
    assert (await _get_grade(sub_id)).grade_published_at is not None


async def test_edit_unapproved_ai_grade_does_not_approve_it(
    client: AsyncClient,
) -> None:
    """Editing one problem of an AI grade the teacher has NOT approved
    leaves it unapproved — the other problems are still the AI's numbers,
    and touching one does not vouch for the rest. The explicit Approve is
    what stamps it."""
    world = await _seed_hw(n_problems=3)
    sub_id = world["submission_ids"][0]
    pids = world["bank_item_ids"]
    hdr = _auth(world["teacher_token"])
    await _add_grade(
        sub_id, final_score=100.0, reviewed=False, ai_graded=True,
        problem_ids=pids,
    )

    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=hdr,
        json={"breakdown": [
            {"problem_id": pids[0], "score_status": "zero"},
            {"problem_id": pids[1], "score_status": "full"},
            {"problem_id": pids[2], "score_status": "full"},
        ]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is None
    assert grade.reviewed_by is None

    r = await client.post(
        f"/v1/teacher/submissions/{sub_id}/mark-reviewed", headers=hdr,
    )
    assert r.status_code == 200, r.text
    assert (await _get_grade(sub_id)).reviewed_at is not None


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

    # An approved AI grade.
    await _add_grade(
        sub_id, final_score=100.0, reviewed=False, ai_graded=True,
        problem_ids=[world["bank_item_id"]],
    )
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


async def test_unreadable_photo_hand_grade_self_approves(
    client: AsyncClient,
) -> None:
    """The headline case: the AI skipped an unreadable photo, so the
    teacher grades by hand. Scoring every problem stamps reviewed_at with
    her id — no Approve click — and a breakdown carrying an extra entry
    for a problem no longer on the assignment doesn't block it."""
    world = await _seed_hw(n_problems=2)
    sub_id = world["submission_ids"][0]
    pids = world["bank_item_ids"]
    await _add_grade(
        sub_id, final_score=None, reviewed=False,
        ai_grading_status="skipped_unreadable",
    )

    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=_auth(world["teacher_token"]),
        json={"breakdown": [
            {"problem_id": pids[0], "score_status": "full"},
            {"problem_id": pids[1], "score_status": "zero"},
            {"problem_id": str(uuid.uuid4()), "score_status": "full"},
        ]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is not None
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert str(grade.reviewed_by) == world["teacher_id"]


async def test_partial_hand_grade_stays_unreviewed(
    client: AsyncClient,
) -> None:
    """The hand-grade contract end to end on a 3-problem HW:

      • grading ONE problem leaves reviewed_at null — "publish only
        reviewed" must never release a half-graded submission,
      • grading the rest stamps it, with no Approve click,
      • un-grading one problem again clears it.
    """
    world = await _seed_hw(n_problems=3)
    sub_id = world["submission_ids"][0]
    pids = world["bank_item_ids"]
    headers = _auth(world["teacher_token"])

    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=headers,
        json={"breakdown": [{"problem_id": pids[0], "score_status": "full"}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"] is None
    assert (await _get_grade(sub_id)).reviewed_at is None

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades",
        headers=headers,
        json={"reviewed_only": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["published_count"] == 0

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
    assert r.json()["reviewed_at"] is not None
    grade = await _get_grade(sub_id)
    assert grade.reviewed_at is not None
    assert grade.reviewed_by is not None

    r = await client.patch(
        f"/v1/teacher/submissions/{sub_id}/grade",
        headers=headers,
        json={"breakdown": [
            {"problem_id": pids[0], "score_status": "full"},
            {"problem_id": pids[2], "score_status": "full"},
        ]},
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
