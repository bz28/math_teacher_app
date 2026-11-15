"""Review round 3 of PR #989, and the breadth batch beside it: each
reviewer reproduction and each new rule, as a test that fails if its fix
is reverted.

Review round 3:
A. The reply is written by code when a proposal touches the figure (tests
   in tests/test_figure_review_round2.py, next to round 2's).
B. Coverage is structural: every clause that names a part or holds a
   number is accounted for by a fact quoting it, and every number is some
   fact's.
1. Algebra is read by a real parser ("2(x + 5)" is 2x + 10).
2. A polygon must be simple: its sides don't cross.
3. Collapse and crossing are checked for any shape the checker matches,
   lettered or not.
4. Scale and extent come from the points the figure uses; an unused
   helper point is refused.
5. Circles, arcs, sectors and shading are each backed by the problem.
6. A step figure is checked against what the step states, too.

Breadth batch: an "other" fact checked in full by others is set aside and
"draw XY" is a part; "meet" needs a fact; a triangle's angle sum states
nothing; "DA = DC"; coordinates; the alternate-interior parenthetical; an
interior ray; an extension.
"""

from __future__ import annotations

import math
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

import api.core.question_bank_generation as qbg
from api.core.construction_figures import _IN_WORDS
from api.core.geometry.construction_render import render_construction
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import (
    Fact,
    FigureFacts,
    Part,
    Target,
    coverage_gaps,
    disagreements,
    standard_reading,
    unverifiable,
    with_step,
)
from api.core.geometry.figure_check import check_construction, linear_expr


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def check(f: ConstructionFigure, text: str, facts: FigureFacts, **kw: Any) -> list[str]:
    return [i.message for i in check_construction(f, text, facts=facts, **kw)]


def P(deg: float, r: float = 5.0) -> tuple[float, float]:  # noqa: N802
    return (r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg)))


# ── B. Structural coverage (p8) ───────────────────────────────────────

TRI = FigureFacts(points=list("ABC"), triangles=["ABC"])


@pytest.mark.parametrize(("text", "fact"), [
    (r"In $\triangle ABC$, $\angle A$ and $\angle B$ are equal. Find $m\angle C$.",
     F("congruent_angles", ["A", "B"], quote="∠A and ∠B are equal")),
    (r"In $\triangle ABC$, sides $AB$ and $AC$ have the same length.",
     F("congruent_segments", ["AB", "AC"], quote="sides AB and AC have the same length")),
    (r"In $\triangle ABC$, $\angle B$ is obtuse.", F("other", ["B"], quote="∠B is obtuse")),
    (r"In $\triangle ABC$, $\angle A$ measures 40 degrees.",
     F("angle_measure", ["A"], value=40, quote="∠A measures 40 degrees")),
    (r"In $\triangle ABC$, $AB$ is 6 cm long and $BC$ is 8 cm long.", None),
    (r"In $\triangle ABC$, $AB$ equals $AC$.", F("congruent_segments", ["AB", "AC"], quote="AB equals AC")),
])
def test_every_clause_and_number_is_accounted_for(text: str, fact: Fact | None) -> None:
    """A reading with no fact for a clause, or no fact holding a number, is
    a gap (reviewer p8: each of these passed with a bare triangle)."""
    assert coverage_gaps(text, TRI) != [], text
    if fact is None:  # two lengths
        facts = [F("equal_length", ["AB"], value=6, quote="AB is 6 cm long"),
                 F("equal_length", ["BC"], value=8, quote="BC is 8 cm long")]
    else:
        facts = [fact]
    whole = TRI.model_copy(update={"givens": facts, "find": [Target(kind="angle", item="C")]})
    gaps = coverage_gaps(text, whole)
    assert gaps == [] or fact is not None and fact.kind == "other", (text, gaps)


def test_a_clause_with_names_and_no_fact_is_a_gap() -> None:
    """The structural rule on its own: words no fact accounts for are a gap
    (review round 6: tokens, not clauses)."""
    text = r"In $\triangle ABC$, $BC$ is three times as long as $AB$."
    assert any("three times" in g for g in coverage_gaps(text, TRI))
    named = TRI.model_copy(update={"givens": [F("other", ["BC", "AB"], quote="BC is three times as long as AB")]})
    assert coverage_gaps(text, named) != []  # an "other" fact accounts for nothing
    # Naming the figure needs nothing; saying something of a named part does.
    assert coverage_gaps(r"In $\triangle ABC$, AB is a leg.", TRI) == ["“AB”", "“leg”"]
    # A number no fact holds.
    assert "the number 7" in coverage_gaps("AB = 7.", FigureFacts(points=["A", "B"], givens=[
        F("equal_length", ["AB"], value=5, quote="AB = 7")]))


def test_a_figure_contradicting_an_unread_clause_is_never_checked() -> None:
    """p8 end to end: "∠A and ∠B are equal" unread, a figure with them
    unequal would pass; the reading is now refused instead."""
    text = r"In $\triangle ABC$, $\angle A$ and $\angle B$ are equal. Find $m\angle C$."
    assert coverage_gaps(text, TRI.model_copy(update={"find": [Target(kind="angle", item="C")]}))


# ── 1. Algebra (p5) ───────────────────────────────────────────────────

def test_algebra_is_parsed_not_guessed() -> None:
    assert linear_expr("2(x + 5)") == (2.0, 10.0, "x")
    assert linear_expr(r"\frac{x}{2} - 3") == (0.5, -3.0, "x")
    assert linear_expr("3[x - (2 - x)]") == (6.0, -6.0, "x")
    assert linear_expr("-(x) + 4") == (-1.0, 4.0, "x")
    for bad in ("x^2 + 1", "xy + 2", "x + y", "2x(x + 1)", "(x + 1", "x + 1)"):
        assert linear_expr(bad) is None, bad


def test_a_product_of_a_bracket_is_held_to_the_drawing() -> None:
    text = r"$m\angle ABD = 2(x + 5)^\circ$ and $m\angle DBC = (x + 20)^\circ$, and $\angle ABD \cong \angle DBC$."
    facts = FigureFacts(points=list("ABCD"), rays=["BA", "BD", "BC"], givens=[
        F("angle_measure", ["ABD"], expr="2(x + 5)", quote="m∠ABD = 2(x + 5)°"),
        F("angle_measure", ["DBC"], expr="x + 20", quote="m∠DBC = (x + 20)°"),
        F("congruent_angles", ["ABD", "DBC"], quote="∠ABD ≅ ∠DBC")], find=[Target(kind="other", item="x")])

    def at(each: float) -> ConstructionFigure:
        return fig(points={"B": (0, 0), "A": P(0), "D": P(each), "C": P(2 * each)}, rays=["BA", "BD", "BC"],
                   arc_groups=[["ABD", "DBC"]])

    assert check(at(30), text, facts) == []  # x = 10: 30° each
    assert any("2(x + 5) = 30° is not true" in m for m in check(at(35), text, facts))


def test_algebra_that_wont_parse_is_unverifiable() -> None:
    facts = FigureFacts(points=list("ABC"), givens=[F("angle_measure", ["ABC"], expr="x^2 + 1", quote="x²+1")])
    assert unverifiable(facts) != []


# ── 2/3. Simple polygons, any shape (p1, p7) ──────────────────────────

def test_a_bowtie_is_no_quadrilateral() -> None:
    text = r"$ABCD$ is an isosceles trapezoid with $\overline{AB} \parallel \overline{CD}$. Find $m\angle A$."
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"], givens=[
        F("isosceles_trapezoid", ["ABCD"], quote="isosceles trapezoid"), F("parallel", ["AB", "CD"], quote="AB ∥ CD")],
        find=[Target(kind="angle", item="A")])
    bowtie = fig(points={"A": (0, 0), "B": (4, 0), "C": (1, 2), "D": (3, 2)}, segments=["AB", "BC", "CD", "DA"],
                 parallel_groups=[["AB", "CD"]])
    assert "ABCD is drawn with sides BC and DA crossing, so it is no quadrilateral" in check(bowtie, text, facts)
    good = fig(points={"A": (0, 0), "B": (4, 0), "C": (3, 2), "D": (1, 2)}, segments=["AB", "BC", "CD", "DA"],
               parallel_groups=[["AB", "CD"]])
    assert check(good, text, facts) == []


@pytest.mark.parametrize(("shape", "pts"), [
    ("rhombus", {"_a": (0, 0), "_b": (5, 0.02), "_c": (10, 0), "_d": (5, -0.02)}),
    ("trapezoid", {"_a": (0, 0), "_b": (10, 0), "_c": (9, 0.02), "_d": (1, 0.02)}),
    ("parallelogram", {"_a": (0, 0), "_b": (10, 0), "_c": (10.1, 0.02), "_d": (0.1, 0.02)}),
])
def test_a_flat_shape_with_no_letters_is_refused(shape: str, pts: dict[str, tuple[float, float]]) -> None:
    """p7: an unlettered shape drawn flat is no shape (the 'short side' and
    'flat' flaws apply to whatever shape the checker matches)."""
    from api.core.geometry.figure_check import _Drawing, _has_shape

    flat = fig(points=pts, segments=["_a_b", "_b_c", "_c_d", "_d_a"])
    assert not _has_shape(_Drawing(flat), shape)
    text = f"The {shape} below has a perimeter of 40. Find the length of one side."
    facts = FigureFacts(givens=[F(shape, [], quote=shape)])
    assert f"the given a {shape} is not true in the drawing" in check(flat, text, facts)
    good = {"rhombus": {"_a": (0, 0), "_b": (3, 4), "_c": (8, 4), "_d": (5, 0)},
            "trapezoid": {"_a": (0, 0), "_b": (10, 0), "_c": (7, 4), "_d": (2, 4)},
            "parallelogram": {"_a": (0, 0), "_b": (6, 0), "_c": (8, 3), "_d": (2, 3)}}[shape]
    assert _has_shape(_Drawing(fig(points=good, segments=["_a_b", "_b_c", "_c_d", "_d_a"])), shape)


def test_a_sliver_with_a_side_too_short_is_flat() -> None:
    from api.core.geometry.figure_check import _polygon_flaw

    sliver = [(0.0, 0.0), (10.0, 0.0), (10.05, 0.1), (0.05, 0.1)]
    assert _polygon_flaw(sliver, 10.0) is not None
    assert _polygon_flaw([(0.0, 0.0), (6.0, 0.0), (8.0, 3.0), (2.0, 3.0)], 8.0) is None


# ── 4. Unused helper points (p10b) ────────────────────────────────────

def test_an_unused_far_helper_point_is_refused_and_not_measured() -> None:
    text = (r"In $\triangle ABC$, $D$ lies on $\overline{BC}$ and $\overline{AB} \cong \overline{AC}$. "
            r"Find $m\angle BAD$.")
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["AD"], givens=[
        F("on_segment", ["BC"], point="D", quote="D lies on BC"),
        F("congruent_segments", ["AB", "AC"], quote="AB ≅ AC")], find=[Target(kind="angle", item="BAD")])
    pts = {"A": (5, 9), "B": (0, 0), "C": (10, 0), "D": (5, 0.38)}
    far = fig(points={**pts, "_z": (100, 0)}, segments=["AB", "BC", "CA", "AD"], tick_groups=[["AB", "AC"]])
    near = fig(points=pts, segments=["AB", "BC", "CA", "AD"], tick_groups=[["AB", "AC"]])
    out = check(far, text, facts)
    assert "a helper point is used by nothing in the figure; remove it" in out
    # The far point doesn't stretch the tolerance: D off BC fails either way.
    assert "the given D is on BC is not true in the drawing" in out
    assert check(near, text, facts) == ["the given D is on BC is not true in the drawing"]
    # ...and doesn't shrink the drawing.
    import re

    def box(f: ConstructionFigure) -> str:
        m = re.search(r'viewBox="([^"]+)"', render_construction(f))
        assert m
        return m.group(1)

    assert box(far) == box(near)
    on = fig(points={**pts, "D": (5, 0)}, segments=["AB", "BC", "CA", "AD"], tick_groups=[["AB", "AC"]])
    assert check(on, text, facts) == []


# ── 5. Circles, arcs, sectors, shading (p2, p3, p11) ──────────────────

CIRCLE_O = r"Points $A$ and $B$ lie on circle $O$. Find $m\angle AOB$."
CIRCLE_FACTS = FigureFacts(points=list("OAB"), circles=["O"], givens=[
    F("on_circle", ["A", "B"], circle="O", quote="lie on circle O")], find=[Target(kind="angle", item="AOB")])
C_O = [{"center": "O", "through": "A"}]
BASE_O: dict[str, Any] = {"points": {"O": (0, 0), "A": (3, 0), "B": (0, 3)}, "segments": ["OA", "OB"]}


def test_each_circle_arc_and_sector_is_backed_by_the_problem() -> None:
    assert check(fig(**BASE_O, circles=C_O), CIRCLE_O, CIRCLE_FACTS) == []
    two = check(fig(**BASE_O, circles=[*C_O, {"center": "O", "radius": 1.0}]), CIRCLE_O, CIRCLE_FACTS)
    assert "extra circle not in the problem" in two
    assert "extra sector not in the problem" in check(
        fig(**BASE_O, circles=C_O, sectors=[{"center": "O", "endpoints": ["A", "B"]}]), CIRCLE_O, CIRCLE_FACTS)
    assert "extra arc not in the problem" in check(
        fig(**BASE_O, circles=C_O, arcs=[{"center": "O", "endpoints": ["A", "B"]}]), CIRCLE_O, CIRCLE_FACTS)


def test_an_arc_is_on_the_problems_circle() -> None:
    text = r"Points $A$ and $B$ lie on circle $O$. Find the length of arc $AB$ if $m\angle AOB = 90^\circ$."
    facts = FigureFacts(points=list("OAB"), circles=["O"], givens=[
        F("on_circle", ["A", "B"], circle="O", quote="lie on circle O"),
        F("central_angle", ["AOB"], value=90, circle="O", quote="m∠AOB = 90°")])
    good = fig(**BASE_O, circles=C_O, arcs=[{"center": "O", "endpoints": ["A", "B"]}], right_angles=["AOB"])
    assert check(good, text, facts) == []
    wrong = fig(points={**BASE_O["points"], "_c": (3, 3)}, segments=["OA", "OB"], circles=C_O,
                arcs=[{"center": "_c", "endpoints": ["A", "B"]}], right_angles=["AOB"])
    assert ("the arc AB is not drawn on the problem's circle (centred at its centre, with both ends on it)"
            in check(wrong, text, facts))


def test_shading_is_the_region_the_problem_shades() -> None:
    text = r"Find the area of the shaded region of $\triangle ABC$ outside $\triangle ABD$."
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC", "ABD"])
    pts = {"A": (0, 0), "B": (6, 0), "C": (3, 5), "D": (3, 2)}
    wrong = fig(points=pts, segments=["AB", "BC", "CA", "AD", "BD"], shaded=[{"polygon": ["A", "B", "D"]}])
    assert "the shading is not on the region the problem says is shaded" in check(wrong, text, facts)
    shades = r"In $\triangle ABC$, triangle $ABD$ is shaded."
    right = check(fig(points=pts, segments=["AB", "BC", "CA", "AD", "BD"], shaded=[{"polygon": ["A", "B", "D"]}]),
                  shades, facts)
    assert not [m for m in right if "shad" in m]
    # The region the problem shades must be drawn shaded.
    bare = check(fig(points=pts, segments=["AB", "BC", "CA", "AD", "BD"]), shades, facts)
    assert "not drawn: the shading of ABD" in bare
    sector = check(fig(**BASE_O, circles=C_O), r"Points $A$ and $B$ lie on circle $O$; sector $AOB$ is shaded.",
                   CIRCLE_FACTS)
    assert "not drawn: the shading of sector AOB" in sector


def test_shading_is_read_from_capital_names_only() -> None:
    from api.core.geometry.figure_check import shaded_regions

    assert shaded_regions("the region ABD is shaded") == [("polygon", ("A", "B", "D"))]
    assert shaded_regions("shade the region outside the triangle") == []


def test_a_shading_fact_is_read_by_code() -> None:
    r = FigureFacts(points=list("ABCD"), triangles=["ABC", "ABD"], givens=[F("other", ["ABD"], quote="△ABD is shaded")])
    out = standard_reading(r)
    assert out.givens == [] and "shading" in out.dropped[0]
    kept = FigureFacts(points=list("ABCD"), givens=[F("other", ["ABD"], quote="△ABD is shaded blue on top")])
    assert len(standard_reading(kept).givens) == 1


def test_a_central_angle_at_the_circles_centre_is_its_measure() -> None:
    """Two readings of "m∠AOB = 90°" in circle O, one as a central angle and
    one as a measure, say the same."""
    a = CIRCLE_FACTS.model_copy(update={"givens": [*CIRCLE_FACTS.givens, F(
        "central_angle", ["AOB"], value=90, circle="O", quote="m∠AOB = 90°")]})
    b = CIRCLE_FACTS.model_copy(update={"givens": [*CIRCLE_FACTS.givens, F(
        "angle_measure", ["AOB"], value=90, quote="m∠AOB = 90°")]})
    assert disagreements(a, b) == []
    other = a.model_copy(update={"givens": [*CIRCLE_FACTS.givens, F(
        "central_angle", ["APB"], value=90, circle="O", quote="m∠APB = 90°")]})
    assert disagreements(other, b.model_copy(update={"givens": [*CIRCLE_FACTS.givens, F(
        "angle_measure", ["APB"], value=90, quote="m∠APB = 90°")]}))


# ── Batch: what the readings say, read the same way


# ── 6. Step figures read the step (p9) ────────────────────────────────

AREA = r"In $\triangle ABC$, $AB = 5$, $AC = 5$, and $BC = 6$. Find the area of $\triangle ABC$."
AREA_FACTS = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
    F("equal_length", ["AB"], value=5, quote="AB = 5"), F("equal_length", ["AC"], value=5, quote="AC = 5"),
    F("equal_length", ["BC"], value=6, quote="BC = 6")])
STEP = (r"Altitude: Draw altitude $\overline{AD} \perp \overline{BC}$ with $D$ the midpoint of $\overline{BC}$. "
        r"Then $BD = 3$ and $AD = 4$.")
STEP_FACTS = FigureFacts(points=list("ABCD"), segments=["AD"], givens=[
    F("perpendicular", ["AD", "BC"], quote="altitude AD ⊥ BC"),
    F("midpoint", ["BC"], point="D", quote="D the midpoint of BC"),
    F("equal_length", ["BD"], value=3, quote="BD = 3"), F("equal_length", ["AD"], value=4, quote="AD = 4")])
AREA_BASE = fig(points={"A": (3, 4), "B": (0, 0), "C": (6, 0)}, segments=["AB", "BC", "CA"])
STEP_GOOD = fig(points={"A": (3, 4), "B": (0, 0), "C": (6, 0), "D": (3, 0)}, segments=["AB", "BC", "CA", "AD"],
                right_angles=["ADC"], tick_groups=[["BD", "DC"]])
STEP_BAD = fig(points={"A": (3, 4), "B": (0, 0), "C": (6, 0), "D": (1.5, 0)}, segments=["AB", "BC", "CA", "AD"])


def test_a_step_figure_is_held_to_what_the_step_states() -> None:
    step_facts = with_step(AREA_FACTS, STEP_FACTS)
    assert check(STEP_GOOD, AREA, step_facts, step_text=STEP, base=AREA_BASE) == []
    bad = check(STEP_BAD, AREA, step_facts, step_text=STEP, base=AREA_BASE)
    assert "the given D is the midpoint of BC is not true in the drawing" in bad
    assert "the given AD ⊥ BC is not true in the drawing" in bad


def test_with_step_adds_the_steps_facts_and_keeps_the_questions() -> None:
    both = with_step(AREA_FACTS, STEP_FACTS.model_copy(update={"prove": [F("congruent_segments", ["BD", "DC"])]}))
    assert both.points == list("ABCD") and both.segments == ["AD"]
    assert both.givens[:3] == AREA_FACTS.givens and len(both.givens) == 3 + 4 + 1
    assert both.prove == AREA_FACTS.prove


@pytest.mark.asyncio
async def test_each_step_is_read_and_its_figure_checked_against_it() -> None:
    reads: list[dict[str, Any]] = []

    async def read(text: str, **kw: Any) -> tuple[FigureFacts | None, list[str]]:
        reads.append({"text": text, **kw})
        return (STEP_FACTS, []) if kw.get("step_of") else (AREA_FACTS, [])

    steps: list[dict[str, Any]] = [
        {"title": "Altitude", "description": STEP.removeprefix("Altitude: "), "figure_spec": STEP_BAD.model_dump(),
         "figure_facts": {"givens": []}},  # a reading the model wrote: never trusted
        {"title": "Plain", "description": "No figure."},
    ]
    with patch.object(qbg, "read_figure_facts", AsyncMock(side_effect=read)), \
            patch.object(qbg, "redraw_figure", AsyncMock(return_value=None)):
        out, drops, _ = await qbg._render_step_figures_with_retry(
            steps, question_text=AREA, question_spec=AREA_BASE.model_dump(), mode="m", user_id=None,
            facts=AREA_FACTS,
        )
    assert [r["step_of"] for r in reads] == [AREA]
    assert reads[0]["text"] == STEP.removeprefix("Altitude: ")  # a heading naming no point states nothing
    assert "figure_svg" not in out[0] and "figure_facts" not in out[0]
    assert any("midpoint of BC is not true" in m for m in drops[1])

    steps[0]["figure_spec"] = STEP_GOOD.model_dump()
    with patch.object(qbg, "read_figure_facts", AsyncMock(side_effect=read)):
        out, drops, _ = await qbg._render_step_figures_with_retry(
            steps, question_text=AREA, question_spec=AREA_BASE.model_dump(), mode="m", user_id=None,
            facts=AREA_FACTS,
        )
    assert drops == {} and out[0]["figure_svg"]
    assert out[0]["figure_facts"] == with_step(AREA_FACTS, STEP_FACTS).model_dump()


@pytest.mark.asyncio
async def test_a_step_that_cant_be_read_has_no_figure() -> None:
    async def read(text: str, **kw: Any) -> tuple[FigureFacts | None, list[str]]:
        if kw.get("step_of"):
            return None, ["the reading of the problem missed “AD ⊥ BC”, so the figure can't be checked"]
        return AREA_FACTS, []

    steps = [{"title": "Altitude", "description": STEP, "figure_spec": STEP_GOOD.model_dump(),
              "figure_facts": {"givens": []}}]  # written by the model: never kept
    with patch.object(qbg, "read_figure_facts", AsyncMock(side_effect=read)):
        out, drops, _ = await qbg._render_step_figures_with_retry(
            steps, question_text=AREA, question_spec=AREA_BASE.model_dump(), mode="m", user_id=None,
            facts=AREA_FACTS,
        )
    assert "figure_svg" not in out[0]
    assert drops == {1: ["the reading of the step missed “AD ⊥ BC”, so the figure can't be checked"]}
    # Without the step's facts, a step figure is never checked against the
    # question's alone.
    assert "figure_svg" not in qbg._render_step_figures(
        [{"title": "t", "description": STEP, "figure_spec": STEP_GOOD.model_dump()}],
        question_text=AREA, question_spec=AREA_BASE.model_dump())[0]


def test_a_step_title_is_read_only_when_it_names_a_point() -> None:
    assert qbg._step_statement({"title": "Altitude", "description": "Draw AD."}) == "Draw AD."
    assert qbg._step_statement({"title": "Find the angle", "description": "x = 3"}) == "x = 3"
    assert qbg._step_statement({"title": "Draw AD", "description": "It is ⊥ BC."}) == "Draw AD: It is ⊥ BC."


# ── Batch: what the readings say, read the same way ───────────────────

def test_an_other_fact_checked_in_full_is_set_aside() -> None:
    q = "PQ is the perpendicular bisector of AB"
    r = FigureFacts(points=list("ABPQ"), givens=[
        F("perpendicular", ["PQ", "AB"], quote=q), F("bisects_segment", ["PQ", "AB"], quote=q),
        F("other", ["PQ", "AB"], quote=q)])
    out = standard_reading(r)
    assert [f.kind for f in out.givens] == ["perpendicular", "bisects_segment"]
    assert out.dropped and "set aside" in out.dropped[0]
    # Words no checked fact accounts for keep the fact (it stays unverifiable).
    secant = FigureFacts(points=list("ABO"), circles=["O"], givens=[
        F("on_circle", ["A", "B"], circle="O", quote="a secant passes through A and B on circle O"),
        F("other", ["A", "B"], quote="a secant passes through A and B on circle O")])
    assert len(standard_reading(secant).givens) == 2


def test_draw_xy_is_a_part_to_draw() -> None:
    r = FigureFacts(points=list("ABCD"), givens=[F("other", ["BD"], quote="Draw BD.")])
    out = standard_reading(r)
    assert out.givens == [] and out.segments == ["BD"]
    sq = {"A": (0, 0), "B": (4, 0), "C": (4, 3), "D": (0, 3)}
    assert "not drawn: BD" in check(fig(points=sq, segments=["AB", "BC", "CD", "DA"]), "ABCD. Draw BD.", out)
    assert "not drawn: BD" not in check(fig(points=sq, segments=["AB", "BC", "CD", "DA", "BD"]), "ABCD. Draw BD.", out)


def test_meet_needs_its_own_fact() -> None:
    text = r"Lines $AB$ and $CD$ meet at $E$."
    bare = FigureFacts(points=list("ABCDE"), lines=["AB", "CD"])
    assert coverage_gaps(text, bare)
    met = bare.model_copy(update={"givens": [F("intersect", ["AB", "CD"], point="E", quote="AB and CD meet at E")]})
    assert coverage_gaps(text, met) == []


def test_a_triangles_angle_sum_states_nothing() -> None:
    q = "∠A + ∠B + ∠C = 180°"
    r = FigureFacts(points=list("ABC"), triangles=["ABC"], prove=[F("other", ["A", "B", "C"], quote=q)])
    assert standard_reading(r).prove == []
    text = r"In $\triangle ABC$, verify that $\angle A + \angle B + \angle C = 180^\circ$."
    assert coverage_gaps(text, TRI) == []


def test_two_sides_equal_is_congruence() -> None:
    text = r"In $\triangle ADC$, $DA = DC$."
    facts = FigureFacts(points=list("ADC"), triangles=["ADC"],
                        givens=[F("equal_length", ["DA", "DC"], quote="DA = DC")])
    unequal = fig(points={"A": (0, 0), "D": (2, 4), "C": (6, 0)}, segments=["AD", "DC", "CA"])
    assert "the given DA = DC is not true in the drawing" in check(unequal, text, facts)
    iso = fig(points={"A": (0, 0), "D": (3, 4), "C": (6, 0)}, segments=["AD", "DC", "CA"], tick_groups=[["DA", "DC"]])
    assert check(iso, text, facts) == []


def test_coordinates_are_read_by_code_and_held() -> None:
    text = r"Triangle $ABC$ has vertices $A(0, 0)$, $B(4, 0)$ and $C(0, 3)$. Determine whether it is a right triangle."
    r = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("other", ["A", "B", "C"], quote="vertices A(0, 0), B(4, 0) and C(0, 3)")])
    read = standard_reading(r)
    assert read.givens == [] and "coordinates" in read.dropped[0]
    assert coverage_gaps(text, read) == []
    assert check(fig(points={"A": (1, 1), "B": (9, 1), "C": (1, 7)}, segments=["AB", "BC", "CA"]), text, read) == []
    wrong = check(fig(points={"A": (0, 0), "B": (4, 0), "C": (2, 3)}, segments=["AB", "BC", "CA"]), text, read)
    assert "the given the points are at A(0, 0), B(4, 0), C(0, 3) is not true in the drawing" in wrong
    flipped = check(fig(points={"A": (0, 0), "B": (-4, 0), "C": (0, -3)}, segments=["AB", "BC", "CA"]), text, read)
    assert flipped  # a rotation is not the problem's figure
    # Only a quote that gives coordinates is read as coordinates.
    names = standard_reading(FigureFacts(points=list("ABCD"), givens=[F("other", ["AB", "CD"], quote="AB and CD")]))
    assert not any("coordinates" in x for x in names.dropped)


def test_the_alternate_interior_parenthetical_is_where_the_angles_sit() -> None:
    q = r"∠AGH ≅ ∠GHD (alternate interior angles)"
    r = FigureFacts(points=list("AGHD"), givens=[F("congruent_angles", ["AGH", "GHD"], quote=q)])
    assert [f.kind for f in standard_reading(r).givens] == ["congruent_angles", "alternate_interior"]


def test_an_interior_ray_is_held_and_its_arms_are_not_requested() -> None:
    text = r"Ray $BD$ lies in the interior of $\angle ABC$. If $m\angle ABD = 30^\circ$, find $m\angle DBC$."
    r = FigureFacts(points=list("ABCD"), rays=["BD"], givens=[
        F("other", ["BD", "ABC"], quote="Ray BD lies in the interior of ∠ABC"),
        F("angle_measure", ["ABD"], value=30, quote="m∠ABD = 30°")], find=[Target(kind="angle", item="DBC")])
    read = standard_reading(r)
    assert [f.kind for f in read.givens] == ["interior_ray", "angle_measure"]
    inside = fig(points={"B": (0, 0), "A": P(0), "D": P(30), "C": P(80)}, rays=["BA", "BD", "BC"],
                 angle_labels={"ABD": "30°"})
    outside = fig(points={"B": (0, 0), "A": P(0), "D": P(30), "C": P(20)}, rays=["BA", "BD", "BC"])
    assert check(inside, text, read) == []
    assert "the given ray BD lies inside ∠ABC is not true in the drawing" in check(outside, text, read)
    # An arm of an angle the problem names is no part the teacher asked
    # for: one reading listing BA under requested doesn't disagree.
    asks = read.model_copy(update={"requested": [Part(kind="ray", item="BA"), Part(kind="ray", item="BC")]})
    assert disagreements(read, asks) == []
    assert disagreements(read, read.model_copy(update={"requested": [Part(kind="segment", item="AC")]}))


def test_an_extension_is_held() -> None:
    text = r"In $\triangle ABC$, side $\overline{BC}$ is extended to point $D$. Find the exterior angle $\angle ACD$."
    r = FigureFacts(points=list("ABCD"), triangles=["ABC"], givens=[
        F("on_line", ["BC"], point="D", quote="side BC is extended to point D")],
        find=[Target(kind="angle", item="ACD")])
    read = standard_reading(r)
    assert [(f.kind, f.items, f.point) for f in read.givens] == [("extension", ["BC"], "D")]
    tri = {"A": (2, 4), "B": (0, 0), "C": (5, 0)}
    past = fig(points={**tri, "D": (8, 0)}, segments=["AB", "BC", "CA", "CD"])
    behind = fig(points={**tri, "D": (-3, 0)}, segments=["AB", "BC", "CA", "BD"])
    assert check(past, text, read) == []
    assert any("D" in m and "not true" in m for m in check(behind, text, read))


def test_a_problem_with_no_point_names_says_how_to_fix_it() -> None:
    assert _IN_WORDS == ("this problem describes the figure in words without naming its points; add point names "
                         "(e.g. 'lines AB and CD meet at E') and I can draw it")


def test_a_shape_the_words_dont_state_is_set_aside() -> None:
    """Breadth 6c5008f2: both readings took "Quadrilateral ABCD" for a given
    parallelogram, so the parallels to prove counted as given and their
    arrows were kept. A shape fact whose words neither name the shape nor
    state a relation is set aside."""
    named = FigureFacts(points=list("ABCD"), polygons=["ABCD"], givens=[
        F("parallelogram", ["ABCD"], quote="Quadrilateral ABCD")])
    assert standard_reading(named).givens == []
    for kind, quote in (("parallelogram", "ABCD is a parallelogram"), ("isosceles", "DA = DC"),
                        ("right_triangle", "∠C = 90°"), ("parallelogram", "AB ∥ CD and BC ∥ DA")):
        kept = FigureFacts(points=list("ABCD"), givens=[F(kind, ["ABCD" if "ABCD" in quote else "ADC"], quote=quote)])
        assert len(standard_reading(kept).givens) == 1, quote
    # End to end: the arrows on the statement to prove are taken off.
    text = (r"Quadrilateral $ABCD$ has vertices $A(0,0)$, $B(4,2)$, $C(6,6)$, and $D(2,4)$. Prove that $ABCD$ is a "
            r"parallelogram by showing both pairs of opposite sides are parallel.")
    q = "prove that ABCD is a parallelogram by showing both pairs of opposite sides are parallel"
    reading = standard_reading(named.model_copy(update={"prove": [
        F("parallelogram", ["ABCD"], quote=q), F("parallel", ["AB", "CD"], quote=q),
        F("parallel", ["BC", "DA"], quote=q)]}))
    spec = {"type": "geometry", "shape": "construction", "points": {"A": [0, 0], "B": [4, 2], "C": [6, 6], "D": [2, 4]},
            "segments": ["AB", "BC", "CD", "DA"], "parallel_groups": [["AB", "CD"], ["BC", "DA"]]}
    shown, svg, _ = qbg._check_figure(spec, text, facts=reading)
    assert svg and shown is not None and shown["parallel_groups"] == []


def test_an_angle_placed_by_its_own_name_states_nothing() -> None:
    """dd7ab4c1 step 3: "∠BCA is at vertex C, inside △ABC, between sides BC
    and AC" restates the angle's name; one reading listed it, one didn't."""
    from api.core.geometry.facts import _names_its_angle

    assert _names_its_angle("∠BCA is at vertex C, inside △ABC, between sides BC and AC")
    assert _names_its_angle("∠DAC is at vertex A")
    for wrong in ("∠BCA is at vertex B", "∠BCA is at vertex C, inside △ABD",
                  "∠BCA is at vertex C, between sides BC and AB", "∠BCA is at vertex C and is acute"):
        assert not _names_its_angle(wrong), wrong
    r = FigureFacts(points=list("ABC"), givens=[F("other", ["BCA"], quote="∠BCA is at vertex C, inside △ABC")])
    assert standard_reading(r).givens == []


@pytest.mark.asyncio
async def test_a_step_is_read_with_the_questions_names() -> None:
    """The step is read as the problem, with the question shown for its
    point names: a step that uses the question's points invents none."""
    import api.core.construction_figures as cf

    sent: list[str] = []

    async def once(system: str, message: str, **_kw: Any) -> FigureFacts:
        sent.append(message)
        return STEP_FACTS.model_copy(update={"points": list("ABCD")})

    step = "Draw altitude AD ⊥ BC with D the midpoint of BC. Then BD = 3 and AD = 4."
    with patch.object(cf, "_read_once", side_effect=once):
        facts, why = await cf.read_figure_facts(step, mode="m", user_id=None, step_of=AREA)
    assert why == [] and facts is not None
    assert all(m.startswith(f"Problem:\n{step}") and "one step of the solution" in m and AREA in m for m in sent)
    # A step that writes no C: the reading's C comes from the question's
    # names, and without the question it would be a made-up point.
    no_c = "Draw altitude AD. Then BD = 3 and AD = 4."
    with patch.object(cf, "_read_once", side_effect=once):
        _f, with_q = await cf.read_figure_facts(no_c, mode="m", user_id=None, step_of=AREA)
        alone, why = await cf.read_figure_facts(no_c, mode="m", user_id=None)
    assert _IN_WORDS not in with_q
    assert alone is None and why == [_IN_WORDS]


@pytest.mark.parametrize(("text", "quote"), [
    (r"In $\triangle ABC$, $\angle A$ and $\angle B$ are equal.", "∠A and ∠B are equal"),
    (r"In $\triangle ABC$, sides $AB$ and $AC$ have the same length.", "sides AB and AC have the same length"),
    (r"In $\triangle ABC$, $\angle B$ is twice $\angle A$.", "∠B is twice ∠A"),
    (r"In $\triangle ABC$, $BC$ is three times as long as $AB$.", "BC is three times as long as AB"),
    (r"In $\triangle ABC$, $\angle B$ is obtuse.", "∠B is obtuse"),
    (r"In $\triangle ABC$, $AB$ equals $AC$.", "AB equals AC"),
    (r"In $\triangle ABC$, $\angle A$ measures 40 degrees.", "∠A measures 40 degrees"),
])
def test_a_relation_word_needs_a_fact_of_its_kind(text: str, quote: str) -> None:
    """The signal words beside the structural rule: a fact that quotes the
    clause (and holds its number) but can't hold its relation ("other")
    doesn't account for it."""
    value = 40 if "40" in quote else None
    other = TRI.model_copy(update={"givens": [F("other", ["ABC"], quote=quote, value=value)]})
    assert coverage_gaps(text, other) != [], text


def test_a_shading_statement_needs_no_fact() -> None:
    text = r"In $\triangle ABC$ and $\triangle ABD$, $\triangle ABD$ is shaded."
    facts = FigureFacts(points=list("ABCD"), segments=["AB"], triangles=["ABC", "ABD"])
    assert coverage_gaps(text, facts) == []
    assert coverage_gaps(text.replace("is shaded", "is obtuse"), facts) != []
