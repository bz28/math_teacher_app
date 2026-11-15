"""Problems the AI writes come with a fact card, and generation uses it.

- The problem's words are written by code from the card (the AI's own text
  is ignored); the figure is checked against the card, never against two
  readings of the words (no reading call is made).
- Who draws what is on the card: an auxiliary line the card shows is drawn
  ("Draw the median AD. Prove …" keeps its figure: before, the words said
  "draw", so its figure was dropped), what the student constructs never is.
- A figure that fails gets its redraw, then one fresh drawing from the card.
- The card is stored with the problem, marked as the author's.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

import api.core.question_bank_generation as qbg
from api.core import assignment_generation
from api.core.geometry.facts import FigureFacts


def F(kind: str, items: list[str], **kw: Any) -> dict[str, Any]:  # noqa: N802 - a fact
    return {"kind": kind, "items": items, **kw}


REQUEST = qbg.ProblemRequest(unit_name="Unit 4", course_name="Geometry", subject="math", user_id="u", job_id="j")

# "In △ABC, AB = AC. Draw the median AD. Prove ∠B ≅ ∠C." as a card: the
# median is a segment the figure shows (the old KNOWN_DROPPED_AUX_PROOFS).
MEDIAN = {"points": list("ABCD"), "triangles": ["ABC"], "segments": ["AD"],
          "givens": [F("congruent_segments", ["AB", "AC"]), F("midpoint", ["BC"], point="D")],
          "prove": [F("congruent_angles", ["B", "C"])]}
MEDIAN_FIGURE = {"type": "geometry", "shape": "construction",
                 "points": {"A": [3, 5], "B": [0, 0], "C": [6, 0], "D": [3, 0]},
                 "segments": ["AB", "BC", "CA", "AD"], "tick_groups": [["AB", "AC"], ["BD", "DC"]]}
MEDIAN_TEXT = (r"The figure shows $\triangle ABC$ and $\overline{AD}$. Given: $\overline{AB} \cong \overline{AC}$ "
               r"and $D$ is the midpoint of $\overline{BC}$. Prove: $\angle B \cong \angle C$.")
# The student constructs the bisector AD; the figure shows △ABC only.
BISECTOR = {"points": list("ABC"), "triangles": ["ABC"], "givens": [F("congruent_segments", ["AB", "AC"])],
            "constructs": [F("bisects_angle", ["AD", "BAC"]), F("on_segment", ["BC"], point="D")],
            "prove": [F("congruent_triangles", ["ABD", "ACD"])]}
TRIANGLE = {"type": "geometry", "shape": "construction", "points": {"A": [3, 5], "B": [0, 0], "C": [6, 0]},
            "segments": ["AB", "BC", "CA"], "tick_groups": [["AB", "AC"]]}
WITH_D = {**TRIANGLE, "points": {**TRIANGLE["points"], "D": [3, 0]}, "segments": [*TRIANGLE["segments"], "AD"]}
WRONG_MEDIAN = {**MEDIAN_FIGURE, "points": {**MEDIAN_FIGURE["points"], "D": [2, 0]}}  # D off the midpoint


def _written(card: Any, spec: Any = None, *, text: str = "", flag: bool | None = None, **kw: Any) -> dict[str, Any]:
    q: dict[str, Any] = {"title": "t", "text": text, "difficulty": "medium", "figure_facts": card, **kw}
    if spec is not None:
        q["figure_spec"] = spec
    if flag is not None:
        q["requires_drawing"] = flag
    return q


async def _generate(
    batches: list[list[dict[str, Any]]], *, redraw: Any = None, fresh: Any = None,
) -> tuple[list[dict[str, Any]], dict[str, AsyncMock]]:
    """generate_checked_problems over the real generate_questions (its
    normalization included), the model's replies given as `batches`."""
    mocks = {
        "call": AsyncMock(side_effect=[{"questions": b} for b in batches]),
        "read": AsyncMock(return_value=(None, ["no reading"])),
        "redraw": AsyncMock(return_value=redraw),
        "fresh": AsyncMock(return_value=fresh),
    }
    with (
        patch.object(assignment_generation, "call_claude_json", mocks["call"]),
        patch.object(qbg, "read_figure_facts", mocks["read"]),
        patch.object(qbg, "redraw_figure", mocks["redraw"]),
        patch.object(qbg, "draw_figure", mocks["fresh"]),
    ):
        out = await qbg.generate_checked_problems(REQUEST, count=len(batches[0]))
    return out, mocks


PLAIN = {"title": "t", "text": "Solve 2x + 3 = 11.", "difficulty": "easy"}


@pytest.mark.asyncio
async def test_a_card_problem_is_written_by_code_and_checked_against_its_card() -> None:
    out, m = await _generate([[_written(MEDIAN, MEDIAN_FIGURE, text="Ignore me: AB = 99."), PLAIN]])
    q = out[0]
    assert q["text"] == MEDIAN_TEXT  # code's words, never the AI's
    assert q["figure_svg"] and q["figure_spec"] == MEDIAN_FIGURE
    m["read"].assert_not_awaited()  # no readings of the words
    m["redraw"].assert_not_awaited() and m["fresh"].assert_not_awaited()
    stored = FigureFacts.model_validate(q["figure_facts"])
    assert stored.source == "author" and stored.segments == ["AD", "AB", "AC", "BC"]


@pytest.mark.asyncio
async def test_an_aux_line_the_card_shows_keeps_the_figure() -> None:
    """Pin: "Draw the median AD. Prove …" keeps its figure, with AD drawn,
    though the AI said the student draws (the old word rule dropped it)."""
    out, _ = await _generate([[_written(MEDIAN, MEDIAN_FIGURE, flag=True), PLAIN]])
    assert out[0]["figure_svg"] and "AD" in out[0]["figure_spec"]["segments"]
    assert out[0]["requires_drawing"] is False  # the card says the student constructs nothing


@pytest.mark.asyncio
async def test_a_construction_shows_its_givens_and_never_the_constructed_part() -> None:
    out, _ = await _generate([[_written(BISECTOR, TRIANGLE), PLAIN]])
    assert out[0]["figure_svg"] and "D" not in out[0]["figure_spec"]["points"]
    assert out[0]["requires_drawing"] is True  # the student constructs AD
    assert "Construct the figure so that" in out[0]["text"]


@pytest.mark.asyncio
async def test_a_figure_that_draws_the_constructed_part_is_never_shown() -> None:
    """Drafted, redrawn and drawn fresh, each with the student's D and AD:
    no figure, so the problem is replaced (here by a plain one)."""
    out, m = await _generate([[_written(BISECTOR, WITH_D), PLAIN], [dict(PLAIN, text="Solve 5x = 20.")]],
                             redraw=WITH_D, fresh=WITH_D)
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]
    assert any("which the student constructs" in i for i in m["redraw"].await_args.args[2])
    m["fresh"].assert_awaited_once()


@pytest.mark.asyncio
async def test_a_failed_figure_gets_its_redraw_then_one_fresh_drawing() -> None:
    out, m = await _generate([[_written(MEDIAN, WRONG_MEDIAN), PLAIN]], redraw=WRONG_MEDIAN, fresh=MEDIAN_FIGURE)
    m["redraw"].assert_awaited_once()
    m["fresh"].assert_awaited_once()
    assert m["fresh"].await_args.args[1].source == "author"  # drawn from the card
    assert out[0]["figure_spec"] == MEDIAN_FIGURE and out[0]["figure_svg"]


@pytest.mark.asyncio
async def test_a_card_with_no_figure_drafted_is_drawn_fresh() -> None:
    out, m = await _generate([[_written(MEDIAN), PLAIN]], fresh=MEDIAN_FIGURE)
    m["redraw"].assert_not_awaited()
    m["fresh"].assert_awaited_once()
    assert out[0]["figure_svg"]


@pytest.mark.asyncio
async def test_a_card_code_cant_hold_a_figure_to_means_the_problem_is_replaced() -> None:
    other = {**MEDIAN, "givens": [F("other", ["AB"])]}
    out, m = await _generate([[_written(other, MEDIAN_FIGURE, text="AB is nice."), PLAIN],
                              [dict(PLAIN, text="Solve 5x = 20.")]])
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]
    m["read"].assert_not_awaited()


@pytest.mark.asyncio
async def test_a_context_that_names_a_point_is_left_out() -> None:
    out, _ = await _generate([[
        _written(MEDIAN, MEDIAN_FIGURE, context="A ladder AB leans on a wall.", hint="Draw a line."), PLAIN]])
    assert out[0]["text"] == MEDIAN_TEXT
    kept, _ = await _generate([[
        _written(MEDIAN, MEDIAN_FIGURE, context="A carpenter is building a roof truss.",
                 hint="Look for two congruent triangles."), PLAIN]])
    assert kept[0]["text"] == ("A carpenter is building a roof truss. " + MEDIAN_TEXT
                               + " Hint: Look for two congruent triangles.")


@pytest.mark.asyncio
async def test_two_card_problems_with_the_same_card_are_one() -> None:
    """Set distinctness holds for code-written words: the repeat is replaced."""
    out, m = await _generate([[_written(MEDIAN, MEDIAN_FIGURE), _written(MEDIAN, MEDIAN_FIGURE)], [PLAIN]])
    assert [q["text"] for q in out] == [MEDIAN_TEXT, PLAIN["text"]]
    assert m["call"].await_count == 2


@pytest.mark.asyncio
async def test_after_solving_the_card_still_checks_the_figure() -> None:
    """The stored card (a dict) is what the answer check runs against."""
    out, _ = await _generate([[_written(MEDIAN, MEDIAN_FIGURE), PLAIN]])
    solved = [{"question_text": q["text"], "steps": [], "final_answer": "1"} for q in out]
    with patch.object(qbg, "generate_solutions", AsyncMock(return_value=solved)):
        kept, _ = await qbg.solve_checked_problems(out, subject="math", user_id="u", job_id="j")
    assert kept[0]["figure_svg"] and kept[0]["figure_facts"]["source"] == "author"


# ── Regenerate ─────────────────────────────────────────────────────────


async def _regenerate(reply: dict[str, Any], *, teacher: bool | None = None, fresh: Any = None) -> tuple[Any, Any]:
    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.course import Course
    from api.models.question_bank import QuestionBankItem
    from tests.test_single_answer_practice import _world

    w = await _world("homework")
    async with get_session_factory()() as s:
        item = QuestionBankItem(
            course_id=w["course"], unit_id=w["unit"], originating_assignment_id=w["assignment"],
            title="t", question="old", final_answer="1", status="approved", source="generated",
            requires_drawing=bool(teacher), requires_drawing_teacher_set=teacher is not None,
        )
        s.add(item)
        await s.commit()
        item_id = item.id
    call = AsyncMock(return_value={"title": "t", "solution_steps": [], "final_answer": "1", **reply})
    draw = AsyncMock(return_value=fresh)
    with (
        patch("api.core.question_bank_generation.call_claude_json", call),
        patch.object(qbg, "read_figure_facts", AsyncMock(return_value=(None, ["no reading"]))) as read,
        patch.object(qbg, "draw_figure", draw),
        patch.object(qbg, "generate_distractors", AsyncMock(return_value=[])),
    ):
        async with get_session_factory()() as s:
            item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
            course = (await s.execute(select(Course).where(Course.id == w["course"]))).scalar_one()
            await qbg.regenerate_one(s, item, course, instructions=None, user_id=w["teacher"])
    read.assert_not_awaited()
    async with get_session_factory()() as s:
        item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
    return item, draw


@pytest.mark.asyncio
async def test_regenerate_writes_the_new_version_from_its_card_and_stores_it() -> None:
    item, _ = await _regenerate({"question": "", "figure_facts": MEDIAN, "figure_spec": MEDIAN_FIGURE,
                                 "requires_drawing": True})
    assert item.question == MEDIAN_TEXT and item.figure_svg
    assert item.figure_facts["source"] == "author" and item.requires_drawing is False


@pytest.mark.asyncio
async def test_regenerate_keeps_a_teachers_the_student_draws_it() -> None:
    """The teacher's choice stands over the card: no figure, and none drawn fresh."""
    item, draw = await _regenerate({"question": "", "figure_facts": MEDIAN, "figure_spec": MEDIAN_FIGURE},
                                   teacher=True, fresh=MEDIAN_FIGURE)
    assert item.question == MEDIAN_TEXT.replace("The figure shows", "Draw")
    assert item.figure_svg is None and item.figure_facts is None
    assert item.requires_drawing is True
    draw.assert_not_awaited()


@pytest.mark.asyncio
async def test_regenerate_refuses_a_figure_without_a_card() -> None:
    """Refused for having no card (never checked, never read back)."""
    with pytest.raises(RuntimeError, match="has a figure that couldn't be drawn.*without its fact card"):
        await _regenerate({"question": r"In $\triangle ABC$, $AB = AC$. Find $m\angle B$.", "figure_spec": TRIANGLE})


@pytest.mark.asyncio
async def test_regenerate_says_why_a_card_was_refused() -> None:
    bad = dict(MEDIAN, givens=[{"kind": "other", "items": ["AB"]}])
    with pytest.raises(RuntimeError, match="couldn't be written.*kind the checker can't hold a figure to: other"):
        await _regenerate({"question": "", "figure_facts": bad, "figure_spec": MEDIAN_FIGURE})
