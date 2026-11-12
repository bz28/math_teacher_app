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
    assert figure_sentence(spec, "can you provide the drawing?", updated=False, problem_text=PROBLEM) == (
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


# ── Review round 1 ─────────────────────────────────────────────────────
#
# Each test failed before the round-1 fix it names, and fails again with
# that fix reverted.


def test_round1_figure_talk_naming_parts_is_dropped() -> None:
    """Finding 6a: the model writes before anything is drawn, so a sentence
    that names points or says it connected / included something goes."""
    for said in (
        "I connected B to D and put angle 1 at E.",
        "I've included the diagonal BD so students can see both triangles.",
        "Now BD splits the square into two triangles, with the right angle at C shown.",
        "The diagonal BD now appears too.",
        "Now BD and AC cross at E.",  # names only
        "I've included the diagonal so students can see both triangles.",  # figure words only
        "I extended it past the top so it's easier to see.",  # a figure verb only
    ):
        assert without_figure_talk(said + " I also tightened the wording.") == "I also tightened the wording.", said


def test_round1_parts_the_teacher_asks_to_connect_must_be_drawn() -> None:
    """Finding 6b: "connect B and D", "from B to D", "diagonal BD" are required."""
    from api.core.geometry.figure_check import parse_problem

    for request in ("Please connect B and D.", "connect B to D", "draw a segment from B to D", "with diagonal BD",
                    "join points B and D"):
        assert frozenset("BD") in parse_problem("", extra=request).segments, request
    rect = {k: v for k, v in GOOD.items() if k not in ("tick_groups", "parallel_groups")}
    _spec, svg, issues = qbg._check_figure(rect, "Find $BD$ in quadrilateral $ABCD$.", request="connect B and D")
    assert svg is None and "not drawn: BD" in issues


def test_round1_reply_never_claims_a_connection_it_didnt_draw() -> None:
    """Finding 6c: with no figure in the proposal, "I connected B to D" is a
    false claim."""
    out = _construction_reply(
        "Done — I connected B to D with the diagonal BD. The answer is 5.", {"final_answer": "5"}, _item(),
        "connect B to D", PROBLEM, top_construction=False, top_issues=[], step_drops={},
    )
    assert out == "The answer is 5.\n\nNo diagram was added."


def test_round1_givens_are_marked_only_when_all_are() -> None:
    """Finding 7: one of two givens marked is not "the givens are marked"."""
    half = {**GOOD, "tick_groups": []}
    assert figure_sentence(half, "draw it", updated=False, problem_text=PROBLEM) == (
        "I've added a diagram with points A, B, C and D."
    )
    assert figure_sentence(GOOD, "draw it", updated=False, problem_text=PROBLEM).endswith("; the givens are marked.")


@pytest.mark.parametrize(("name", "junk"), [
    ("tick_groups", []), ("tick_groups", ["AB"]), ("tick_groups", ["BC", "CB"]),
    ("arc_groups", []), ("arc_groups", ["ABC"]), ("arc_groups", ["ABC", "CBA"]),
    ("parallel_groups", []), ("parallel_groups", ["BC"]),
])
def test_round1_empty_mark_group_is_dropped_not_a_crash(name: str, junk: list[str]) -> None:
    """Finding 9: an empty group crashed the step checks with max([]). A
    group that ties fewer than two parts claims nothing: it is dropped and
    the figure is checked as usual (question and step alike); the DSL
    rejects any that reach it (test_figure_check)."""
    spec = {**GOOD, name: [*GOOD.get(name, []), junk]}
    kept, svg, issues = qbg._check_figure(spec, PROBLEM)
    assert svg and issues == [] and kept is not None and junk not in kept[name]
    out = qbg._render_step_figures(
        [{"title": "t", "description": "d", "figure_spec": spec}], question_text=PROBLEM, question_spec=GOOD,
    )
    assert out[0]["figure_svg"]


def test_round1_a_checker_crash_drops_the_figure_with_a_reason() -> None:
    """Finding 9: any checker exception drops the figure, never passes it,
    and never crashes the caller."""
    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("a checker bug")

    for target in ("check_construction", "unbacked_marks"):
        with patch.object(qbg, target, boom):
            spec, svg, issues = qbg._check_figure(GOOD, PROBLEM)
        assert (spec, svg) == (None, None) and issues == [qbg._CHECK_CRASHED], target


@pytest.mark.asyncio
async def test_round1_checker_crash_gets_no_pointless_retry() -> None:
    """A redraw can't fix a checker crash: no second model call."""
    redraw = AsyncMock(return_value=GOOD)
    with patch.object(qbg, "redraw_figure", redraw), patch.object(qbg, "check_construction", side_effect=RuntimeError):
        _s, svg, issues = await qbg._resolve_figure_with_retry(GOOD, PROBLEM, mode="m", user_id=None)
    assert svg is None and issues == [qbg._CHECK_CRASHED]
    redraw.assert_not_awaited()


@pytest.mark.asyncio
async def test_round1_problem_whose_figure_is_dropped_after_solving_is_left_out() -> None:
    """Finding 8: the post-solve answer check dropped the figure of "In the
    figure below …" and the problem shipped without it; now the
    missing-figure rule runs again and leaves it out."""
    import uuid

    from api.core.auth import hash_password
    from api.core.geometry.figure_check import FigureIssue
    from api.models.assignment import Assignment
    from api.models.question_bank import QuestionBankGenerationJob
    from api.models.unit import Unit
    from api.models.user import User

    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(
            email=f"t_{tag}@t.com", password_hash=hash_password("x"), grade_level=12, role="teacher", name="T",
        )
        course = Course(name="Geometry", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        unit = Unit(course_id=course.id, name="Unit 3", position=0)
        s.add(unit)
        await s.flush()
        hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id, title="Proofs",
                        type="homework", status="draft")
        s.add(hw)
        await s.flush()
        job = QuestionBankGenerationJob(course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                                        created_by_id=teacher.id, status="queued", requested_count=2)
        s.add(job)
        await s.commit()
        job_id, course_id = job.id, course.id

    with_figure = {"title": "f", "text": "In the figure below, " + PROBLEM, "difficulty": "easy", "figure_spec": GOOD}
    plain = {"title": "p", "text": "What is 2 + 2?", "difficulty": "easy"}

    def check(_fig: Any, _text: str, *, final_answer: str = "", **_kw: Any) -> list[FigureIssue]:
        # Passes before solving; the answer, once known, is on the figure.
        return [FigureIssue("label", "the label '4' gives away the answer")] if final_answer else []

    with (
        patch.object(qbg, "generate_questions", AsyncMock(return_value=[with_figure, plain])),
        patch.object(qbg, "generate_solutions", AsyncMock(return_value=[
            {"question_text": "f", "steps": [], "final_answer": "4"},
            {"question_text": "p", "steps": [], "final_answer": "4"},
        ])),
        patch.object(qbg, "generate_distractors", AsyncMock(return_value=[])),
        patch.object(qbg, "check_construction", check),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
            )).scalar_one()
            await qbg._run_generation(s, job)
    async with get_session_factory()() as s:
        query = select(QuestionBankItem).where(QuestionBankItem.course_id == course_id)
        items = (await s.execute(query)).scalars().all()
    assert [i.question for i in items] == ["What is 2 + 2?"]
