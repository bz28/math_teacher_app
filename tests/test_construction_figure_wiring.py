"""Construction figures in the product: the one retry, step figures, what
the teacher is told in the workshop chat, the missing-figure rule, and the
prompts."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

import api.core.question_bank_generation as qbg
from api.core import assignment_generation
from api.core.construction_figures import failure_sentence, figure_sentence, without_figure_talk
from api.core.question_bank_chat import _chat_system_prompt, _construction_reply
from api.database import get_session_factory
from api.models.course import Course
from api.models.question_bank import QuestionBankItem

PROBLEM = (
    r"Given $\overline{AB} \parallel \overline{CD}$ and $\overline{AB} \cong \overline{CD}$. "
    r"Prove $\overline{AD} \cong \overline{BC}$."
)
GOOD = {
    "type": "geometry", "shape": "construction",
    "points": {"A": [0, 0], "B": [4, 0], "C": [5, 3], "D": [1, 3]},
    "segments": ["AB", "BC", "CD", "DA"],
    "parallel_groups": [["AB", "DC"]], "tick_groups": [["AB", "DC"]],
}
BAD = {**GOOD, "points": {"A": [0, 0], "B": [4, 0], "C": [5, 3], "D": [0, 3]}}  # CD longer than AB


# ── The one retry ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_failing_figure_gets_one_retry_with_the_checkers_errors() -> None:
    redraw = AsyncMock(return_value=GOOD)
    with patch.object(qbg, "redraw_figure", redraw):
        spec, svg, issues = await qbg._resolve_figure_with_retry(BAD, PROBLEM, mode="bank_chat", user_id=None)
    assert spec == GOOD and svg and issues == []
    redraw.assert_awaited_once()
    sent_issues = redraw.await_args.args[2]
    assert any("AB ≅ CD is not true" in m for m in sent_issues), sent_issues
    assert redraw.await_args.kwargs["mode"] == "bank_chat"


@pytest.mark.asyncio
async def test_second_failure_saves_no_figure_and_says_why() -> None:
    redraw = AsyncMock(return_value=BAD)
    with patch.object(qbg, "redraw_figure", redraw):
        spec, svg, issues = await qbg._resolve_figure_with_retry(BAD, PROBLEM, mode="bank_chat", user_id=None)
    assert (spec, svg) == (None, None)
    assert any("AB ≅ CD is not true" in m for m in issues)
    redraw.assert_awaited_once()  # one retry, never two


@pytest.mark.asyncio
async def test_passing_figure_and_old_shapes_get_no_retry() -> None:
    redraw = AsyncMock()
    with patch.object(qbg, "redraw_figure", redraw):
        _spec, svg, issues = await qbg._resolve_figure_with_retry(GOOD, PROBLEM, mode="m", user_id=None)
        assert svg and issues == []
        bad_triangle = {"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"],
                        "side_lengths": {"AB": 1, "BC": 1, "CA": 5}}
        await qbg._resolve_figure_with_retry(bad_triangle, "", mode="m", user_id=None)
    redraw.assert_not_awaited()


def test_derived_marks_are_removed_from_a_question_figure() -> None:
    problem = PROBLEM + r" Prove $\triangle ABC \cong \triangle CDA$."
    with_arcs = {**GOOD, "segments": [*GOOD["segments"], "AC"], "arc_groups": [["BAC", "DCA"]]}
    spec, svg, issues = qbg._check_figure(with_arcs, problem, final_answer="", request="", step_text=None, base=None)
    assert issues == [] and svg
    assert spec is not None and spec["arc_groups"] == []
    assert spec["tick_groups"] == [["AB", "DC"]]


# ── Step figures ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_step_figure_that_moves_a_point_is_retried_then_dropped() -> None:
    moved = {**GOOD, "points": {**GOOD["points"], "D": [1.5, 3]}, "segments": [*GOOD["segments"], "AC"]}
    kept = {**GOOD, "segments": [*GOOD["segments"], "AC"]}
    steps = [{"title": "Draw AC", "description": "Draw the diagonal AC.", "figure_spec": moved}]

    redraw = AsyncMock(return_value=kept)
    with patch.object(qbg, "redraw_figure", redraw):
        out, drops = await qbg._render_step_figures_with_retry(
            steps, question_text=PROBLEM, question_spec=GOOD, mode="m", user_id=None,
        )
    assert drops == {} and out[0]["figure_svg"]
    assert any("point D is not where" in m for m in redraw.await_args.args[2])

    redraw = AsyncMock(return_value=moved)
    with patch.object(qbg, "redraw_figure", redraw):
        out, drops = await qbg._render_step_figures_with_retry(
            steps, question_text=PROBLEM, question_spec=GOOD, mode="m", user_id=None,
        )
    assert "figure_svg" not in out[0] and out[0]["description"] == "Draw the diagonal AC."
    assert any("point D is not where the question's figure puts it" in m for m in drops[1])


@pytest.mark.asyncio
async def test_step_figure_must_keep_the_questions_pieces() -> None:
    fewer = {**GOOD, "segments": ["AB", "CD"], "tick_groups": [], "parallel_groups": []}
    steps = [{"title": "s", "description": "Use the parallel sides.", "figure_spec": fewer}]
    with patch.object(qbg, "redraw_figure", AsyncMock(return_value=None)):
        _out, drops = await qbg._render_step_figures_with_retry(
            steps, question_text=PROBLEM, question_spec=GOOD, mode="m", user_id=None,
        )
    assert any("leaves out BC" in m for m in drops[1])


# ── What the teacher is told ───────────────────────────────────────────


def test_figure_sentence_is_written_from_what_was_drawn() -> None:
    spec = {**GOOD, "segments": [*GOOD["segments"], "AC"]}
    assert figure_sentence(spec, "can you provide the drawing?", updated=False) == (
        "I've added a diagram with points A, B, C and D, with AC drawn; the givens are marked."
    )
    plain = {k: v for k, v in GOOD.items() if k not in ("tick_groups", "parallel_groups")}
    assert figure_sentence(plain, "draw it", updated=True) == "I've updated the diagram with points A, B, C and D."


def test_figure_sentence_names_the_parts_the_teacher_asked_for() -> None:
    spec = {
        "type": "geometry", "shape": "construction",
        "points": {"W": [0, 3], "X": [0, 0], "M": [2, 0], "Y": [4, 0], "Z": [4, 3]},
        "segments": ["WX", "XY", "YZ", "WM", "ZM"],
    }
    out = figure_sentence(spec, "include segments WM and ZM", updated=False)
    assert out == "I've added a diagram with points W, X, M, Y and Z, with MW and MZ drawn."


def test_failure_sentence() -> None:
    assert failure_sentence(["the given AB ∥ CD is not true in the drawing"]) == (
        "I couldn't draw a correct diagram: the given AB ∥ CD is not true in the drawing."
    )
    assert failure_sentence(["a", "b", "c", "d", "e"], step=2) == (
        "I couldn't draw the diagram for step 2: a; b; c; d; and more."
    )


def test_without_figure_talk_keeps_the_rest() -> None:
    reply = "Here's the diagram with diagonal AC drawn. I also tightened the wording. AC is labelled."
    assert without_figure_talk(reply) == "I also tightened the wording."


def _item(**kw: Any) -> Any:
    return SimpleNamespace(**{"figure_spec": None, "figure_svg": None, "question": PROBLEM, **kw})


def test_chat_reply_replaces_the_models_figure_talk() -> None:
    proposal = {"figure_spec": GOOD, "figure_svg": "<svg/>"}
    out = _construction_reply(
        "Sure! Here's the drawing with diagonal AC drawn.", proposal, _item(), "can you provide the drawing?",
        PROBLEM, top_construction=True, top_issues=[], step_drops={},
    )
    assert out == "Sure!\n\nI've added a diagram with points A, B, C and D; the givens are marked."


def test_chat_reply_when_the_figure_fails_and_nothing_else_changes() -> None:
    out = _construction_reply(
        "Here's the diagram.", None, _item(), "draw it", PROBLEM,
        top_construction=True, top_issues=["the given AB ≅ CD is not true in the drawing"], step_drops={},
    )
    assert out == (
        "I couldn't draw a correct diagram: the given AB ≅ CD is not true in the drawing. Nothing was changed."
    )


def test_chat_reply_never_claims_a_figure_that_wasnt_drawn() -> None:
    out = _construction_reply(
        "I've added a diagram showing the parallel lines. The answer is 12.", {"final_answer": "12"}, _item(),
        "fix it", PROBLEM, top_construction=False, top_issues=[], step_drops={},
    )
    assert "added a diagram" not in out
    assert out == "The answer is 12.\n\nNo diagram was added."


def test_chat_reply_reports_a_dropped_step_figure() -> None:
    proposal = {"solution_steps": [{"title": "s1"}, {"title": "s2"}]}
    out = _construction_reply(
        "I added a diagram to step 2. The steps are clearer now.", proposal, _item(), "add a step diagram",
        PROBLEM, top_construction=False, top_issues=[],
        step_drops={2: ["point D is not where the question's figure puts it"]},
    )
    assert out == (
        "The steps are clearer now.\n\nI couldn't draw the diagram for step 2: point D is not where the "
        "question's figure puts it. That step is shown without one."
    )


def test_chat_reply_flags_a_problem_that_points_at_a_missing_figure() -> None:
    """Prod 985bff41: "In the figure below…" with no figure."""
    question = r"In the figure below, $\overrightarrow{OA}$ and $\overrightarrow{OD}$ are opposite rays."
    out = _construction_reply(
        "I tidied the wording.", {"question": question}, _item(question=question), "tidy it",
        question, top_construction=False, top_issues=[], step_drops={},
    )
    assert out.endswith("This problem refers to a figure, and it doesn't have one yet.")
    with_figure = _construction_reply(
        "I tidied the wording.", None, _item(question=question, figure_svg="<svg/>"), "tidy it",
        question, top_construction=False, top_issues=[], step_drops={},
    )
    assert "refers to a figure" not in with_figure


# ── Regenerate: a problem that points at a figure it can't have ────────


@pytest.mark.asyncio
async def test_regenerate_refuses_a_problem_pointing_at_a_missing_figure() -> None:
    from tests.test_single_answer_practice import _world

    w = await _world("homework")
    async with get_session_factory()() as s:
        item = QuestionBankItem(
            course_id=w["course"], unit_id=w["unit"], originating_assignment_id=w["assignment"],
            title="t", question="old", final_answer="1", status="approved", source="generated",
        )
        s.add(item)
        await s.commit()
        item_id = item.id
    call = AsyncMock(return_value={
        "title": "t", "question": r"In the figure below, find $m\angle ABC$.",
        "solution_steps": [], "final_answer": "40°",
    })
    with patch("api.core.question_bank_generation.call_claude_json", call):
        async with get_session_factory()() as s:
            item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
            course = (await s.execute(select(Course).where(Course.id == w["course"]))).scalar_one()
            with pytest.raises(RuntimeError, match="refers to a figure that couldn't be drawn"):
                await qbg.regenerate_one(s, item, course, instructions=None, user_id=w["teacher"])
    async with get_session_factory()() as s:
        item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
        assert item.question == "old"


# ── The prompts ────────────────────────────────────────────────────────


def test_prompts_teach_the_construction_format() -> None:
    chat = _chat_system_prompt("math professor")
    assert '"shape": "construction"' in chat and "<<FIGURES>>" not in chat
    assert '"shape": "construction"' in assignment_generation._build_question_generation_prompt("math")


# ── The retry call itself ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_redraw_prompt_is_the_same_whatever_the_key_order() -> None:
    """A recorded spec comes back from its cassette with sorted keys; the
    retry's prompt must not change with key order, or a replay misses."""
    from api.core import construction_figures

    call = AsyncMock(return_value={"figure_spec": GOOD})
    with patch.object(construction_figures, "call_claude_json", call):
        await construction_figures.redraw_figure(PROBLEM, GOOD, ["x"], mode="m", user_id=None)
        await construction_figures.redraw_figure(
            PROBLEM, dict(reversed(list(GOOD.items()))), ["x"], mode="m", user_id=None,
        )
    first, second = (c.args[1] for c in call.await_args_list)
    assert first == second


@pytest.mark.asyncio
async def test_redraw_uses_the_same_model_and_mode_with_room_to_work() -> None:
    from api.core import construction_figures
    from api.core.llm_client import MODEL_REASON

    call = AsyncMock(return_value={"figure_spec": GOOD})
    with patch.object(construction_figures, "call_claude_json", call):
        out = await construction_figures.redraw_figure(PROBLEM, BAD, ["the given AB ≅ CD is not true"],
                                                       mode="bank_chat", user_id=None)
    assert out == GOOD
    kwargs = call.await_args.kwargs
    assert kwargs["mode"] == "bank_chat" and kwargs["model"] == MODEL_REASON
    assert kwargs["thinking_budget"] >= 1024 and kwargs["max_tokens"] > kwargs["thinking_budget"]
    assert "the given AB ≅ CD is not true" in call.await_args.args[1]
