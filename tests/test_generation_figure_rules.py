"""Generated problems and their steps decide their own figures, and code
enforces one rule.

- The prompts carry Ben's wording (2026-11-13) word for word: when a problem
  gets a figure, and when a step does.
- The rule (`_needs_figure`): a math problem that names points, or any
  problem that refers to a figure, ends with a checked figure, or is replaced
  once, then left out.
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

WHEN_TO_DRAW = (
    "When to draw. Add a figure when seeing it helps a student understand or solve the problem: the "
    "problem names points, lines or shapes; it refers to a figure; or it describes a layout a teacher "
    "would sketch on the board (a ladder against a wall, a composite floor plan). Leave it out when "
    "there's no shape to show, or when the picture would reveal what the student is asked to find or decide."
)
NAME_THE_POINTS = (
    "When a problem gets a figure, its text names every point the figure shows, so the figure can be "
    "checked; a figure whose points the problem doesn't name is not shown."
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


def test_the_question_prompt_has_bens_paragraph_and_the_naming_sentence() -> None:
    prompt = assignment_generation._build_question_generation_prompt("math")
    assert WHEN_TO_DRAW in prompt
    assert NAME_THE_POINTS in prompt
    assert '"shape": "construction"' in prompt


def test_both_generation_prompts_say_how_to_word_a_figure_problem() -> None:
    """Plain math givens with point names, no story, no theorem names (the
    coordinator's decision 2026-11-14: fix the wording at the source, not the
    coverage check). The worked example in the wording covers, and a story
    sentence with no point names is still a gap, so story goes entirely."""
    w = assignment_generation.FIGURE_PROBLEM_WORDING
    assert w in assignment_generation._build_question_generation_prompt("math")
    import inspect

    assert "FIGURE_PROBLEM_WORDING" in inspect.getsource(qbg)  # the regenerate prompt
    for phrase in ("plain math form", "No story in a problem with a figure", "Never put a theorem's"):
        assert phrase in w

    from api.core.geometry import coverage as cv
    from api.core.geometry.facts import Target, standard_reading

    example = r"$\triangle ABC$ has a right angle at $C$, $AB = 13$ and $BC = 5$. Find $AC$."
    assert example in w  # the worked example the prompt gives
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="segment", item="AC")], givens=[
        Fact(kind="right_angle", items=["C"], quote="right angle at C"),
        Fact(kind="equal_length", items=["AB"], value=13, quote="AB = 13"),
        Fact(kind="equal_length", items=["BC"], value=5, quote="BC = 5")])
    assert cv.coverage(example, standard_reading(facts))[0] == []
    assert cv.coverage("A ladder rests against a wall. " + example, standard_reading(facts))[0] != []


def test_the_wording_covers_the_remaining_drops() -> None:
    """Review round 1 of #998: the drops left after the first wording
    change ("line q", "point O is the center of the circle", "arc AB",
    "Additionally", "labeled as", "A composite figure made up of") are
    fixed at the source. The one-statement example passes coverage."""
    w = assignment_generation.FIGURE_PROBLEM_WORDING
    for phrase in ('never "line $p$"', "Name a circle by its center point", 'not "arc $AB$"',
                   '"Additionally"', '"labeled as"', '"A composite figure made up of"', "One plain statement"):
        assert phrase in w, phrase

    from api.core.geometry import coverage as cv
    from api.core.geometry.facts import Target, standard_reading

    composite = (r"$ABCD$ is a rectangle. $\triangle CDE$ has a right angle at $D$. $AB = 14$, $BC = 9$ and "
                 r"$DE = 6$. Find the area of polygon $ABCED$.")
    assert r"$\triangle CDE$ has a right angle at $D$." in w
    facts = FigureFacts(points=list("ABCDE"), polygons=["ABCD", "ABCED"], triangles=["CDE"],
                        find=[Target(kind="other", item="area of ABCED")], givens=[
        Fact(kind="rectangle", items=["ABCD"], quote="ABCD is a rectangle"),
        Fact(kind="right_angle", items=["CDE"], quote="right angle at D"),
        Fact(kind="equal_length", items=["AB"], value=14, quote="AB = 14"),
        Fact(kind="equal_length", items=["BC"], value=9, quote="BC = 9"),
        Fact(kind="equal_length", items=["DE"], value=6, quote="DE = 6")])
    assert cv.coverage(composite, standard_reading(facts))[0] == []
    assert cv.coverage("A composite figure made up of " + composite, standard_reading(facts))[0] != []


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
    assert "names points or refers to a figure must include a figure_spec" in qbg._REPLACEMENT_RULE
    import inspect

    src = inspect.getsource(qbg._run_generation)
    assert "same layout and point names" in src and "SAME shape family" not in src


# ── The rule code enforces ─────────────────────────────────────────────


@pytest.mark.parametrize(("text", "needs"), [
    (r"In $\triangle ABC$, $m\angle A = 40°$. Find $m\angle C$.", True),
    ("In the figure below, find x.", True),
    ("A ladder AB leans against wall BC, with its foot 5 ft from the wall.", True),
    ("The floor plan ABCDEF is L-shaped; find its area.", True),
    ("Let ABCD be a rectangle with AB = 3. Find AC.", True),
    ("Chord AB of circle O has length 8.", True),
    ("Points A and B lie on circle O.", True),
    ("A(2, 3) and B(5, 7) are points. Find the distance AB.", False),  # coordinates
    ("Point P is on the parabola y = x^2. Find P.", False),  # a curve
    ("A rectangle has width 7 and length 9. Find its area.", False),  # shapes only
    ("A 12 ft ladder leans against a wall, reaching 10 ft up.", False),  # no points named
    ("Solve 2x + 3 = 11.", False),
    ("Use SAS to prove the triangles congruent.", False),  # a postulate, not points
    (r"Let $A = \begin{pmatrix}1&2\\3&4\end{pmatrix}$. Find $AB$.", False),
    ("Events A and B are independent with P(A) = 0.3.", False),
    ("In the USA, 40% of people use GPS.", False),
    # Review round 1 (#998): after "in" / "let" an acronym is not a figure's
    # name; there a run of capitals names points only in math markup or in a
    # sentence with a figure noun.
    ("A taxi ride in DC costs $3 plus $2 per mile. How far can you go for $15?", False),
    ("In PEMDAS, which operation comes first?", False),
    ("In NYC, a slice of pizza costs $3.50. How many slices can you buy for $21?", False),
    ("Let NY be the number of tickets sold in New York.", False),
    ("In HL, which parts must be congruent?", False),
    ("Write the line through the points in EF form.", False),
    (r"In $\triangle ABC$, $AB = AC$.", True),
    ("Let ABCD be a square with side 4. Find AC.", True),
    (r"In $ABCD$, $AB = 5$. Find $CD$.", True),
    ("In PQRS, the diagonals bisect each other. Find PR if PT = 4.", True),
])
def test_what_needs_a_figure(text: str, needs: bool) -> None:
    assert qbg._needs_figure({"text": text}) is needs


def test_other_subjects_need_one_only_when_they_refer_to_it() -> None:
    assert not qbg._needs_figure({"text": "A block slides from point A to point B."}, "physics")
    assert qbg._needs_figure({"text": "In the diagram below, find the tension."}, "physics")


def test_a_checked_figure_satisfies_the_rule() -> None:
    assert qbg._lacks_figure({"text": PROBLEM})
    assert not qbg._lacks_figure({"text": PROBLEM, "figure_svg": "<svg/>"})


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
        out = await qbg.generate_checked_problems(
            unit_name="Unit 4", count=2, course_name="Geometry", subject="math", user_id="u", images=None,
            constraint_text=None, assignment_title=None, params=None, call_metadata=None, job_id="j",
        )
    return out, gen


async def _untrusted(*_a: Any, **_k: Any) -> tuple[None, list[str]]:
    return None, ["two readings of the problem disagree, so the figure can't be checked"]


@pytest.mark.asyncio
async def test_a_named_point_problem_whose_figure_cant_be_checked_is_replaced_then_a_plain_one_takes_its_slot(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No "figure below" in it: before, only that phrase was enforced, so
    "In △ABC …" shipped with no figure when its reading failed. Its
    replacement fails the same way, so the slot gets a problem on the same
    topic that needs no figure: the teacher gets the count asked for
    (coordinator, after review round 1 of #998)."""
    plain = _q("Solve 2x + 3 = 11.")
    no_figure = {**_q("Two angles are supplementary; one measures 70°. Find the other."), "figure_spec": TRIANGLE}
    with caplog.at_level("WARNING"):
        out, gen = await _generate([[plain, _q(PROBLEM, TRIANGLE)], [_q(PROBLEM, TRIANGLE)], [no_figure]], _untrusted)
    assert gen.await_count == 3 and gen.await_args_list[1].kwargs["count"] == 1
    assert "names points or refers to a figure" in gen.await_args_list[1].kwargs["extra_instructions"]
    assert gen.await_args_list[2].kwargs["count"] == 1
    assert "need no figure" in gen.await_args_list[2].kwargs["extra_instructions"]
    assert [q["text"] for q in out] == [plain["text"], no_figure["text"]]
    assert out[1]["figure_spec"] is None and out[1]["figure_svg"] is None  # never shown unchecked
    assert "asking for problems on the same topic that need no figure" in caplog.text


@pytest.mark.asyncio
async def test_a_plain_replacement_that_still_needs_a_figure_is_left_out(caplog: pytest.LogCaptureFixture) -> None:
    plain = _q("Solve 2x + 3 = 11.")
    with caplog.at_level("WARNING"):
        out, gen = await _generate(
            [[plain, _q(PROBLEM, TRIANGLE)], [_q(PROBLEM, TRIANGLE)], [_q(PROBLEM)]], _untrusted)
    assert gen.await_count == 3
    assert [q["text"] for q in out] == [plain["text"]]
    assert "left out 1 problem(s): no figure could be checked" in caplog.text


@pytest.mark.asyncio
async def test_a_named_point_problem_with_no_figure_is_replaced() -> None:
    async def trusted(*_a: Any, **_k: Any) -> tuple[FigureFacts, list[str]]:
        return READING, []

    out, gen = await _generate([[_q(PROBLEM), _q("Solve x + 1 = 2.")], [_q(PROBLEM, TRIANGLE)]], trusted)
    assert gen.await_count == 2
    assert [bool(q.get("figure_svg")) for q in out] == [False, True]
    assert out[0]["text"] == "Solve x + 1 = 2."


@pytest.mark.asyncio
async def test_a_named_point_problem_whose_figure_gives_away_the_answer_is_left_out() -> None:
    def check(_fig: Any, _text: str, *, final_answer: str = "", **_kw: Any) -> list[FigureIssue]:
        return [FigureIssue("label", "the label '70°' gives away the answer")] if final_answer else []

    q = {**_q(PROBLEM, TRIANGLE), "figure_svg": "<svg/>", "figure_facts": READING.model_dump()}
    plain = _q("Solve x + 1 = 2.")
    solved = [{"question_text": "a", "steps": [], "final_answer": "70°"},
              {"question_text": "b", "steps": [], "final_answer": "1"}]
    with (
        patch.object(qbg, "generate_solutions", AsyncMock(return_value=solved)),
        patch.object(qbg, "check_construction", check),
    ):
        kept, sols = await qbg.solve_checked_problems([q, plain], subject="math", user_id="u", job_id="j")
    assert [k["text"] for k in kept] == [plain["text"]] and [s["final_answer"] for s in sols] == ["1"]


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
async def test_regenerate_refuses_a_named_point_problem_without_a_figure() -> None:
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
    call = AsyncMock(return_value={"title": "t", "question": PROBLEM, "solution_steps": [], "final_answer": "70°"})
    with patch("api.core.question_bank_generation.call_claude_json", call):
        async with get_session_factory()() as s:
            item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
            course = (await s.execute(select(Course).where(Course.id == w["course"]))).scalar_one()
            with pytest.raises(RuntimeError, match="names points for a figure that couldn't be drawn"):
                await qbg.regenerate_one(s, item, course, instructions=None, user_id=w["teacher"])
    async with get_session_factory()() as s:
        item = (await s.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one()
        assert item.question == "old"
