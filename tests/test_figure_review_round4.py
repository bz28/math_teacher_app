"""Review round 4 of PR #989: each reviewer reproduction and each new rule,
as a test that fails if its fix is reverted.

1. A shape word in a question ("given ∠B is obtuse", "in right △ABC") is
   still a statement: only the target phrase ("Find m∠A") is exempt. Acute,
   obtuse and scalene are fact kinds the checker verifies.
2. Mixed numbers (4\\frac{1}{2}, 4 1/2) are one number; a decimal comma
   fails closed.
3. Major and minor arcs and sectors: code draws the side the problem names
   and the checker verifies it.
4. Complement shading ("everything except sector AOB") fails closed and is
   never matched as the named region.
5. An unnamed shape's length roles (leg, hypotenuse, radius, diameter) are
   verified, or fail closed.
6. Every given with a textbook mark must be marked ("the givens are
   marked" is then true).
7. The reply says when accepting removes or replaces a diagram.
8. A decimal point or an abbreviation's dot doesn't end a clause.
9. A quote accounts for the one clause it lies in; a name-only quote
   accounts for nothing; one over several clauses accounts only for the
   clauses that write nothing but its own points and numbers.
"""

from __future__ import annotations

import math
from types import SimpleNamespace
from typing import Any

import pytest

from api.core.geometry.construction_render import arc_span, render_construction
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import (
    Fact,
    FigureFacts,
    Target,
    _clauses,
    _expr,
    _question_spans,
    coverage_gaps,
    disagreements,
    standard_reading,
    unverifiable,
)
from api.core.geometry.figure_check import (
    _clean,
    check_construction,
    linear_expr,
    unbacked_marks,
    unmarked_givens,
    with_arc_sides,
)


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def check(f: ConstructionFigure, text: str, facts: FigureFacts, **kw: Any) -> list[str]:
    return [i.message for i in check_construction(f, text, facts=facts, **kw)]


def P(deg: float, r: float = 5.0) -> tuple[float, float]:  # noqa: N802
    return (r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg)))


def T(**kw: Any) -> FigureFacts:  # noqa: N802
    return FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="A")], **kw)


ACUTE = fig(points={"A": (0, 0), "B": (4, 6), "C": (8, 0)}, segments=["AB", "BC", "CA"])
OBTUSE = fig(points={"A": (0, 0), "B": (4, 2), "C": (8, 0)}, segments=["AB", "BC", "CA"])
SCALENE = fig(points={"A": (0, 0), "B": (6, 0), "C": (1, 4)}, segments=["AB", "BC", "CA"])


# ── 1. Shape words inside questions ───────────────────────────────────

@pytest.mark.parametrize("text", [
    r"Find $m\angle A$ in $\triangle ABC$, given $\angle B$ is obtuse.",
    r"Find $m\angle A$ in $\triangle ABC$ given $\angle B$ is obtuse.",
    r"Find $m\angle A$ in $\triangle ABC$ with $\angle B$ obtuse.",
    r"Find $m\angle A$ in $\triangle ABC$ if $\angle B$ is obtuse.",
    r"Find $m\angle A$ in right $\triangle ABC$.",
    r"Find $m\angle A$ in right triangle $ABC$.",
    r"Find $m\angle A$ in acute $\triangle ABC$.",
    r"Find $m\angle A$ in scalene $\triangle ABC$.",
    r"Find $m\angle A$ in $\triangle ABC$, given $AB$ is longer than $BC$.",
])
def test_a_statement_inside_a_question_needs_a_fact(text: str) -> None:
    gaps = coverage_gaps(text, T())
    assert gaps, text


def test_a_shape_word_in_a_question_needs_a_fact_of_its_kind() -> None:
    # The clause is quoted (so the clause rule is met); the word still needs
    # an obtuse fact, though it sits in the question's sentence.
    text = r"Find $m\angle A$ in $\triangle ABC$ with $\angle B$ obtuse."
    assert coverage_gaps(text, T(givens=[F("equal_length", ["AB"], value=5, quote="∠B obtuse")]))
    assert coverage_gaps(text, standard_reading(T(givens=[F("other", ["B"], quote=r"\angle B obtuse")]))) == []


def test_only_the_target_phrase_is_a_question() -> None:
    t = _clean(r"Find $m\angle A$ in $\triangle ABC$, given $\angle B$ is obtuse.")
    assert [t[a:b].strip() for a, b in _question_spans(t)] == [r"Find  \angle A"]
    # The rest of a list of targets only names parts: it states nothing.
    text = r"In $\triangle PQR$, $S$ lies on $\overline{PR}$, $PS = 4$ and $SR = 9$. Find $QS$, $PQ$, and $QR$."
    facts = FigureFacts(points=list("PQRS"), triangles=["PQR"], givens=[
        F("on_segment", ["PR"], point="S", quote="S lies on PR"), F("equal_length", ["PS"], value=4, quote="PS = 4"),
        F("equal_length", ["SR"], value=9, quote="SR = 9")])
    assert coverage_gaps(text, facts) == []


@pytest.mark.parametrize(("text", "quote", "right", "wrong"), [
    (r"Find $m\angle A$ in $\triangle ABC$, given $\angle B$ is obtuse.", r"\angle B is obtuse", OBTUSE, ACUTE),
    (r"Find $m\angle A$ in obtuse $\triangle ABC$.", r"obtuse \triangle ABC", OBTUSE, ACUTE),
    (r"Find $m\angle A$ in acute $\triangle ABC$.", r"acute \triangle ABC", ACUTE, OBTUSE),
    (r"Find $m\angle A$ in scalene $\triangle ABC$.", r"scalene \triangle ABC", SCALENE, ACUTE),
])
def test_acute_obtuse_and_scalene_are_verified(text: str, quote: str, right: ConstructionFigure,
                                               wrong: ConstructionFigure) -> None:
    facts = standard_reading(T(givens=[F("other", ["ABC"], quote=quote)]))
    assert coverage_gaps(text, facts) == [] and unverifiable(facts) == []
    assert check(right, text, facts) == []
    assert check(wrong, text, facts)


def test_an_acute_angle_of_a_right_triangle_is_its_fact() -> None:
    text = (r"In right triangle $\triangle ABC$ with the right angle at $C$, one acute angle measures "
            r"$(3x + 4)^\circ$ and the other measures $(6x - 13)^\circ$. Find the measure of each acute angle.")
    right = F("right_triangle", ["ABC"], point="C", quote="right triangle △ABC with the right angle at C")
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        right, F("angle_measure", ["A"], expr="3x+4", quote="one acute angle measures (3x + 4)°"),
        F("angle_measure", ["B"], expr="6x-13", quote="the other measures (6x - 13)°")])
    assert coverage_gaps(text, facts) == []
    # "∠C is acute" (no "angle" after the word) is not stated by a right triangle.
    text = r"In right $\triangle ABC$, $\angle C$ is acute."
    said = F("right_triangle", ["ABC"], point="A", quote=r"In right △ABC, ∠C is acute")
    assert coverage_gaps(text, FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[said]))


def test_right_triangle_with_its_right_angle_is_one_statement() -> None:
    text = r"In right $\triangle ABC$ with the right angle at $C$, $AC = 9$ and $BC = 40$. Find $AB$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("right_triangle", ["ABC"], point="C", quote="right △ABC with the right angle at C"),
        F("equal_length", ["AC"], value=9, quote="AC = 9"), F("equal_length", ["BC"], value=40, quote="BC = 40")])
    assert coverage_gaps(text, facts) == []
    # A second right angle elsewhere still needs its own fact.
    two = text.replace("Find $AB$.", r"$\angle D$ is a right angle.")
    assert coverage_gaps(two, facts)


# ── 2. Mixed numbers and decimal commas ───────────────────────────────

@pytest.mark.parametrize(("expr", "want"), [
    (r"4\frac{1}{2}x", (4.5, 0.0, "x")), (r"2\frac{1}{2}x+10", (2.5, 10.0, "x")),
    (r"x+2\frac{1}{2}", (1.0, 2.5, "x")), (r"4 1/2x", (4.5, 0.0, "x")),
    (r"\dfrac{x}{2}", (0.5, 0.0, "x")), (r"\tfrac12 x", (0.5, 0.0, "x")),
])
def test_mixed_numbers_are_one_number(expr: str, want: tuple[float, float, str]) -> None:
    got = linear_expr(expr)
    assert got is not None and got[2] == want[2]
    assert got[0] == pytest.approx(want[0]) and got[1] == pytest.approx(want[1])


@pytest.mark.parametrize("expr", ["1,5x", "2{,}5x"])
def test_a_decimal_comma_fails_closed(expr: str) -> None:
    assert linear_expr(expr) is None


MIXED = (r"$m\angle ABD = \left(2\frac{1}{2}x\right)^\circ$, $m\angle DBC = x^\circ$, and "
         r"$m\angle ABC = 105^\circ$. Find $x$.")


def _mixed(expr: str) -> FigureFacts:
    return FigureFacts(points=list("ABCD"), rays=["BA", "BD", "BC"], givens=[
        F("angle_measure", ["ABD"], expr=expr, quote=r"m∠ABD = (2\frac{1}{2}x)°"),
        F("angle_measure", ["DBC"], expr="x", quote="m∠DBC = x°"),
        F("angle_measure", ["ABC"], value=105, quote="m∠ABC = 105°")], find=[Target(kind="other", item="x")])


def _rays(a1: float, a2: float) -> ConstructionFigure:
    return fig(points={"B": (0, 0), "A": P(0), "D": P(a1), "C": P(a1 + a2)}, rays=["BA", "BD", "BC"],
               angle_labels={"ABC": "105°"})


@pytest.mark.parametrize("expr", [r"2\frac{1}{2}x", "5x/2", "2.5x"])
def test_a_mixed_number_in_a_given(expr: str) -> None:
    facts = _mixed(expr)
    assert coverage_gaps(MIXED, facts) == []  # 2½ is a number the fact states
    assert check(_rays(75, 30), MIXED, facts) == []
    assert check(_rays(52.5, 52.5), MIXED, facts)


def test_readings_that_write_one_expression_two_ways_agree() -> None:
    assert _expr("5x/2") == _expr("2.5x") == _expr(r"2\frac{1}{2}x")
    assert disagreements(_mixed("5x/2"), _mixed("2.5x")) == []
    assert disagreements(_mixed("5x/2"), _mixed("3x"))


# ── 3. Major and minor arcs ───────────────────────────────────────────

ARC_TEXT = r"Points $A$ and $B$ lie on circle $O$ and $m\angle AOB = 90^\circ$. Find the length of major arc $AB$."
ARC_FACTS = FigureFacts(points=list("OAB"), circles=["O"], segments=["OA", "OB"], givens=[
    F("on_circle", ["A", "B"], circle="O", quote="A and B lie on circle O"),
    F("central_angle", ["AOB"], value=90, circle="O", quote="m∠AOB = 90°")],
    find=[Target(kind="other", item="major arc AB")])
ARC_SPEC: dict[str, Any] = {
    "type": "geometry", "shape": "construction", "points": {"O": [0, 0], "A": [3, 0], "B": [0, 3]},
    "segments": ["OA", "OB"], "circles": [{"center": "O", "through": "A"}],
    "arcs": [{"center": "O", "endpoints": ["A", "B"]}], "right_angles": ["AOB"]}


def test_the_named_side_of_an_arc_is_drawn_and_checked() -> None:
    minor = ConstructionFigure.model_validate(ARC_SPEC)
    assert any("other side of the circle" in m for m in check(minor, ARC_TEXT, ARC_FACTS))
    spec = with_arc_sides(ARC_SPEC, ARC_TEXT)
    assert spec["arcs"][0]["major"] is True
    major = ConstructionFigure.model_validate(spec)
    assert check(major, ARC_TEXT, ARC_FACTS) == []
    _, _, _, sweep = arc_span(major.points, major.arcs[0])
    assert abs(sweep) == pytest.approx(1.5 * math.pi, abs=0.01)  # 270°, not 90°
    assert render_construction(major) != render_construction(minor)
    # A problem that names no side keeps the spec as it is (and its fingerprint).
    plain = ARC_TEXT.replace("major arc", "arc")
    assert with_arc_sides(ARC_SPEC, plain) is ARC_SPEC


def test_a_shaded_major_sector_must_be_the_major_one() -> None:
    text = (r"Points $A$ and $B$ lie on circle $O$ and $m\angle AOB = 90^\circ$. Major sector $AOB$ is "
            r"shaded. Find its area.")
    spec = {**ARC_SPEC, "arcs": [], "shaded": [{"sector": {"center": "O", "endpoints": ["A", "B"]}}]}
    assert check(ConstructionFigure.model_validate(spec), text, ARC_FACTS)
    assert check(ConstructionFigure.model_validate(with_arc_sides(spec, text)), text, ARC_FACTS) == []


# ── 4. Complement shading fails closed ────────────────────────────────

CIRCLE_FACTS = FigureFacts(points=list("OAB"), circles=["O"], segments=["OA", "OB"], givens=[
    F("on_circle", ["A", "B"], circle="O", quote="A and B lie on circle O"),
    F("central_angle", ["AOB"], value=90, circle="O", quote="m∠AOB = 90°")])
SECTOR_SHADED = fig(points={"O": (0, 0), "A": (3, 0), "B": (0, 3)}, segments=["OA", "OB"],
                    circles=[{"center": "O", "through": "A"}], right_angles=["AOB"],
                    shaded=[{"sector": {"center": "O", "endpoints": ["A", "B"]}}])


@pytest.mark.parametrize("tail", [
    "The region inside circle $O$ but outside sector $AOB$ is shaded. Find its area.",
    "Everything except sector $AOB$ is shaded. Find the shaded area.",
    "All but sector $AOB$ is shaded. Find the shaded area.",
    "Find the shaded area if everything except sector $AOB$ is shaded.",
])
def test_complement_shading_is_never_the_named_region(tail: str) -> None:
    text = r"Points $A$ and $B$ lie on circle $O$ and $m\angle AOB = 90^\circ$. " + tail
    assert coverage_gaps(text, CIRCLE_FACTS)  # no fact says it: the reading fails closed
    assert any("shading" in m for m in check(SECTOR_SHADED, text, CIRCLE_FACTS))


def test_the_named_region_shaded_still_passes() -> None:
    text = r"Points $A$ and $B$ lie on circle $O$ and $m\angle AOB = 90^\circ$. Sector $AOB$ is shaded."
    assert check(SECTOR_SHADED, text, CIRCLE_FACTS) == []


# ── 5. An unnamed shape's length roles ────────────────────────────────

LEGS = "A right triangle has legs of length 3 and 4. Find the length of its hypotenuse."
LEG_FACTS = FigureFacts(givens=[
    F("right_triangle", [], quote="A right triangle"),
    F("equal_length", [], value=3, quote="legs of length 3"),
    F("equal_length", [], value=4, quote="legs of length 3 and 4")])


def test_a_leg_label_on_the_hypotenuse_is_caught() -> None:
    k = 1.5
    good = fig(points={"_a": (0, 0), "_b": (4 * k, 0), "_c": (0, 3 * k)}, segments=["_a_b", "_b_c", "_c_a"],
               right_angles=["_b_a_c"], side_labels={"_a_b": "4", "_c_a": "3"})
    wrong = fig(points={"_a": (0, 0), "_b": (math.sqrt(7) * k, 0), "_c": (0, 3 * k)},
                segments=["_a_b", "_b_c", "_c_a"], right_angles=["_b_a_c"], side_labels={"_b_c": "4", "_c_a": "3"})
    assert coverage_gaps(LEGS, LEG_FACTS) == [] and unverifiable(LEG_FACTS) == []
    assert check(good, LEGS, LEG_FACTS, final_answer="5") == []
    assert check(wrong, LEGS, LEG_FACTS, final_answer="5")


def test_a_length_role_code_cant_place_fails_closed() -> None:
    facts = FigureFacts(givens=[F("equal_length", [], value=5, quote="a base of length 5")])
    assert unverifiable(facts)
    # "a side of 5" is any side: a label on some side says it.
    assert unverifiable(FigureFacts(givens=[F("equal_length", [], value=5, quote="a side of length 5")])) == []


# ── 6. Every given with a textbook mark is marked ─────────────────────

BISECT = (r"In $\triangle ABC$, $\overline{AB} \cong \overline{BC}$, $\overrightarrow{BD}$ bisects $\angle ABC$, "
          r"and $m\angle A = 40^\circ$. Find $m\angle ABD$.")
BISECT_FACTS = FigureFacts(points=list("ABCD"), triangles=["ABC"], rays=["BD"], givens=[
    F("congruent_segments", ["AB", "BC"], quote="AB ≅ BC"), F("bisects_angle", ["BD", "ABC"], quote="BD bisects ∠ABC"),
    F("angle_measure", ["A"], value=40, quote="m∠A = 40°")], find=[Target(kind="angle", item="ABD")])
_ISO: dict[str, Any] = {"points": {"A": P(140, 6), "B": (0, 0), "C": P(40, 6), "D": P(90, 3)},
                        "segments": ["AB", "BC", "CA"], "rays": ["BD"], "tick_groups": [["AB", "BC"]]}


def test_an_unmarked_given_is_refused() -> None:
    issues = check(fig(**_ISO), BISECT, BISECT_FACTS)
    assert any(m.startswith("not marked: the given BD bisects") for m in issues)
    assert any(m.startswith("not marked: the given m∠A = 40°") for m in issues)
    marked = fig(**_ISO, arc_groups=[["ABD", "DBC"]], angle_labels={"BAC": "40°"})
    assert check(marked, BISECT, BISECT_FACTS) == []


def test_marks_not_required_where_a_textbook_has_none() -> None:
    # A measure given as algebra, a numbered angle's measure, a shared side.
    text = r"$\angle 1$ and $\angle 2$ form a linear pair, $m\angle 1 = 63^\circ$ and $m\angle ABD = (2x)^\circ$."
    f = fig(points={"A": (0, 0), "B": (3, 0), "C": (6, 0), "D": (4, 3)}, segments=["AC", "BD"],
            angle_labels={"DBC": "1", "ABD": "2"})
    facts = FigureFacts(points=list("ABCD"), givens=[
        F("angle_measure", ["1"], value=63, quote="m∠1 = 63°"),
        F("angle_measure", ["ABD"], expr="2x", value=117, quote="m∠ABD = (2x)°"),
        F("congruent_segments", ["AB", "AB"], quote="AB ≅ AB")])
    assert unmarked_givens(f, text, facts)[0] == []


def test_a_measure_given_as_algebra_needs_no_label() -> None:
    text = r"$m\angle ABD = (2x)^\circ$, where $2x = 40$."
    f = fig(points={"A": (0, 0), "B": (3, 0), "D": (5, 2)}, segments=["AB", "BD"])
    facts = FigureFacts(points=list("ABD"), givens=[
        F("angle_measure", ["ABD"], expr="2x", value=140, quote="m∠ABD = (2x)°")])
    assert unmarked_givens(f, text.replace("40", "140"), facts)[0] == []


def test_parallel_arrows_on_named_lines_mark_a_segment_given() -> None:
    text = r"Given: $\overleftrightarrow{AB} \parallel \overleftrightarrow{CD}$."
    facts = FigureFacts(points=list("ABCD"), givens=[F("parallel", ["AB", "CD"], quote="AB ∥ CD")])
    spec: dict[str, Any] = {"points": {"A": (0, 2), "B": (6, 2), "C": (0, 0), "D": (6, 0)},
                            "lines": [{"name": "AB", "through": ["A", "B"]}, {"name": "CD", "through": ["C", "D"]}]}
    assert unmarked_givens(fig(**spec), text, facts)[0] == ["AB ∥ CD"]
    marked = fig(**spec, parallel_groups=[["AB", "CD"]])
    assert unmarked_givens(marked, text, facts)[0] == []
    assert check(marked, text, facts) == []
    assert unbacked_marks(marked, text, facts) == {}  # the arrows are backed, so kept
    # A line named by its own two points isn't labelled twice.
    assert ">AB<" not in render_construction(marked).replace(" ", "")


# ── 7. The reply says when a diagram goes ─────────────────────────────

def test_the_reply_says_accepting_removes_the_diagram() -> None:
    import api.core.question_bank_chat as qc

    item = SimpleNamespace(question=r"In $\triangle ABC$, $AB = 5$. Find $m\angle A$.", figure_svg="<svg/>",
                           figure_spec={"type": "geometry", "shape": "construction"}, final_answer="40°",
                           solution_steps=[{"title": "s", "description": "d", "figure_svg": "<svg/>"}])
    prop = {"question": r"In $\triangle ABC$, $AB = 7$. Find $m\angle A$.", "solution_steps": [{"title": "s"}],
            "final_answer": None, "figure_spec": None, "figure_svg": None}
    reply = qc._construction_reply("Sure, I changed AB to 7.", prop, item, "make AB 7", prop["question"],
                                   top_construction=False, top_issues=[], step_drops={}, touches_figure=False)
    assert "Accepting this removes the current diagram" in reply
    assert "removes the diagram on step 1" in reply
    failed = qc._construction_reply("Sure.", dict(prop), item, "make AB 7 and redraw", prop["question"],
                                    top_construction=True, top_issues=["the given AB = 7 is not true"],
                                    step_drops={}, touches_figure=True)
    assert "didn't pass its check" in failed


# ── 8. Decimals and abbreviations don't split clauses ─────────────────

@pytest.mark.parametrize("text", [
    r"In $\triangle ABC$, $AB = 2.5$ and $AC = 2.5$. Find $m\angle A$.",
    r"In $\triangle ABC$, $m\angle B = 37.5^\circ$. Find $m\angle A$.",
])
def test_a_decimal_point_is_not_a_clause_end(text: str) -> None:
    t = _clean(text)
    assert not any(t[a:b].strip() in ("5", "5°") or t[a:b].strip().startswith("5 ") for a, b in _clauses(t))


def test_after_an_abbreviation_a_statement_is_still_covered() -> None:
    text = r"In $\triangle ABC$, $AB = 5$, e.g. $BC$ is longer than $AC$."
    facts = T(givens=[F("equal_length", ["AB"], value=5, quote="AB = 5")])
    assert any("BC is longer than AC" in g for g in coverage_gaps(text, facts))


# ── 9. What a quote accounts for ──────────────────────────────────────

LONGEST = r"In $\triangle ABC$, $AB = 5$ and $BC$ is the longest side. Find $m\angle A$."


def test_a_quote_over_two_clauses_does_not_cover_the_other() -> None:
    facts = T(givens=[F("equal_length", ["AB"], value=5, quote="AB = 5 and BC is the longest side")])
    assert any("BC is the longest side" in g for g in coverage_gaps(LONGEST, facts))


def test_a_name_only_quote_covers_nothing() -> None:
    facts = T(givens=[F("equal_length", ["AB"], value=5, quote="AB = 5"),
                      F("equal_length", ["AB"], value=5, quote="BC")])
    assert any("BC is the longest side" in g for g in coverage_gaps(LONGEST, facts))


@pytest.mark.parametrize(("text", "givens"), [
    (r"In isosceles $\triangle ABC$, $AB = AC$. Find $m\angle B$.",
     [F("isosceles", ["ABC"], point="A", quote="isosceles △ABC, AB = AC"),
      F("congruent_segments", ["AB", "AC"], quote="AB = AC")]),
    (r"Given: $\overleftrightarrow{AB} \parallel \overleftrightarrow{CD}$, with transversal "
     r"$\overleftrightarrow{EF}$ cutting both lines at points $G$ and $H$ respectively.",
     [F("parallel", ["AB", "CD"], quote="AB ∥ CD"),
      F("transversal", ["EF", "AB", "CD"],
        quote="with transversal EF cutting both lines at points G and H respectively"),
      F("intersect", ["EF", "AB"], point="G", quote="cutting both lines at points G and H respectively"),
      F("intersect", ["EF", "CD"], point="H", quote="cutting both lines at points G and H respectively")]),
    (r"Given: $\overline{PQ}$ is the perpendicular bisector of $\overline{AB}$, meeting $\overline{AB}$ at "
     r"point $M$.",
     [F("perpendicular", ["PQ", "AB"], point="M",
        quote="PQ is the perpendicular bisector of AB, meeting AB at point M"),
      F("bisects_segment", ["PQ", "AB"], point="M",
        quote="PQ is the perpendicular bisector of AB, meeting AB at point M")]),
])
def test_a_quote_over_clauses_of_its_own_points_covers_them(text: str, givens: list[Fact]) -> None:
    pts = sorted({c for g in givens for x in [*g.items, g.point or ""] for c in x if c.isupper()})
    facts = FigureFacts(points=pts, givens=givens)
    assert coverage_gaps(text, facts) == []


def test_a_list_of_names_is_one_clause() -> None:
    t = _clean(r"In the figure below, $\overrightarrow{OA}$, $\overrightarrow{OB}$, and $\overrightarrow{OD}$ "
               r"all share endpoint $O$.")
    assert any("OA" in t[a:b] and "OD" in t[a:b] and "share" in t[a:b] for a, b in _clauses(t))
    t = _clean(r"(a) Explain why $\angle ADE$ and $\angle ABC$ are congruent, and state the theorem.")
    assert any("ADE" in t[a:b] and "congruent" in t[a:b] for a, b in _clauses(t))


# ── The adversarial eval: a wrong figure is caught for what is wrong ──

def test_a_wrong_figure_caught_only_as_unmarked_is_listed() -> None:
    from tests.harness.probes import construction_adversarial as ca

    row = {"error": "", "reading": [], "good": [], "bad_caught": True, "bad_fixed_by_removing_marks": False}
    results = [{**row, "id": "only-marks", "bad": ["not marked: the given AB ∥ CD (mark it as a textbook does)"]},
               {**row, "id": "geometry", "bad": ["not marked: the given AB ∥ CD", "the given AB ∥ CD is not true"]}]
    assert ca.summarize(results)["wrong_caught_only_as_unmarked"] == ["only-marks"]
