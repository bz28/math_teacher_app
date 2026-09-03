"""Tests for the Customize-section params on the generation modal.

Covers:
- Each non-default param translates to the right prompt instruction
  line via `_translate_params_to_instructions`.
- Defaults emit nothing (existing 1-click flow is unchanged).
- The MCQ format flag on the bank item follows the rule:
    requested mcq AND 3 distractors successfully generated  -> 'mcq'
    requested mcq AND fewer than 3 distractors              -> 'frq'
    requested frq (or default)                              -> 'frq'
"""

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from api.core.assignment_generation import (
    _build_question_generation_prompt,
    _translate_params_to_instructions,
)
from api.core.auth import hash_password
from api.core.question_bank_generation import _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher
from api.models.question_bank import (
    FORMAT_FRQ,
    FORMAT_MCQ,
    QuestionBankGenerationJob,
    QuestionBankItem,
)
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.unit import Unit
from api.models.user import User

# ── translator ──


def test_prompt_template_format_is_safe() -> None:
    """The generation prompt is a `.format()`-style template. Every
    literal curly brace in the body must be escaped as `{{`/`}}`,
    otherwise Python interprets it as a format placeholder and
    raises KeyError at call time. Caught by a real Pythagorean
    job failing in prod with `KeyError: '"A"'` when the prompt's
    figure-spec example `{"A": 30, "B": 150}` was unescaped.
    """
    # Just calling the builder must succeed for every subject.
    for subject in ("math", "physics", "chemistry"):
        out = _build_question_generation_prompt(subject)
        assert "figure_spec" in out  # sanity check: geometry section present


def test_defaults_emit_no_instructions() -> None:
    # All-default param dict (matches GenerationParams()'s model_dump)
    defaults = {
        "problem_type": "mixed",
        "answer_form": "auto",
        "difficulty": "mixed",
        "calculator": "either",
        "format": "frq",
    }
    assert _translate_params_to_instructions(defaults) == []
    # None should also be a no-op (the 1-click case).
    assert _translate_params_to_instructions(None) == []


def test_every_non_default_value_translates_to_a_line() -> None:
    # One non-default per axis. The function returns the bullets in a
    # known order, so we just check each line is present.
    params = {
        "problem_type": "word",
        "answer_form": "radical",
        "difficulty": "medium",
        "calculator": "no_calc",
        "format": "mcq",
    }
    lines = _translate_params_to_instructions(params)
    assert any("word problems" in line for line in lines)
    assert any("radical form" in line for line in lines)
    assert any("MEDIUM level" in line for line in lines)
    assert any("No-calculator" in line for line in lines)
    assert any("multiple choice" in line for line in lines)
    assert len(lines) == 5


def test_whole_numbers_instructs_design_not_rounding() -> None:
    """The whole-numbers option is the only answer_form that constrains
    how a problem is BUILT rather than how a finished answer is written,
    and it carries the one failure mode in this feature that reaches a
    student: told merely to "make answers whole", a model will round 4.7
    to 5 and state a wrong answer under the teacher's name. The emitted
    line must forbid that explicitly and offer the escape hatch."""
    line = _translate_params_to_instructions(
        {"problem_type": "mixed", "answer_form": "integer",
         "difficulty": "mixed", "calculator": "either", "format": "frq"},
    )[0]
    assert "whole number" in line
    # The ban has to be explicit, not implied by "exactly".
    assert "NEVER round" in line
    # And a way out for topics that genuinely can't comply, so the model
    # rewrites the problem instead of faking the answer.
    assert "write a different problem" in line


def test_partial_non_defaults_emit_only_relevant_lines() -> None:
    params = {
        "problem_type": "mixed",
        "answer_form": "auto",
        "difficulty": "ramp",
        "calculator": "either",
        "format": "frq",
    }
    lines = _translate_params_to_instructions(params)
    assert len(lines) == 1
    assert "first third easy" in lines[0]


# ── worker: format flag on bank items ──


async def _seed_world() -> dict[str, uuid.UUID]:
    """A minimal teacher/course/unit/assignment graph the worker needs.
    Returns ids for the assignment + unit + teacher so the test can
    create a job pointing at them.
    """
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_bank_items, question_bank_generation_jobs, "
            "assignments, units, course_teachers, courses, schools, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    async with get_session_factory()() as s:
        school = School(
            name=f"School {tag}", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Contact", contact_email=f"c_{tag}@s.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"t_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="T", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name=f"Alg {tag}", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 1", type="homework", status="draft", content={"problems": []},
        )
        s.add(assignment)
        await s.commit()
        await s.refresh(assignment)
        return {
            "teacher_id": teacher.id,
            "course_id": course.id,
            "unit_id": unit.id,
            "assignment_id": assignment.id,
        }


async def _run_with_mocked_ai(
    params: dict[str, Any],
    *,
    distractor_lists: list[list[str]],
) -> list[QuestionBankItem]:
    """Run the generation worker for a single job, mocking the model
    calls. Returns the produced bank items."""
    seed = await _seed_world()

    async with get_session_factory()() as s:
        job = QuestionBankGenerationJob(
            course_id=seed["course_id"],
            unit_id=seed["unit_id"],
            originating_assignment_id=seed["assignment_id"],
            created_by_id=seed["teacher_id"],
            status="queued",
            requested_count=len(distractor_lists),
            difficulty="mixed",
            params=params,
        )
        s.add(job)
        await s.commit()
        await s.refresh(job)
        job_id = job.id

    # One mocked "question" + "solution" pair per requested item.
    questions = [
        {"title": f"Q{i}", "text": f"What is {i} + 1?", "difficulty": "medium"}
        for i in range(len(distractor_lists))
    ]
    solutions = [
        {"question_text": q["text"], "steps": [], "final_answer": str(i + 1)}
        for i, q in enumerate(questions)
    ]

    with (
        patch("api.core.question_bank_generation.generate_questions",
              AsyncMock(return_value=questions)),
        patch("api.core.question_bank_generation.generate_solutions",
              AsyncMock(return_value=solutions)),
        patch(
            "api.core.question_bank_generation.generate_distractors",
            new=AsyncMock(side_effect=lambda *a, **k: distractor_lists.pop(0)),
        ),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(
                    QuestionBankGenerationJob.id == job_id,
                )
            )).scalar_one()
            await _run_generation(s, job)

    async with get_session_factory()() as s:
        items = (await s.execute(
            select(QuestionBankItem).order_by(QuestionBankItem.created_at)
        )).scalars().all()
        return list(items)


@pytest.mark.asyncio
async def test_mcq_requested_with_distractors_persists_mcq() -> None:
    items = await _run_with_mocked_ai(
        params={
            "problem_type": "mixed", "answer_form": "auto",
            "difficulty": "mixed", "calculator": "either", "format": "mcq",
        },
        distractor_lists=[["0", "2", "3"], ["1", "3", "4"]],
    )
    assert len(items) == 2
    assert all(item.format == FORMAT_MCQ for item in items)


@pytest.mark.asyncio
async def test_mcq_requested_but_distractors_fail_falls_back_to_frq() -> None:
    # Empty distractors simulate the failure path. Item should
    # auto-downgrade to FRQ rather than persist with format=mcq and
    # nothing to render.
    items = await _run_with_mocked_ai(
        params={
            "problem_type": "mixed", "answer_form": "auto",
            "difficulty": "mixed", "calculator": "either", "format": "mcq",
        },
        distractor_lists=[[], []],
    )
    assert len(items) == 2
    assert all(item.format == FORMAT_FRQ for item in items)


@pytest.mark.asyncio
async def test_frq_default_stays_frq() -> None:
    # Default params (no MCQ requested). Even with successful
    # distractors, format stays frq.
    items = await _run_with_mocked_ai(
        params=None,
        distractor_lists=[["0", "2", "3"]],
    )
    assert len(items) == 1
    assert items[0].format == FORMAT_FRQ


# Run the asyncio tests under the project's standard event loop config.
if __name__ == "__main__":
    asyncio.run(test_mcq_requested_with_distractors_persists_mcq())  # type: ignore[func-returns-value]
