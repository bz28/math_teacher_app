"""The set's title reaches question generation as its topic.

Prod, 2026-10-18: a practice set titled "Parallel & Perpendicular Lines"
in a unit named "Unit 3" came back 20/20 triangle problems, twice. The
title was never sent — generation saw only the unit name — and units are
often just numbered. Measured live: unit only → 0/5 on topic; with the
title → 5/5.
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from api.core.assignment_generation import generate_questions
from api.core.auth import hash_password
from api.core.question_bank_generation import _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit
from api.models.user import User


async def _user_message(**kwargs: Any) -> str:
    """The user message generate_questions sends, with the model mocked."""
    call = AsyncMock(return_value={"questions": [{"title": "t", "text": "q", "difficulty": "easy"}]})
    with patch("api.core.assignment_generation.call_claude_json", call):
        await generate_questions("Unit 3", 1, course_name="Geometry", **kwargs)
    return str(call.call_args.args[1])


@pytest.mark.asyncio
async def test_title_is_sent_between_the_teachers_brief_and_the_unit() -> None:
    msg = await _user_message(
        assignment_title="  Parallel & Perpendicular Lines ", extra_instructions="word problems",
    )
    assert "Assignment title: Parallel & Perpendicular Lines" in msg
    # The priority order the system prompt describes: brief, title, unit.
    assert msg.index("Teacher's instructions") < msg.index("Assignment title") < msg.index("Unit: Unit 3")


@pytest.mark.asyncio
async def test_no_title_line_without_a_title() -> None:
    for title in (None, "", "   "):
        assert "Assignment title" not in await _user_message(assignment_title=title)


async def _run_job(*, variation: bool) -> dict[str, Any]:
    """Run one generation job with the model mocked; return the kwargs
    generate_questions was called with."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{tag}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T")
        course = Course(name="Geometry", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="Unit 3", position=0)
        s.add(unit)
        await s.flush()
        practice = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                              title="Parallel & Perpendicular Lines", type="practice", status="draft")
        s.add(practice)
        await s.flush()
        parent = None
        if variation:
            parent = QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=practice.id,
                                      title="p", question="Lines l and m are parallel...", final_answer="1",
                                      status="approved", source="generated")
            s.add(parent)
            await s.flush()
        job = QuestionBankGenerationJob(
            course_id=course.id, unit_id=unit.id, originating_assignment_id=practice.id,
            created_by_id=teacher.id, status="queued", requested_count=1,
            parent_question_id=parent.id if parent else None,
        )
        s.add(job)
        await s.commit()
        job_id = job.id

    gen = AsyncMock(return_value=[{"title": "t", "text": "q", "difficulty": "easy"}])
    with (
        patch("api.core.question_bank_generation.generate_questions", gen),
        patch("api.core.question_bank_generation.generate_solutions",
              AsyncMock(return_value=[{"question_text": "q", "steps": [], "final_answer": "1"}])),
        patch("api.core.question_bank_generation.generate_distractors", AsyncMock(return_value=[])),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
            )).scalar_one()
            await _run_generation(s, job)
    return dict(gen.call_args.kwargs)


@pytest.mark.asyncio
async def test_a_from_scratch_job_sends_its_sets_title() -> None:
    kwargs = await _run_job(variation=False)
    assert kwargs["assignment_title"] == "Parallel & Perpendicular Lines"


@pytest.mark.asyncio
async def test_a_variation_job_goes_without_the_title() -> None:
    # Its reference question already fixes the topic.
    kwargs = await _run_job(variation=True)
    assert kwargs["assignment_title"] is None
