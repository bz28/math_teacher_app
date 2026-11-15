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

import uuid
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
    assert "Make a construction so that" in out[0]["text"]


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
        _written(MEDIAN, MEDIAN_FIGURE, context="A carpenter is building a roof frame.",
                 hint="Work backward from what you need to prove."), PLAIN]])
    assert kept[0]["text"] == ("A carpenter is building a roof frame. " + MEDIAN_TEXT
                               + " Hint: Work backward from what you need to prove.")
    # A theorem's name is not a hint (independent round 3): left out.
    no_sas, _ = await _generate([[_written(MEDIAN, MEDIAN_FIGURE, hint="Use SAS."), PLAIN]])
    assert no_sas[0]["text"] == MEDIAN_TEXT


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


# ── Review round 1 ─────────────────────────────────────────────────────

RIGHT = {"points": list("ABC"), "triangles": ["ABC"],
         "givens": [F("equal_length", ["AB"], value=7), F("right_angle", ["ACB"])],
         "find": [{"kind": "segment", "item": "BC"}]}
# The shape form, with a label the card contradicts and no right angle.
SHAPE = {"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"],
         "side_lengths": {"AB": 12, "BC": 4, "CA": 9}, "labels": {"AB": "12"}}


@pytest.mark.asyncio
async def test_a_shape_form_figure_is_never_shown_for_a_card() -> None:
    """The shape form skips the card's check, so it is never shown with a
    card: the card's fresh drawing instead (here none, so it is replaced)."""
    out, m = await _generate([[_written(RIGHT, SHAPE), PLAIN], [dict(PLAIN, text="Solve 5x = 20.")]])
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]
    m["fresh"].assert_awaited_once()
    m["read"].assert_not_awaited()


@pytest.mark.asyncio
async def test_regenerate_a_construction_the_teacher_says_the_student_draws() -> None:
    """The text points at no figure, so the version with no figure stands."""
    item, draw = await _regenerate({"question": "", "figure_facts": BISECTOR, "figure_spec": TRIANGLE},
                                   teacher=True)
    assert item.question.startswith(r"Draw $\triangle ABC$.") and "Make a construction so that" in item.question
    assert item.figure_svg is None and item.requires_drawing is True
    draw.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_chat_figure_edit_is_held_to_the_author_card() -> None:
    """A teacher asks the chat for a new figure on a problem written from
    its card: the figure is checked against the card (never readings of
    code's words), so one drawing the student's D is never proposed."""
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    import api.core.question_bank_chat as qbc
    from api.core.geometry.fact_card import card_text, read_card

    card, why = read_card(BISECTOR)
    assert card is not None, why
    item = SimpleNamespace(
        id=uuid.uuid4(), course_id=uuid.uuid4(), unit_id=None, source_doc_ids=None,
        question=card_text(card), solution_steps=None, final_answer="", generation_prompt=None,
        chat_messages=[], figure_spec=TRIANGLE, figure_svg="<svg/>", figure_facts=card.model_dump(),
        requires_drawing=True,
    )
    db = MagicMock()
    db.commit = AsyncMock()
    reply = {"reply": "Here it is.", "proposal": {"figure_spec": WITH_D}}
    read = AsyncMock(return_value=(None, ["no reading"]))
    with (
        patch.object(qbc, "call_claude_json", AsyncMock(return_value=reply)),
        patch.object(qbg, "read_figure_facts", read),
        patch.object(qbg, "redraw_figure", AsyncMock(return_value=WITH_D)),
    ):
        msg = await qbc.chat_with_bank_item(
            db, item, SimpleNamespace(subject="math", name="Geometry"),  # type: ignore[arg-type]
            teacher_message="redraw the figure", user_id=uuid.UUID(int=0),
        )
    read.assert_not_awaited()
    proposal = msg.get("proposal") or {}
    assert not proposal.get("figure_svg"), proposal


# ── Ben's rule: what the student must produce is never drawn ───────────
# (the constructed part, the graph of "graph y = …", the value asked for).
# Review round 2 found two ways around it; each is pinned here.


@pytest.mark.asyncio
async def test_a_refused_card_never_shows_its_figure() -> None:
    """Refused card + a shape-form figure: no figure (its words would be
    the AI's, unchecked), so the slot is replaced."""
    bad = dict(RIGHT, givens=[{"kind": "other", "items": ["AB"]}])
    for text in ("", "In triangle ABC, AB = 7 and angle C is right. Find BC."):
        out, _ = await _generate([[_written(bad, SHAPE, text=text), PLAIN], [dict(PLAIN, text="Solve 5x = 20.")]])
        assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]


@pytest.mark.asyncio
@pytest.mark.parametrize(("text", "flag"), [
    ("Construct triangle ABC with AB = 12, BC = 4, CA = 9 using a compass and straightedge.", None),
    ("Graph the line y = 2x + 1 and give its intercepts.", True),
])
async def test_without_a_card_the_students_own_drawing_is_never_drawn(text: str, flag: bool | None) -> None:
    out, _ = await _generate([[dict(PLAIN, text=text, figure_spec=SHAPE, **(
        {"requires_drawing": flag} if flag is not None else {})), PLAIN]])
    assert out[0]["text"] == text  # kept: the problem wants no figure
    assert not out[0].get("figure_svg") and not out[0].get("figure_spec")


def test_the_figure_never_shows_the_value_asked_for() -> None:
    """A right drawing (AB = 7, right angle at C) that prints BC's value:
    refused for giving the answer away, and only for that."""
    from api.core.geometry.fact_card import card_text, read_card

    card, why = read_card(RIGHT)
    assert card is not None, why
    spec = {"type": "geometry", "shape": "construction", "points": {"A": [0, 5.6], "B": [4.2, 0], "C": [0, 0]},
            "segments": ["AB", "BC", "CA"], "side_labels": {"AB": "7"}, "right_angles": ["ACB"]}
    assert qbg._check_figure(spec, card_text(card), final_answer="4.2", facts=card)[1]  # right: shown
    spec["side_labels"] = {"AB": "7", "BC": "4.2"}
    _, svg, issues = qbg._check_figure(spec, card_text(card), final_answer="4.2", facts=card)
    assert svg is None and any("gives away the answer" in i for i in issues), issues


def test_a_shape_form_figure_is_refused_for_an_author_card_by_the_check_itself() -> None:
    """The guard in _check_figure (the chat path's only one), not the
    fresh-drawing branch before it."""
    from api.core.geometry.fact_card import card_text, read_card

    card, why = read_card(RIGHT)
    assert card is not None, why
    assert qbg._check_figure(SHAPE, card_text(card), facts=card) == (None, None, [qbg._NOT_CONSTRUCTION])
    assert qbg._resolve_figure(SHAPE, card_text(card), facts=card) == (None, None)
    assert qbg._resolve_figure(SHAPE, card_text(card))[1]  # the shape form itself still renders


@pytest.mark.asyncio
async def test_a_chat_shape_form_figure_for_an_author_card_is_never_proposed() -> None:
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    import api.core.question_bank_chat as qbc
    from api.core.geometry.fact_card import card_text, read_card

    card, why = read_card(RIGHT)
    assert card is not None, why
    item = SimpleNamespace(
        id=uuid.uuid4(), course_id=uuid.uuid4(), unit_id=None, source_doc_ids=None,
        question=card_text(card), solution_steps=None, final_answer="", generation_prompt=None,
        chat_messages=[], figure_spec=None, figure_svg=None, figure_facts=card.model_dump(), requires_drawing=False,
    )
    db = MagicMock()
    db.commit = AsyncMock()
    with patch.object(qbc, "call_claude_json", AsyncMock(return_value={
            "reply": "Added.", "proposal": {"figure_spec": SHAPE}})):
        msg = await qbc.chat_with_bank_item(
            db, item, SimpleNamespace(subject="math", name="Geometry"),  # type: ignore[arg-type]
            teacher_message="add a figure", user_id=uuid.UUID(int=0),
        )
    assert not (msg.get("proposal") or {}).get("figure_svg")



@pytest.mark.asyncio
async def test_a_shape_form_figure_without_a_card_is_never_shown() -> None:
    """Review round 3: no card means nothing to hold the figure to (the
    AI's words are never read back): the slot is replaced."""
    text = "In triangle ABC, AB = 7 and BC = 5. Find AC."
    out, m = await _generate([[dict(PLAIN, text=text, figure_spec=SHAPE), PLAIN],
                              [dict(PLAIN, text="Solve 5x = 20.")]])
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]
    m["read"].assert_not_awaited()


@pytest.mark.asyncio
async def test_an_empty_card_is_no_card() -> None:
    """Review round 3: `figure_facts: {}` on a plain problem is not a card
    (it would be refused, and the good problem replaced)."""
    out, _ = await _generate([[dict(PLAIN, figure_facts={}), dict(PLAIN, text="Solve 5x = 20.")]])
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]


def test_the_prompt_says_a_construction_shows_only_its_givens() -> None:
    """Review round 3: the figure rules say "draw every point the problem
    names"; for what is under constructs the card's rule overrides them."""
    from api.core.assignment_generation import FACT_CARD_RULES

    assert "gets a figure of its givens only" in FACT_CARD_RULES
    assert 'overrides "draw every point and segment the problem names"' in FACT_CARD_RULES
    assert "point P (required: where they meet)" in FACT_CARD_RULES  # independent round 2
    # Independent round 3: no theorem names in hints; "work backward" only with a prove.
    assert "Never put a theorem\'s name in a fact, the context or the hint." in FACT_CARD_RULES
    assert "only when the card has something to prove" in FACT_CARD_RULES



# ── Review round 4 ─────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("card", [{}, None, {"points": [], "givens": []}])
async def test_a_problem_with_no_words_and_no_card_is_replaced(card: Any) -> None:
    """The prompt says leave the text empty for a card; with the card empty
    or missing there is nothing to show: replaced, never stored as ""."""
    blank = {"title": "t", "text": "", "difficulty": "easy", **({"figure_facts": card} if card is not None else {})}
    out, _ = await _generate([[blank, PLAIN], [dict(PLAIN, text="Solve 5x = 20.")]])
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]


@pytest.mark.asyncio
async def test_a_skeleton_card_on_a_plain_problem_is_no_card() -> None:
    out, _ = await _generate([[dict(PLAIN, figure_facts={"points": [], "givens": []}),
                               dict(PLAIN, text="Solve 5x = 20.")]])
    assert [q["text"] for q in out] == ["Solve 2x + 3 = 11.", "Solve 5x = 20."]


def test_the_construction_under_another_letter_is_never_shown() -> None:
    """E at the exact foot of the bisector, with BE and EC: the student's D
    renamed. The card lists every point the figure shows, so E is refused."""
    from api.core.geometry.fact_card import card_text, read_card

    card, why = read_card(BISECTOR)
    assert card is not None, why
    renamed = {**TRIANGLE, "points": {**TRIANGLE["points"], "E": [3, 0]},
               "segments": ["AB", "CA", "BE", "EC"]}
    _, svg, issues = qbg._check_figure(renamed, card_text(card), facts=card)
    assert svg is None and any("draws E" in i for i in issues), issues
    assert qbg._check_figure(TRIANGLE, card_text(card), facts=card)[1]  # the givens alone: shown


@pytest.mark.asyncio
@pytest.mark.parametrize(("question", "flag"), [
    ("Graph the line y = 2x + 1 and give its intercepts.", True),
    ("Construct triangle ABC with AB = 12, BC = 4, CA = 9 using a compass and straightedge.", None),
])
async def test_regenerate_without_a_card_keeps_the_students_own_drawing_undrawn(
        question: str, flag: bool | None) -> None:
    """As in generation: the figure is dropped, the new version kept."""
    reply: dict[str, Any] = {"question": question, "figure_spec": SHAPE}
    if flag is not None:
        reply["requires_drawing"] = flag
    item, _ = await _regenerate(reply)
    assert item.question == question and item.figure_svg is None and item.requires_drawing is True


@pytest.mark.asyncio
async def test_regenerate_reads_a_blank_card_as_no_card() -> None:
    item, _ = await _regenerate({"question": "Solve 2x + 3 = 11.", "figure_facts": {"points": [], "givens": []}})
    assert item.question == "Solve 2x + 3 = 11." and item.figure_svg is None
