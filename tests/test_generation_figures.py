"""Generated problems never ship pointing at a figure they don't have,
and the solver sees the figure a problem is drawn with.

Prod, 2026-10-18: 5 problems said "in the figure below" with no figure
(the model emitted none), and one ("find the hypotenuse c in the right
triangle below") carried its numbers only in the figure, so the solver —
given the text alone — failed three times and stored "solution failed".
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from api.core.assignment_generation import generate_solutions
from api.core.auth import hash_password
from api.core.question_bank_generation import _missing_figure, _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit
from api.models.user import User

RIGHT_TRIANGLE = {"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"],
                  "right_angle_at": ["C"], "side_labels": {"AC": "9", "BC": "40", "AB": "c"}}


def _q(text: str, spec: dict[str, Any] | None = None) -> dict[str, Any]:
    q: dict[str, Any] = {"title": text[:20], "text": text, "difficulty": "easy"}
    if spec is not None:
        q["figure_spec"] = spec
    return q


@pytest.mark.parametrize(("text", "missing"), [
    ("In the figure below, AB = DE. Name the postulate.", True),
    ("Find the hypotenuse c in the right triangle below.", True),
    ("Using the diagram, find x.", True),
    ("A balloon is 300 feet above the ground.", False),
    ("The line above has slope 2; find a parallel line.", False),
    ("Solve 2x + 3 = 11.", False),
])
def test_what_counts_as_pointing_at_a_figure(text: str, missing: bool) -> None:
    assert _missing_figure({"text": text}) is missing


def test_a_drawn_figure_satisfies_the_pointer() -> None:
    assert not _missing_figure({"text": "In the figure below, find x.", "figure_svg": "<svg/>"})


@pytest.mark.asyncio
async def test_the_solver_is_shown_the_figure() -> None:
    decompose = AsyncMock(return_value=AsyncMock(steps=[], final_answer="41"))
    with patch("api.core.assignment_generation.decompose_problem", decompose):
        out = await generate_solutions([
            _q("Find the hypotenuse c in the right triangle below.", RIGHT_TRIANGLE),
            _q("Solve 2x + 3 = 11."),
        ])
    with_fig, plain = (c.args[0] for c in decompose.call_args_list)
    assert '"AC": "9"' in with_fig and '"BC": "40"' in with_fig
    assert plain == "Solve 2x + 3 = 11."
    # The stored question text is the problem as written, not the solver's briefing.
    assert out[0]["question_text"] == "Find the hypotenuse c in the right triangle below."


async def _run(batches: list[list[dict[str, Any]]]) -> tuple[list[QuestionBankItem], AsyncMock]:
    """Run a 2-problem job whose generate calls return `batches` in turn."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{tag}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T")
        course = Course(name="Geometry", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="Unit 4", position=0)
        s.add(unit)
        await s.flush()
        hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                        title="Triangle Congruence", type="homework", status="draft")
        s.add(hw)
        await s.flush()
        job = QuestionBankGenerationJob(course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                                        created_by_id=teacher.id, status="queued", requested_count=2)
        s.add(job)
        await s.commit()
        job_id, hw_id = job.id, hw.id

    gen = AsyncMock(side_effect=batches)

    async def solve(qs: list[dict[str, Any]], **_: Any) -> list[dict[str, Any]]:
        return [{"question_text": q["text"], "steps": [], "final_answer": "1"} for q in qs]

    with (
        patch("api.core.question_bank_generation.generate_questions", gen),
        patch("api.core.question_bank_generation.generate_solutions", solve),
        patch("api.core.question_bank_generation.generate_distractors", AsyncMock(return_value=[])),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
            )).scalar_one()
            await _run_generation(s, job)
    async with get_session_factory()() as s:
        items = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.originating_assignment_id == hw_id)
            .order_by(QuestionBankItem.created_at)
        )).scalars().all()
    return list(items), gen


GOOD = _q("Solve 2x + 3 = 11.")
BROKEN = _q("In the figure below, AB = DE and BC = EF. Name the postulate.")


@pytest.mark.asyncio
async def test_a_problem_citing_a_missing_figure_is_replaced() -> None:
    drawn = _q("Find the hypotenuse c in the right triangle below.", RIGHT_TRIANGLE)
    items, gen = await _run([[GOOD, BROKEN], [drawn]])
    assert gen.await_count == 2 and gen.await_args_list[1].kwargs["count"] == 1
    assert [i.question for i in items] == [GOOD["text"], drawn["text"]]
    assert items[1].figure_svg  # the replacement shipped with its figure


@pytest.mark.asyncio
async def test_a_replacement_with_the_same_flaw_is_left_out() -> None:
    items, gen = await _run([[GOOD, BROKEN], [BROKEN]])
    assert gen.await_count == 2
    assert [i.question for i in items] == [GOOD["text"]]


@pytest.mark.asyncio
async def test_a_batch_with_every_figure_drawn_makes_no_extra_call() -> None:
    drawn = _q("Find c in the right triangle below.", RIGHT_TRIANGLE)
    items, gen = await _run([[GOOD, drawn]])
    assert gen.await_count == 1 and len(items) == 2
