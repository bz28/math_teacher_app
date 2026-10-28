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
from api.core.question_bank_generation import _missing_figure, _named_points, _resolve_figure, _run_generation
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
    ("Use the graph paper to plot y = 2x.", False),
    ("Using the graph of y = x^2, describe the vertex.", False),
    ("As shown in the table, sales rose 4% a year.", False),
    ("Find the slope of the line on the graph shown.", True),
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


async def _run(batches: list[Any]) -> tuple[list[QuestionBankItem], AsyncMock]:
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


@pytest.mark.asyncio
async def test_a_failed_replacement_call_keeps_the_good_problems() -> None:
    items, gen = await _run([[GOOD, BROKEN], RuntimeError("upstream 529")])
    assert gen.await_count == 2
    assert [i.question for i in items] == [GOOD["text"]]


@pytest.mark.parametrize(("text", "names"), [
    (r"In the figure below, $\overline{DE} \parallel \overline{BC}$, where $D$ lies on $\overline{AB}$.",
     {"D", "E", "B", "C", "A"}),
    (r"Find $m\angle ADE$ in $\triangle ABC$.", {"A", "D", "E", "B", "C"}),
    ("Point P is on circle O; find ∠PQR.", {"P", "Q", "R"}),
    (r"Lines $m \parallel n$ are cut by transversal $t$; find $\angle 1$.", set()),
    ("Solve 2x + 3 = 11. A ladder leans on a wall.", set()),
    (r"$\\triangle A'B'C'$ is the image of $\\triangle ABC$.", {"A'", "B'", "C'", "A", "B", "C"}),
    ("Points A and B lie on circle O.", {"A", "B"}),
    ("△A′B′C′ is the image of △ABC.", {"A'", "B'", "C'", "A", "B", "C"}),
])
def test_points_a_problem_names(text: str, names: set[str]) -> None:
    assert _named_points(text) == names


TRIANGLE_ABC = {"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"],
                "side_lengths": {"AB": 5, "AC": 5, "BC": 4}}


def test_a_figure_missing_a_named_point_is_dropped() -> None:
    # Prod, 2026-10-21: "DE ∥ BC, D on AB, E on AC" drawn as a bare triangle ABC.
    text = r"In the figure below, $\overline{DE} \parallel \overline{BC}$, where $D$ lies on $\overline{AB}$."
    assert _resolve_figure(TRIANGLE_ABC, text) == (None, None)
    assert _missing_figure({"text": text, "figure_svg": None})


def test_a_figure_with_every_named_point_is_kept() -> None:
    spec, svg = _resolve_figure(TRIANGLE_ABC, r"In $\triangle ABC$ below, find $m\angle A$.")
    assert spec == TRIANGLE_ABC and svg


@pytest.mark.parametrize("prime", ["′", "’", "'"])
def test_primes_match_however_they_are_typed(prime: str) -> None:
    spec = {**TRIANGLE_ABC, "vertex_labels": {"A": f"$A{prime}$", "B": f"B{prime}", "C": f"C{prime}"}}
    out, svg = _resolve_figure(spec, r"Find $m\angle A'$ in $\triangle A'B'C'$.")
    assert out == spec and svg


def test_a_figure_labeled_with_the_problems_names_is_kept() -> None:
    # Keys A, B, C drawn as P, Q, R: the student reads P, Q, R.
    spec = {**TRIANGLE_ABC, "vertex_labels": {"A": "P", "B": "Q", "C": "R"}}
    out, svg = _resolve_figure(spec, r"Find $m\\angle PQR$ in $\\triangle PQR$.")
    assert out == spec and svg
