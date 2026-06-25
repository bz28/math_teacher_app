"""Integration tests for GET
/v1/teacher/assignments/{assignment_id}/item-analysis.

Grounds the contract: the endpoint aggregates per-problem performance
across a homework's graded submissions (those with a non-null
breakdown), buckets each problem index into full/partial/zero counts,
averages percent, and returns the problems worst-first while preserving
the original problem_index. Auth is enforced via get_teacher_assignment
so a teacher can't read another teacher's assignment.
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


def _entry(status: str, percent: float) -> dict[str, Any]:
    """Build one per-problem breakdown entry in the shape grade_submission
    persists: {problem_id, score_status, percent, feedback}."""
    return {
        "problem_id": str(uuid.uuid4()),
        "score_status": status,
        "percent": percent,
        "feedback": None,
    }


async def _seed_two_problem_hw(
    *, graded: list[list[dict[str, Any]] | None],
) -> dict[str, Any]:
    """Seed a teacher + course + section + a published 2-problem HW, plus
    one Submission per entry in `graded` with a SubmissionGrade whose
    breakdown is that entry (None = an ungraded submission, which the
    endpoint must ignore).

    Returns the teacher token + assignment id.
    """
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

        # Assignment created first so bank items can back-reference it
        # via originating_assignment_id (NOT NULL). content.problem_ids
        # is filled in once the items have ids.
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
        p2 = QuestionBankItem(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id,
            title="P2", question="Solve x^2 - 7x + 12 = 0",
            solution_steps=[], final_answer="x=3,4",
            distractors=["a", "b", "c"], status="approved", source="generated",
        )
        s.add_all([p1, p2])
        await s.flush()
        assignment.content = {"problem_ids": [str(p1.id), str(p2.id)]}
        await s.flush()

        for breakdown in graded:
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
            if breakdown is None:
                # Ungraded: mirror production, where an ungraded
                # submission either has no grade row or one whose
                # breakdown column was never written (SQL NULL). Leave
                # the grade row off entirely — the endpoint must ignore
                # this submission.
                continue
            s.add(SubmissionGrade(
                submission_id=sub.id,
                breakdown=breakdown,
                final_score=None,
                graded_at=datetime.now(UTC),
            ))
        await s.commit()

        return {
            "teacher_id": teacher.id,
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
            "assignment_id": assignment.id,
            "p1_question": p1.question,
            "p2_question": p2.question,
        }


async def test_item_analysis_aggregates_and_sorts_worst_first(
    client: AsyncClient,
) -> None:
    # 3 graded submissions over a 2-problem HW.
    #   Problem 0: full(100), full(100), partial(50) -> avg 83.33
    #   Problem 1: zero(0), partial(40), zero(0)      -> avg 13.33
    # Problem 1 is the worst, so it must come first.
    world = await _seed_two_problem_hw(graded=[
        [_entry("full", 100.0), _entry("zero", 0.0)],
        [_entry("full", 100.0), _entry("partial", 40.0)],
        [_entry("partial", 50.0), _entry("zero", 0.0)],
    ])

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/item-analysis",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["graded_count"] == 3
    assert len(body["items"]) == 2

    # Worst-first ordering: problem index 1 (avg ~13.3) before index 0.
    first, second = body["items"]
    assert first["problem_index"] == 1
    assert second["problem_index"] == 0

    # Problem 1 buckets + average.
    assert first["full"] == 0
    assert first["partial"] == 1
    assert first["zero"] == 2
    assert first["avg_percent"] == round((0.0 + 40.0 + 0.0) / 3, 1)
    assert first["problem_text"] == world["p2_question"]

    # Problem 0 buckets + average.
    assert second["full"] == 2
    assert second["partial"] == 1
    assert second["zero"] == 0
    assert second["avg_percent"] == round((100.0 + 100.0 + 50.0) / 3, 1)
    assert second["problem_text"] == world["p1_question"]


async def test_item_analysis_ignores_ungraded_submissions(
    client: AsyncClient,
) -> None:
    # Two submissions: one graded, one with breakdown=None (ungraded).
    # graded_count must be 1 and only the graded breakdown counts.
    world = await _seed_two_problem_hw(graded=[
        [_entry("full", 100.0), _entry("zero", 0.0)],
        None,
    ])

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/item-analysis",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["graded_count"] == 1
    by_index = {it["problem_index"]: it for it in body["items"]}
    assert by_index[0]["full"] == 1
    assert by_index[1]["zero"] == 1


async def test_item_analysis_zero_graded_submissions(
    client: AsyncClient,
) -> None:
    # No graded submissions at all -> graded_count 0 and every problem
    # surfaces with all-zero counts and avg_percent 0.
    world = await _seed_two_problem_hw(graded=[])

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/item-analysis",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["graded_count"] == 0
    assert len(body["items"]) == 2
    for it in body["items"]:
        assert it["full"] == 0
        assert it["partial"] == 0
        assert it["zero"] == 0
        assert it["avg_percent"] == 0.0


async def test_item_analysis_rejects_other_teacher(
    client: AsyncClient,
) -> None:
    """A teacher who doesn't own the assignment must not read its
    item analysis. get_teacher_assignment guards this (403/404)."""
    world = await _seed_two_problem_hw(graded=[
        [_entry("full", 100.0), _entry("zero", 0.0)],
    ])

    async with get_session_factory()() as s:
        other = User(
            email=f"other_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Other",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/item-analysis",
        headers=_auth(other_token),
    )
    assert r.status_code in (403, 404)


async def test_item_analysis_tolerates_short_breakdown(
    client: AsyncClient,
) -> None:
    """A breakdown shorter than the problem list must not IndexError —
    the missing problem simply gets no contribution from that row."""
    world = await _seed_two_problem_hw(graded=[
        [_entry("full", 100.0)],  # only covers problem 0
    ])

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/item-analysis",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["graded_count"] == 1
    by_index = {it["problem_index"]: it for it in body["items"]}
    assert by_index[0]["full"] == 1
    assert by_index[0]["avg_percent"] == 100.0
    # Problem 1 had no breakdown entry -> all zero counts, avg 0.
    assert by_index[1]["full"] == 0
    assert by_index[1]["partial"] == 0
    assert by_index[1]["zero"] == 0
    assert by_index[1]["avg_percent"] == 0.0
