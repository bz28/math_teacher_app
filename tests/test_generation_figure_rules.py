"""Generated problems and their steps decide their own figures, and code
enforces one rule.

- The prompts carry Ben's wording (2026-11-13) word for word: when a problem
  gets a figure, and when a step does.
- The rule (`_needs_figure`): the AI decides. A problem it drafted a figure
  or fact card for, or whose text refers to a figure, ends with a checked
  figure, or is replaced once, then left out (the set comes back short).
  Who draws what is on the fact card (tests/test_fact_card_generation.py).
- Step figures are constructions built on the problem's checked figure,
  read and checked like it (one redraw), and their facts build up step by
  step. The shape-form step figure path is gone (prod 77195d48).
"""
from __future__ import annotations

import hashlib
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

import api.core.question_bank_generation as qbg
from api.core import assignment_generation, step_decomposition
from api.core.geometry.facts import Fact, FigureFacts
from api.core.geometry.figure_check import FigureIssue
from api.core.llm_schemas import (
    DECOMPOSITION_CONSTRUCTION_SCHEMA,
    DECOMPOSITION_NO_FIGURES_SCHEMA,
    DECOMPOSITION_SCHEMA,
)

# Ben's when-to-draw rule (2026-11-14), its five cases word for word.
WHEN_TO_DRAW = (
    "- MUST have a figure: the problem refers to a figure, or its answer depends on how named parts are "
    "arranged (proofs, angle pairs, transversals, circle chords and tangents, composite shapes).",
    "- SHOULD have a figure: a real-world layout a textbook would picture (a ladder against a wall, a ramp, "
    "a floor plan). Write it as plain geometry with named points (see below), not as a story.",
    "- OPTIONAL: a shape problem answered by a formula alone (a polygon's angle sum).",
    "- NO figure: when the task is for the student to draw, construct or sketch it; when there is no shape; "
    "when an exact drawing would reveal what is asked (acute or obtuse, \"are the lines parallel?\"); graphs "
    "and 3D solids (the tool can't draw them).",
    "- Every problem with a figure names its points, and names each line by two of its points.",
)
STEPS = (
    "Steps. Give a step its own figure only when that step changes the picture: it draws a new line or "
    "point, or proves something worth marking. Keep the problem's points exactly where they are and only add."
)

PROBLEM = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$. Find $m\angle B$ if $m\angle A = 40°$."
TRIANGLE = {
    "type": "geometry", "shape": "construction",
    "points": {"A": [3, 5], "B": [0, 0], "C": [6, 0]},
    "segments": ["AB", "BC", "CA"], "tick_groups": [["AB", "AC"]],
}
READING = FigureFacts(
    points=["A", "B", "C"], triangles=["ABC"],
    givens=[Fact(kind="congruent_segments", items=["AB", "AC"], quote=r"\overline{AB} \cong \overline{AC}")],
)


# ── The prompts ────────────────────────────────────────────────────────


def test_the_question_prompt_has_bens_rule_and_the_naming_sentence() -> None:
    prompt = assignment_generation._build_question_generation_prompt("math")
    for case in WHEN_TO_DRAW:
        assert case in prompt, case
    assert "When to draw. Add a figure when" not in prompt  # the first paragraph, replaced
    assert assignment_generation.FACT_CARD_RULES in prompt
    assert '"shape": "construction"' in prompt


def test_both_generation_prompts_ask_for_a_fact_card() -> None:
    """The problem with a figure is written as a fact card; code writes its
    words (the wording rules for a problem that is read back are gone)."""
    import inspect

    w = assignment_generation.FACT_CARD_RULES
    assert w in assignment_generation._build_question_generation_prompt("math")
    assert "FACT_CARD_RULES" in inspect.getsource(qbg.regenerate_one)  # the regenerate prompt
    assert "FIGURE_PROBLEM_WORDING" not in inspect.getsource(qbg)
    for phrase in ("fill in its fact card", "text (`text`, or `question` when revising) empty",
                   "constructs: what the STUDENT constructs", "context: optional", "hint: optional"):
        assert phrase in w, phrase


def test_the_construction_step_prompt_has_bens_paragraph_and_the_rules() -> None:
    prompt = step_decomposition._build_system_prompt("math", "construction")
    assert STEPS in prompt
    assert '"shape": "construction"' in prompt  # CONSTRUCTION_FIGURE_RULES
    assert "Two supported shapes" not in prompt  # not the shape-form block


def test_the_shapes_prompt_is_unchanged() -> None:
    """Learn mode's prompt is byte-identical to before (its recordings hold)."""
    want = {
        "math": "94933a8979f391db15e4040e5719ca37993b9411250811587bc930f5533a5643",
        "physics": "7edac038858b29c1ef22dc6761b3dba7cb78f9a2dace81aba7c39de05c0adbc7",
        "chemistry": "2d010be853c231bfc168ea20788d15d74f1b64e6d81fae2e6167d47e9f501a27",
    }
    for subject, sha in want.items():
        got = hashlib.sha256(step_decomposition._build_system_prompt(subject).encode()).hexdigest()
        assert got == sha, subject


def test_no_figures_mode_has_no_figure_block_or_slot() -> None:
    prompt = step_decomposition._build_system_prompt("math", "none")
    assert "Per-step geometry figures" not in prompt
    items = DECOMPOSITION_NO_FIGURES_SCHEMA["input_schema"]["properties"]["steps"]["items"]
    assert "figure_spec" not in items["properties"]
    # The shape-form schema itself is untouched.
    assert "figure_spec" in DECOMPOSITION_SCHEMA["input_schema"]["properties"]["steps"]["items"]["properties"]


def test_generation_has_room_for_a_set_of_figures() -> None:
    assert assignment_generation._GENERATE_MAX_TOKENS >= 12000
    # and the time to write them, at about 70 tokens/s (review round 1, #998)
    assert assignment_generation._GENERATE_TIMEOUT_S >= assignment_generation._GENERATE_MAX_TOKENS / 70


@pytest.mark.asyncio
async def test_the_generate_call_gets_the_long_timeout() -> None:
    with patch.object(assignment_generation, "call_claude_json",
                      AsyncMock(return_value={"questions": [{"text": "Solve 2x = 4."}]})) as call:
        await assignment_generation.generate_questions(
            unit_name="U", count=1, course_name="Algebra", subject="math", user_id="u")
    assert call.call_args.kwargs["timeout"] == assignment_generation._GENERATE_TIMEOUT_S


def test_the_replacement_and_variation_wording() -> None:
    """Review round 5 (#998): the replacement asks for a figure by the
    when-to-draw rule (in its system prompt), not for every problem that
    names points."""
    assert "Follow the when-to-draw rule" in qbg._REPLACEMENT_RULE
    assert "names points" not in qbg._REPLACEMENT_RULE
    assert assignment_generation.WHEN_TO_DRAW in assignment_generation._build_question_generation_prompt("math")
    import inspect

    src = inspect.getsource(qbg._run_generation)
    assert "same layout and point names" in src and "SAME shape family" not in src


# ── The rule code enforces ─────────────────────────────────────────────


# Texts that name no figure by themselves: whether they get one is the
# AI's choice (it drafts a figure_spec or not), never guessed from words.
# Rounds 1 to 4 of #998 found acronyms, statistics and probability read as
# point names; with no figure_spec none of these wants a figure.
NO_GUESSING = [
    r"Let $ABCD$ be a square with side 4. Find $AC$.",
    "A ladder AB leans against wall BC, with its foot 5 ft from the wall.",
    r"The data set has $IQR = 12$ and median 40. Find $Q_3$ if $Q_1 = 34$.",
    r"Find the $GCF$ of 36 and 48.",
    r"If $\det(A) = 3$ and $\det(B) = 4$, find $\det(AB)$.",
    r"Events $A$ and $B$ are independent; $P(A) = 0.3$, $P(B) = 0.5$. Find $P(AB)$.",
    r"The sample mean is $\overline{X} = 52$. Find the margin of error.",
    "The distance NYC to LA is 2800 miles. A plane flies at 560 mph. Which answer is NOT possible?",
    "In DC, a square plot of land costs $40 per square foot. How much is a plot with side 20 ft?",
    "Let NY be the number of tickets sold in New York and NJ the number in New Jersey. NY + NJ = 500.",
]


@pytest.mark.parametrize("text", NO_GUESSING)
def test_the_ai_decides_whether_a_problem_wants_a_figure(text: str) -> None:
    assert not qbg._needs_figure({"text": text})
    assert qbg._needs_figure({"text": text, "figure_spec": TRIANGLE})
    assert qbg._needs_figure({"text": text, "figure_spec": None, "figure_wanted": True})  # after a failed check


def test_a_problem_that_points_at_a_figure_wants_one() -> None:
    assert qbg._needs_figure({"text": "In the figure below, find x."})
    assert qbg._needs_figure({"text": "In the diagram below, find the tension."})


def test_a_checked_figure_satisfies_the_rule() -> None:
    assert qbg._lacks_figure({"text": PROBLEM, "figure_spec": TRIANGLE})
    assert not qbg._lacks_figure({"text": PROBLEM, "figure_spec": TRIANGLE, "figure_svg": "<svg/>"})


def _q(text: str, spec: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"title": "t", "text": text, "difficulty": "easy"}
    if spec is not None:
        out["figure_spec"] = spec
    return out


async def _generate(batches: list[Any], read: Any) -> tuple[list[dict[str, Any]], AsyncMock]:
    gen = AsyncMock(side_effect=batches)
    with (
        patch.object(qbg, "generate_questions", gen),
        patch.object(qbg, "read_figure_facts", AsyncMock(side_effect=read)),
        patch.object(qbg, "redraw_figure", AsyncMock(return_value=None)),
    ):
        out = await qbg.generate_checked_problems(REQUEST, count=2)
    return out, gen


REQUEST = qbg.ProblemRequest(unit_name="Unit 4", course_name="Geometry", subject="math", user_id="u", job_id="j")


async def _untrusted(*_a: Any, **_k: Any) -> tuple[None, list[str]]:
    return None, ["two readings of the problem disagree, so the figure can't be checked"]


@pytest.mark.asyncio
async def test_a_figure_problem_without_a_card_is_replaced_then_left_out(caplog: pytest.LogCaptureFixture) -> None:
    """No "figure below" in it: the AI drafted a figure, but wrote no fact
    card, so nothing can check it (an AI-written problem is never read back
    from its words). It is replaced once; the replacement has the same
    flaw, so the slot is left out: no third call for a problem that tells
    its geometry as a story (#998's eval: 4 of 10 such problems)."""
    plain = _q("Solve 2x + 3 = 11.")
    read = AsyncMock(side_effect=_untrusted)
    gen = AsyncMock(side_effect=[[plain, _q(PROBLEM, TRIANGLE)], [_q(PROBLEM, TRIANGLE)]])
    with (
        caplog.at_level("WARNING"),
        patch.object(qbg, "generate_questions", gen),
        patch.object(qbg, "read_figure_facts", read),
        patch.object(qbg, "redraw_figure", AsyncMock(return_value=None)),
    ):
        out = await qbg.generate_checked_problems(REQUEST, count=2)
    assert gen.await_count == 2 and gen.await_args_list[1].kwargs["count"] == 1
    assert "Follow the when-to-draw rule" in gen.await_args_list[1].kwargs["extra_instructions"]
    assert [q["text"] for q in out] == [plain["text"]]
    read.assert_not_awaited()  # no readings for a problem the AI wrote
    assert "a figure came without a fact card" in caplog.text
    assert "left out 1 problem(s) with no figure that could be checked" in caplog.text


SQUARE = r"Let $ABCD$ be a square with side 4. Find $AC$."


@pytest.mark.asyncio
async def test_a_problem_whose_drafted_figure_fails_is_replaced() -> None:
    """Review round 4 (#998): the AI decides. It drafted a figure for this
    one, the figure failed its check, so the problem is replaced."""
    out, gen = await _generate([[_q(SQUARE, TRIANGLE), _q("Solve x + 1 = 2.")], [_q("Solve 3x = 9.")]], _untrusted)
    assert gen.await_count == 2 and gen.await_args_list[1].kwargs["count"] == 1
    assert [q["text"] for q in out] == ["Solve x + 1 = 2.", "Solve 3x = 9."]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", [SQUARE, *NO_GUESSING])
async def test_a_problem_the_ai_drafted_no_figure_for_is_kept_without_one(text: str) -> None:
    """No figure drafted and no figure referred to: kept as it is. For
    "Let $ABCD$ be a square" that is a missing figure, which the eval
    counts; it is never a wrong one."""
    out, gen = await _generate([[_q(text), _q("Solve x + 1 = 2.")]], _untrusted)
    assert gen.await_count == 1
    assert [q["text"] for q in out] == [text, "Solve x + 1 = 2."] and not out[0].get("figure_svg")


@pytest.mark.asyncio
async def test_each_call_for_more_problems_is_told_the_kept_ones_and_repeats_are_dropped() -> None:
    """Review round 2 (#998): the replacement and no-figure calls weren't
    told which problems the set has, so a replacement repeated a kept
    problem (v4 set1-p4 = set1-p1)."""
    plain = _q("Solve 2x + 3 = 11.")
    again = _q("  solve 2x + 3 =   11. ")  # the same problem, spacing and case aside
    other = _q("Solve 5x = 20.")
    out, gen = await _generate([[plain, again], [_q("Solve 2x + 3 = 11."), other]], _untrusted)
    assert [q["text"] for q in out] == [plain["text"], other["text"]]
    assert gen.await_count == 2 and gen.await_args_list[1].kwargs["count"] == 1
    told = gen.await_args_list[1].kwargs["extra_instructions"]
    assert "do not repeat any of them" in told and "- Solve 2x + 3 = 11." in told


@pytest.mark.asyncio
async def test_a_named_point_problem_whose_figure_gives_away_the_answer_is_left_out() -> None:
    """Nothing is asked for in its place (no problem that tells its geometry
    as a story): the set comes back short (review round 2 of #998 asked for a
    filler; the fact-card design replaces it with the teacher's note)."""
    def check(_fig: Any, _text: str, *, final_answer: str = "", **_kw: Any) -> list[FigureIssue]:
        return [FigureIssue("label", "the label '70°' gives away the answer")] if final_answer else []

    q = {**_q(PROBLEM, TRIANGLE), "figure_svg": "<svg/>", "figure_facts": READING.model_dump()}
    plain = _q("Solve x + 1 = 2.")
    solved = [{"question_text": "a", "steps": [], "final_answer": "70°"},
              {"question_text": "b", "steps": [], "final_answer": "1"}]
    gen = AsyncMock()
    with (
        patch.object(qbg, "generate_solutions", AsyncMock(return_value=solved)),
        patch.object(qbg, "generate_questions", gen),
        patch.object(qbg, "check_construction", check),
    ):
        kept, sols = await qbg.solve_checked_problems([q, plain], subject="math", user_id="u", job_id="j")
    assert [k["text"] for k in kept] == [plain["text"]] and [s["final_answer"] for s in sols] == ["1"]
    gen.assert_not_awaited()


# ── Step figures ───────────────────────────────────────────────────────


def _clear_cache() -> None:
    step_decomposition._cache.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize(("spec", "schema"), [
    (TRIANGLE, DECOMPOSITION_CONSTRUCTION_SCHEMA),
    ({"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"]}, DECOMPOSITION_NO_FIGURES_SCHEMA),
    (None, DECOMPOSITION_NO_FIGURES_SCHEMA),
])
async def test_the_solver_may_draw_step_figures_only_on_a_checked_construction(spec: Any, schema: Any) -> None:
    _clear_cache()
    call = AsyncMock(return_value={"steps": [{"title": "a", "description": "b"}], "final_answer": "1",
                                   "answer_type": "text"})
    with patch.object(step_decomposition, "call_claude_json", call):
        await assignment_generation.generate_solutions([_q(PROBLEM, spec)])
    assert call.await_args.kwargs["tool_schema"] is schema
    has_rules = '"shape": "construction"' in call.await_args.args[0]
    assert has_rules is (schema is DECOMPOSITION_CONSTRUCTION_SCHEMA)
    _clear_cache()


def test_a_construction_step_figure_comes_back_undrawn() -> None:
    """Only the step check draws a construction step figure."""
    steps, _, _ = step_decomposition._parse_decomposition({
        "steps": [{"title": "Draw AD", "description": "d", "figure_spec": TRIANGLE}],
        "final_answer": "1", "answer_type": "text",
    })
    assert steps[0]["figure_spec"] == TRIANGLE and "figure_svg" not in steps[0]
    decomp = step_decomposition.Decomposition(problem="p", steps=steps, final_answer="1", problem_type="math")
    step_decomposition._cache_set("k", decomp)
    cached = step_decomposition._cache_get("k")
    assert cached is not None and "figure_svg" not in cached.steps[0]
    _clear_cache()


def test_the_cache_keeps_the_modes_apart() -> None:
    _clear_cache()
    decomp = step_decomposition.Decomposition(problem="p", steps=[{"title": "a", "description": "b"}],
                                              final_answer="1", problem_type="math")
    step_decomposition._cache_set("math:construction:p", decomp)
    assert step_decomposition._cache_get("math:p") is None
    _clear_cache()


ALTITUDE = {**TRIANGLE, "points": {**TRIANGLE["points"], "D": [3, 0]}, "segments": [*TRIANGLE["segments"], "AD"],
            "right_angles": ["ADB"]}
STEP_READINGS = {
    "Draw the altitude AD from A to BC, so AD ⊥ BC.": FigureFacts(
        points=["A", "D", "B", "C"], segments=["AD", "BC"],
        givens=[Fact(kind="perpendicular", items=["AD", "BC"], quote="AD ⊥ BC")],
    ),
    "Triangles ABD and ACD share AD.": FigureFacts(
        points=["A", "B", "C", "D"], triangles=["ABD", "ACD"], segments=["AD"],
    ),
}


def _steps(spec2: Any) -> list[dict[str, Any]]:
    return [
        {"title": "Setup", "description": "The triangle is isosceles."},
        {"title": "Altitude", "description": "Draw the altitude AD from A to BC, so AD ⊥ BC.", "figure_spec": ALTITUDE},
        {"title": "Two triangles", "description": "Triangles ABD and ACD share AD.", "figure_spec": spec2},
    ]


async def _read_step(text: str, **_kw: Any) -> tuple[FigureFacts | None, list[str]]:
    return STEP_READINGS.get(text), ([] if text in STEP_READINGS else ["the problem wasn't read"])


@pytest.mark.asyncio
async def test_step_facts_build_up_across_steps() -> None:
    """Step 3's figure is checked against the question's facts, plus step
    2's altitude and right angle, plus its own."""
    steps = _steps(ALTITUDE)
    read = AsyncMock(side_effect=_read_step)
    with patch.object(qbg, "read_figure_facts", read):
        drops = await qbg.read_step_facts(steps, question_text=PROBLEM, facts=READING, mode="m", user_id=None)
    assert drops == {}
    assert all(c.kwargs["step_of"] == PROBLEM for c in read.await_args_list)
    third = FigureFacts.model_validate(steps[2]["figure_facts"])
    assert any(f.kind == "perpendicular" for f in third.givens)  # step 2's
    assert {"ABD", "ACD", "ABC"} <= set(third.triangles)  # its own and the question's


@pytest.mark.asyncio
async def test_a_later_step_that_drops_an_earlier_steps_line_is_redrawn_then_dropped() -> None:
    """Step 3 keeps step 2's altitude: a figure leaving it out fails, the
    redraw is shown why, and a second failure keeps the step without one."""
    steps = _steps(TRIANGLE)  # step 3's figure leaves out D and AD
    redraw = AsyncMock(return_value=TRIANGLE)
    with (
        patch.object(qbg, "read_figure_facts", AsyncMock(side_effect=_read_step)),
        patch.object(qbg, "redraw_figure", redraw),
    ):
        out, drops, _ = await qbg._render_step_figures_with_retry(
            steps, question_text=PROBLEM, question_spec=TRIANGLE, mode="m", user_id=None, facts=READING,
            generation_job_id="job-1",
        )
    assert out[1]["figure_svg"] and out[1]["figure_facts"]  # step 2 passes, stored with its facts
    assert "figure_svg" not in out[2] and 3 in drops
    assert any("missing point: D" in m for m in redraw.await_args.args[2])
    assert redraw.await_args.kwargs["generation_job_id"] == "job-1"


@pytest.mark.asyncio
async def test_generation_checks_step_figures_with_their_one_redraw() -> None:
    """The generation path checks each step's figure (read with the step's
    own words, one redraw) instead of rendering it unchecked."""
    moved = {**ALTITUDE, "points": {**ALTITUDE["points"], "B": [0.5, 0]}}
    q = {**_q(PROBLEM, TRIANGLE), "figure_svg": "<svg/>", "figure_facts": READING.model_dump()}
    solved = [{"question_text": PROBLEM, "steps": _steps(None)[:2], "final_answer": "70°"}]
    solved[0]["steps"][1]["figure_spec"] = moved
    redraw = AsyncMock(return_value=ALTITUDE)
    with (
        patch.object(qbg, "generate_solutions", AsyncMock(return_value=solved)),
        patch.object(qbg, "read_figure_facts", AsyncMock(side_effect=_read_step)),
        patch.object(qbg, "redraw_figure", redraw),
    ):
        _kept, sols = await qbg.solve_checked_problems([q], subject="math", user_id="u", job_id="j")
    redraw.assert_awaited_once()
    assert any("point B is not where the question's figure puts it" in m for m in redraw.await_args.args[2])
    step = sols[0]["steps"][1]
    assert step["figure_spec"] == ALTITUDE and step["figure_svg"] and step["figure_facts"]


@pytest.mark.asyncio
async def test_the_per_problem_checks_run_at_once() -> None:
    """Each problem's step checks run in parallel, not one after another."""
    import asyncio

    running, peak = 0, 0

    async def slow(steps: list[Any], **_kw: Any) -> tuple[list[Any], dict[int, list[str]], None]:
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return steps, {}, None

    qs = [_q(f"Solve x + {i} = 0.") for i in range(4)]
    solved = [{"question_text": q["text"], "steps": [{"title": "a", "description": "b"}], "final_answer": "1"}
              for q in qs]
    with (
        patch.object(qbg, "generate_solutions", AsyncMock(return_value=solved)),
        patch.object(qbg, "_render_step_figures_with_retry", slow),
    ):
        await qbg.solve_checked_problems(qs, subject="math", user_id="u", job_id="j")
    assert peak == 4


@pytest.mark.asyncio
@pytest.mark.parametrize(("question", "spec", "refused"), [
    (PROBLEM, TRIANGLE, "has a figure that couldn't be drawn"),  # the AI drafted one; it failed
    ("In the figure below, find x.", None, "refers to a figure that couldn't be drawn"),
])
async def test_regenerate_refuses_a_new_version_whose_figure_fails(question: str, spec: Any, refused: str) -> None:
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
        )
        s.add(item)
        await s.commit()
        item_id = item.id
    call = AsyncMock(return_value={"title": "t", "question": question, "solution_steps": [], "final_answer": "70°",
                                   "figure_spec": spec})
    failed = AsyncMock(return_value=(None, None, ["two readings of the problem disagree"], None))
    with (
        patch("api.core.question_bank_generation.call_claude_json", call),
        patch.object(qbg, "_resolve_figure_with_retry", failed),
    ):
        async with get_session_factory()() as s:
            item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
            course = (await s.execute(select(Course).where(Course.id == w["course"]))).scalar_one()
            with pytest.raises(RuntimeError, match=refused):
                await qbg.regenerate_one(s, item, course, instructions=None, user_id=w["teacher"])
    # Review round 5 (#998): the regenerate prompt carries the when-to-draw
    # rule, not "a problem that names points needs a figure".
    system = call.call_args.args[0]
    assert assignment_generation.WHEN_TO_DRAW in system and "names points" not in system
    async with get_session_factory()() as s:
        item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
        assert item.question == "old"
