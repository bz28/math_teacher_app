"""The facts a problem states (api/core/geometry/facts.py): each fact's
check on the drawing, the agreement of the two readings, and the coverage
scan that makes a reading account for everything the text states."""

from __future__ import annotations

import math
from typing import Any

import pytest

from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import (
    Fact,
    FigureFacts,
    Part,
    Target,
    coverage_gaps,
    describe,
    disagreements,
    to_parts,
    to_relations,
    unverifiable,
)
from api.core.geometry.figure_check import _Drawing, _holds, check_construction

S3 = math.sqrt(3)


def _fig(points: dict[str, tuple[float, float]], **kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", "points": points, **kw})


def _holds_on(fact: Fact, fig: ConstructionFigure, **reading: Any) -> bool:
    facts = FigureFacts(givens=[fact], **reading)
    rels = to_relations(fact, facts)
    assert rels, f"{fact.kind} has no check"
    d = _Drawing(fig)
    return all(_holds(r, d) is True for r in rels)


SQ = {"A": (0, 0), "B": (4, 0), "C": (4, 4), "D": (0, 4)}
CIRCLE = [{"center": "O", "radius": 5}]
ON5 = {"O": (0, 0), "A": (5, 0), "B": (-5, 0), "C": (0, 5), "D": (3, 4)}

# (fact, extra reading fields, a figure where it is true, one where it is false)
CASES: list[tuple[Fact, dict[str, Any], ConstructionFigure, ConstructionFigure]] = [
    (Fact(kind="parallel", items=["AB", "DC"]), {},
     _fig(SQ), _fig({**SQ, "D": (0, 5)})),
    (Fact(kind="parallel", items=["m", "n"]), {},
     _fig(SQ, lines=[{"name": "m", "through": ["A", "B"]}, {"name": "n", "through": ["D", "C"]}]),
     _fig({**SQ, "D": (0, 5)}, lines=[{"name": "m", "through": ["A", "B"]}, {"name": "n", "through": ["D", "C"]}])),
    (Fact(kind="perpendicular", items=["AC", "BD"]), {},
     _fig(SQ), _fig({**SQ, "D": (0, 5)})),
    (Fact(kind="congruent_segments", items=["AB", "CD"]), {},
     _fig(SQ), _fig({**SQ, "D": (1, 4)})),
    (Fact(kind="congruent_angles", items=["ABC", "BCD"]), {},
     _fig(SQ), _fig({**SQ, "C": (5, 4)})),
    (Fact(kind="angle_measure", items=["ABC"], value=90), {},
     _fig(SQ), _fig({**SQ, "C": (5, 4)})),
    (Fact(kind="right_angle", items=["DAB"]), {},
     _fig(SQ), _fig({**SQ, "D": (1, 4)})),
    (Fact(kind="midpoint", items=["AB"], point="M"), {},
     _fig({"A": (0, 0), "B": (4, 0), "M": (2, 0)}), _fig({"A": (0, 0), "B": (4, 0), "M": (2.6, 0)})),
    (Fact(kind="on_segment", items=["AB"], point="P"), {},
     _fig({"A": (0, 0), "B": (4, 0), "P": (1, 0)}), _fig({"A": (0, 0), "B": (4, 0), "P": (6, 0)})),
    (Fact(kind="on_line", items=["AB"], point="P"), {},
     _fig({"A": (0, 0), "B": (4, 0), "P": (6, 0)}), _fig({"A": (0, 0), "B": (4, 0), "P": (6, 1)})),
    (Fact(kind="collinear", items=["A", "B", "C"]), {},
     _fig({"A": (0, 0), "B": (2, 1), "C": (4, 2)}), _fig({"A": (0, 0), "B": (2, 1), "C": (4, 3)})),
    (Fact(kind="intersect", items=["AC", "BD"], point="E"), {},
     _fig({**SQ, "E": (2, 2)}), _fig({**SQ, "E": (2, 2.5)})),
    (Fact(kind="bisects_segment", items=["CD", "AB"], point="M"), {},
     _fig({"A": (0, 0), "B": (4, 0), "M": (2, 0), "C": (1, 3), "D": (3, -3)}),
     _fig({"A": (0, 0), "B": (4, 0), "M": (2, 0), "C": (1, 3), "D": (4, -3)})),
    (Fact(kind="bisects_angle", items=["BD", "ABC"]), {},
     _fig({"A": (4, 0), "B": (0, 0), "C": (0, 4), "D": (3, 3)}),
     _fig({"A": (4, 0), "B": (0, 0), "C": (0, 4), "D": (3, 2)})),
    (Fact(kind="opposite_rays", items=["BA", "BC"]), {},
     _fig({"A": (0, 0), "B": (2, 0), "C": (5, 0)}), _fig({"A": (0, 0), "B": (2, 0), "C": (5, 1)})),
    (Fact(kind="vertical_angles", items=["AEB", "CED"]), {},
     _fig({**SQ, "E": (2, 2)}), _fig({**SQ, "C": (4, 5), "E": (2, 2)})),
    (Fact(kind="linear_pair", items=["ABD", "DBC"]), {},
     _fig({"A": (0, 0), "B": (2, 0), "C": (5, 0), "D": (3, 2)}),
     _fig({"A": (0, 0), "B": (2, 0), "C": (5, 1), "D": (3, 2)})),
    (Fact(kind="supplementary", items=["ABD", "DBC"]), {},
     _fig({"A": (0, 0), "B": (2, 0), "C": (5, 0), "D": (3, 2)}),
     _fig({"A": (0, 0), "B": (2, 0), "C": (5, 1), "D": (3, 2)})),
    (Fact(kind="complementary", items=["ABD", "DBC"]), {},
     _fig({"A": (4, 0), "B": (0, 0), "C": (0, 4), "D": (3, 1)}),
     _fig({"A": (4, 0), "B": (0, 0), "C": (-1, 4), "D": (3, 1)})),
    (Fact(kind="congruent_triangles", items=["ABC", "DEF"]), {},
     _fig({"A": (0, 0), "B": (3, 0), "C": (0, 4), "D": (10, 0), "E": (13, 0), "F": (10, 4)}),
     _fig({"A": (0, 0), "B": (3, 0), "C": (0, 4), "D": (10, 0), "E": (13, 0), "F": (10, 5)})),
    (Fact(kind="similar_triangles", items=["ABC", "DEF"]), {},
     _fig({"A": (0, 0), "B": (3, 0), "C": (0, 4), "D": (10, 0), "E": (16, 0), "F": (10, 8)}),
     _fig({"A": (0, 0), "B": (3, 0), "C": (0, 4), "D": (10, 0), "E": (16, 0), "F": (10, 6)})),
    (Fact(kind="isosceles", items=["ABC"], point="A"), {},
     _fig({"A": (2, 3), "B": (0, 0), "C": (4, 0)}), _fig({"A": (2.5, 3), "B": (0, 0), "C": (4, 0)})),
    (Fact(kind="isosceles", items=["ABC"]), {},
     _fig({"A": (0, 0), "B": (4, 0), "C": (4, 4)}), _fig({"A": (0, 0), "B": (4, 0), "C": (5, 3)})),
    (Fact(kind="equilateral", items=["ABC"]), {},
     _fig({"A": (0, 0), "B": (4, 0), "C": (2, 2 * S3)}), _fig({"A": (0, 0), "B": (4, 0), "C": (2, 3)})),
    (Fact(kind="right_triangle", items=["ABC"], point="B"), {},
     _fig({"A": (0, 3), "B": (0, 0), "C": (4, 0)}), _fig({"A": (1, 3), "B": (0, 0), "C": (4, 0)})),
    (Fact(kind="right_triangle", items=["ABC"]), {},
     _fig({"A": (0, 3), "B": (4, 0), "C": (0, 0)}), _fig({"A": (1, 3), "B": (4, 0), "C": (0, 0)})),
    (Fact(kind="parallelogram", items=["ABCD"]), {},
     _fig({"A": (0, 0), "B": (4, 0), "C": (5, 3), "D": (1, 3)}),
     _fig({"A": (0, 0), "B": (4, 0), "C": (5, 3), "D": (0, 3)})),
    (Fact(kind="rectangle", items=["ABCD"]), {},
     _fig({"A": (0, 0), "B": (6, 0), "C": (6, 3), "D": (0, 3)}),
     _fig({"A": (0, 0), "B": (4, 0), "C": (5, 3), "D": (1, 3)})),
    (Fact(kind="square", items=["ABCD"]), {},
     _fig(SQ), _fig({"A": (0, 0), "B": (6, 0), "C": (6, 3), "D": (0, 3)})),
    (Fact(kind="rhombus", items=["ABCD"]), {},
     _fig({"A": (0, 0), "B": (5, 0), "C": (8, 4), "D": (3, 4)}),
     _fig({"A": (0, 0), "B": (6, 0), "C": (6, 3), "D": (0, 3)})),
    (Fact(kind="trapezoid", items=["ABCD"]), {},
     _fig({"A": (0, 0), "B": (6, 0), "C": (4, 3), "D": (1, 3)}),
     _fig({"A": (0, 0), "B": (6, 0), "C": (4, 3), "D": (1, 4)})),
    (Fact(kind="isosceles_trapezoid", items=["ABCD"]), {},
     _fig({"A": (0, 0), "B": (6, 0), "C": (4, 3), "D": (2, 3)}),
     _fig({"A": (0, 0), "B": (6, 0), "C": (4, 3), "D": (1, 3)})),
    (Fact(kind="kite", items=["ABCD"]), {},
     _fig({"A": (0, 3), "B": (-2, 0), "C": (0, -5), "D": (2, 0)}),
     _fig({"A": (0, 3), "B": (-2, 0), "C": (0, -5), "D": (3, 0)})),
    (Fact(kind="on_circle", items=["A", "C"], circle="O"), {},
     _fig(ON5, circles=CIRCLE), _fig({**ON5, "C": (0, 4)}, circles=CIRCLE)),
    (Fact(kind="chord", items=["AD"], circle="O"), {},
     _fig(ON5, circles=CIRCLE), _fig({**ON5, "D": (3, 3)}, circles=CIRCLE)),
    (Fact(kind="diameter", items=["AB"], circle="O"), {},
     _fig(ON5, circles=CIRCLE), _fig({**ON5, "B": (-3, 4)}, circles=CIRCLE)),
    (Fact(kind="radius", items=["OD"], circle="O"), {},
     _fig(ON5, circles=CIRCLE), _fig({**ON5, "D": (3, 3)}, circles=CIRCLE)),
    (Fact(kind="tangent", items=["CP"], circle="O", point="C"), {},
     _fig({**ON5, "P": (4, 5)}, circles=CIRCLE), _fig({**ON5, "P": (4, 6)}, circles=CIRCLE)),
    (Fact(kind="central_angle", items=["AOC"], circle="O", value=90), {},
     _fig(ON5, circles=CIRCLE), _fig({**ON5, "C": (-3, 4)}, circles=CIRCLE)),
    (Fact(kind="inscribed_angle", items=["ADB"], circle="O", value=90), {},
     _fig(ON5, circles=CIRCLE), _fig({**ON5, "D": (2, 3)}, circles=CIRCLE)),
    (Fact(kind="numbered_angle", items=["1", "ABC"]), {},
     _fig(SQ, angle_labels={"ABC": "1"}), _fig(SQ, angle_labels={"BCD": "1"})),
    (Fact(kind="transversal", items=["t", "m", "n"]), {},
     _fig({"A": (0, 0), "B": (6, 0), "C": (0, 3), "D": (6, 3), "E": (1, -1), "F": (4, 5)},
          lines=[{"name": "m", "through": ["A", "B"]}, {"name": "n", "through": ["C", "D"]},
                 {"name": "t", "through": ["E", "F"]}]),
     _fig({"A": (0, 0), "B": (6, 0), "C": (0, 3), "D": (6, 3), "E": (1, -1), "F": (7, -1)},
          lines=[{"name": "m", "through": ["A", "B"]}, {"name": "n", "through": ["C", "D"]},
                 {"name": "t", "through": ["E", "F"]}])),
]


@pytest.mark.parametrize(
    ("fact", "reading", "good", "bad"), CASES, ids=[f"{c[0].kind}-{i}" for i, c in enumerate(CASES)],
)
def test_each_fact_is_checked_on_the_drawing(
    fact: Fact, reading: dict[str, Any], good: ConstructionFigure, bad: ConstructionFigure,
) -> None:
    assert _holds_on(fact, good, **reading), f"{describe(fact)} should hold"
    assert not _holds_on(fact, bad, **reading), f"{describe(fact)} should fail"


def test_every_fact_kind_with_a_check_is_in_the_table() -> None:
    """A kind added to the vocabulary must come with a pass and a fail case."""
    from typing import get_args

    from api.core.geometry.facts import FactKind

    tested = {c[0].kind for c in CASES} | {"equal_length"}  # below: lengths are checked in proportion
    assert set(get_args(FactKind)) - tested == {"other"}


def test_lengths_are_checked_in_proportion() -> None:
    """A figure is drawn to scale, so one length alone says nothing; two
    must be in the stated ratio."""
    reading = FigureFacts(points=["A", "B", "C", "D"], segments=["AB", "AD"], givens=[
        Fact(kind="equal_length", items=["AB"], value=4), Fact(kind="equal_length", items=["AD"], value=2),
    ])
    square = _fig(SQ, segments=["AB", "AD"])
    half = _fig({**SQ, "D": (0, 2)}, segments=["AB", "AD"])
    assert any("not in proportion" in i.message for i in check_construction(square, "", facts=reading))
    assert not any("not in proportion" in i.message for i in check_construction(half, "", facts=reading))


def test_a_measure_given_as_algebra_is_solved_from_the_facts() -> None:
    """m∠ABC = 2x + 10, m∠DEF = 3x − 20, ∠ABC ≅ ∠DEF → both are 70°."""
    facts = FigureFacts(givens=[
        Fact(kind="angle_measure", items=["ABC"], expr="2x + 10"),
        Fact(kind="angle_measure", items=["DEF"], expr="3x - 20"),
        Fact(kind="congruent_angles", items=["ABC", "DEF"]),
    ])
    parts = to_parts(facts, "")
    measures = {(r.args[0], round(r.args[1], 6)) for r in parts.givens if r.kind == "measure"}
    assert measures == {(("A", "B", "C"), 70.0), (("D", "E", "F"), 70.0)}


def test_facts_without_a_check_are_named() -> None:
    reading = FigureFacts(givens=[
        Fact(kind="other", items=["AD"], quote="AD is an altitude"),
        Fact(kind="midpoint", items=["AB"]),  # no point: nothing to check
        Fact(kind="parallel", items=["AB", "CD"]),
    ])
    assert unverifiable(reading) == ["AD is an altitude", "midpoint"]


# ── Agreement ──────────────────────────────────────────────────────────


def _r(*givens: Fact, **kw: Any) -> FigureFacts:
    return FigureFacts(**{"points": ["A", "B", "C", "D", "E", "F"], "givens": list(givens), **kw})


@pytest.mark.parametrize(("a", "b"), [
    (_r(Fact(kind="parallel", items=["AB", "CD"])), _r(Fact(kind="parallel", items=["DC", "BA"]))),
    (_r(Fact(kind="congruent_angles", items=["ABC", "DEF"])), _r(Fact(kind="congruent_angles", items=["FED", "CBA"]))),
    (_r(Fact(kind="congruent_segments", items=["AB", "CD", "EF"])),
     _r(Fact(kind="congruent_segments", items=["AB", "CD"]), Fact(kind="congruent_segments", items=["CD", "EF"]))),
    (_r(Fact(kind="congruent_segments", items=["AB", "CD"]), Fact(kind="congruent_segments", items=["CD", "EF"])),
     _r(Fact(kind="congruent_segments", items=["AB", "CD"]), Fact(kind="congruent_segments", items=["AB", "EF"]))),
    (_r(Fact(kind="congruent_triangles", items=["ABC", "DEF"])),
     _r(Fact(kind="congruent_triangles", items=["BCA", "EFD"]))),
    (_r(Fact(kind="rectangle", items=["ABCD"])), _r(Fact(kind="rectangle", items=["CBAD"]))),
    (_r(Fact(kind="perpendicular", items=["AB", "BC"])), _r(Fact(kind="right_angle", items=["CBA"]))),
    (_r(Fact(kind="angle_measure", items=["ABC"], value=40)),
     _r(Fact(kind="angle_measure", items=["CBA"], value=40.0))),
    (_r(Fact(kind="angle_measure", items=["ABC"], expr="2x + 5")),
     _r(Fact(kind="angle_measure", items=["ABC"], expr="(2x+5)°"))),
    (_r(Fact(kind="isosceles", items=["ABC"], point="A")),
     _r(Fact(kind="congruent_segments", items=["AB", "AC"]))),
])
def test_readings_that_say_the_same_thing_agree(a: FigureFacts, b: FigureFacts) -> None:
    assert disagreements(a, b) == []


@pytest.mark.parametrize(("a", "b"), [
    (_r(Fact(kind="parallel", items=["AB", "CD"])), _r(Fact(kind="parallel", items=["AD", "BC"]))),
    (_r(Fact(kind="congruent_triangles", items=["ABC", "DEF"])),
     _r(Fact(kind="congruent_triangles", items=["ABC", "EDF"]))),  # another correspondence
    (_r(Fact(kind="angle_measure", items=["ABC"], value=40)), _r(Fact(kind="angle_measure", items=["ABC"], value=50))),
    (_r(Fact(kind="midpoint", items=["AB"], point="M")), _r(Fact(kind="midpoint", items=["AC"], point="M"))),
    (_r(Fact(kind="rectangle", items=["ABCD"])), _r(Fact(kind="rectangle", items=["ABDC"]))),
    (_r(Fact(kind="parallel", items=["AB", "CD"])), _r()),
    (_r(), _r(prove=[Fact(kind="parallel", items=["AB", "CD"])])),
    (_r(find=[Target(kind="segment", item="AB")]), _r(find=[Target(kind="segment", item="AC")])),
    (_r(requested=[Part(kind="segment", item="BD")]), _r()),
    (FigureFacts(points=["A", "B"]), FigureFacts(points=["A", "B", "C"])),
])
def test_readings_that_differ_disagree(a: FigureFacts, b: FigureFacts) -> None:
    assert disagreements(a, b) != []
    assert disagreements(b, a) != []


# ── Coverage ───────────────────────────────────────────────────────────

# Each relation word or symbol, in a sentence whose reading leaves it out.
# The reading has the points (so the only gap is the word) and one fact of
# an unrelated kind.
SIGNALS = [
    r"Given $\overline{AB} \parallel \overline{CD}$.", "AB is parallel to CD.",
    r"Given $\overline{AB} \perp \overline{CD}$.", "AB is perpendicular to CD.",
    r"Given $\overline{AB} \cong \overline{CD}$.", "AB and CD are congruent.",
    r"$\triangle ABC \sim \triangle DEF$.", "Triangles ABC and DEF are similar.",
    "M is the midpoint of AB.", "CD bisects AB.", "BD is an angle bisector of angle ABC.",
    "AB is tangent to the circle at B.", "Angle ABC is a right angle.", "ABC is a right triangle.",
    "Triangle ABC is equilateral.", "Triangle ABC is isosceles.", "ABCD is a parallelogram.",
    "ABCD is a rectangle.", "ABCD is a square.", "ABCD is a rhombus.", "ABCD is a trapezoid.",
    "ABCD is a kite.", "AB is a diameter.", "OA is a radius.", "AB is a chord.",
    "Triangle ABC is inscribed in circle O.", "A, B and C are on circle O.",
    "BA and BC are opposite rays.", "Angles 1 and 2 are vertical angles.", "Angles 1 and 2 form a linear pair.",
    "Angles ABC and DEF are supplementary.", "Angles ABC and DEF are complementary.",
    "Line t is a transversal of lines m and n.", "C lies on AB.", "A, B and C are collinear.",
    "AC and BD intersect at E.", "Angles 1 and 2 are alternate interior angles.",
    "AD is an altitude of triangle ABC.", "AD is a median of triangle ABC.",
]


@pytest.mark.parametrize("text", SIGNALS)
def test_a_relation_word_the_reading_leaves_out_is_a_gap(text: str) -> None:
    reading = FigureFacts(
        points=["A", "B", "C", "D", "E", "F", "M", "O"],
        givens=[Fact(kind="equal_length", items=["EF"], value=3)],
    )
    from api.core.geometry.figure_check import parse_problem

    reading.points = sorted(parse_problem(text).points | set(reading.points))
    assert coverage_gaps(text, reading), text


def test_a_relation_the_reading_has_is_no_gap() -> None:
    text = (
        r"Given $\overline{AB} \parallel \overline{CD}$, M is the midpoint of AB. "
        r"Prove $\overline{AD} \cong \overline{BC}$."
    )
    reading = FigureFacts(
        points=["A", "B", "C", "D", "M"],
        givens=[Fact(kind="parallel", items=["AB", "CD"]), Fact(kind="midpoint", items=["AB"], point="M")],
        prove=[Fact(kind="congruent_segments", items=["AD", "BC"])],
    )
    assert coverage_gaps(text, reading) == []
    # A fact of the right kind about other names doesn't account for it
    # (a fact about other names in the same clause is caught by agreement
    # and by the check on the drawing instead).
    wrong = reading.model_copy(update={
        "points": [*reading.points, "E", "F", "G", "H"],
        "givens": [Fact(kind="parallel", items=["EF", "GH"]), Fact(kind="midpoint", items=["AB"], point="M")],
    })
    assert coverage_gaps(text, wrong) == ["“\\parallel” (about A, B, C, D, M)"]


def test_a_point_the_reading_leaves_out_is_a_gap() -> None:
    text = "M is the midpoint of AB and N is on BC."
    reading = FigureFacts(points=["A", "B", "C", "M"], givens=[
        Fact(kind="midpoint", items=["AB"], point="M"), Fact(kind="on_segment", items=["BC"], point="N"),
    ])
    assert coverage_gaps(text, reading) == ["point N"]


def test_a_method_named_is_not_a_fact() -> None:
    """'Use the Perpendicular Bisector Theorem' asks for a method; it states
    nothing about the figure, though it holds the words 'perpendicular' and
    'bisector'."""
    text = ("Given AB ∥ CD. Prove ∠1 ≅ ∠2. Use the Perpendicular Bisector Theorem, "
            "then justify a step by the definition of midpoint.")
    reading = FigureFacts(
        points=["A", "B", "C", "D"],
        givens=[Fact(kind="parallel", items=["AB", "CD"])],
        prove=[Fact(kind="congruent_angles", items=["1", "2"])],
    )
    assert coverage_gaps(text, reading) == []


def test_messages_are_written_by_code_not_quoted() -> None:
    f = Fact(kind="congruent_segments", items=["AB", "CD"], quote="AB is totally the same as CD lol")
    assert describe(f) == "AB ≅ CD"
    fig = _fig({"A": (0, 0), "B": (4, 0), "C": (0, 3), "D": (5, 3)}, segments=["AB", "CD"])
    issues = check_construction(fig, "", facts=FigureFacts(points=["A", "B", "C", "D"], givens=[f]))
    assert any("the given AB ≅ CD is not true" in i.message for i in issues), issues


# ── Readings that say the same thing in other words ────────────────────


@pytest.mark.parametrize(("a", "b"), [
    # Naming a figure is no fact.
    (_r(Fact(kind="other", items=["ABC"], quote="In △ABC"), triangles=["ABC"]), _r(triangles=["ABC"])),
    # "EF meets AB at X" and "X is on EF and on AB".
    (_r(Fact(kind="intersect", items=["EF", "AB"], point="X")),
     _r(Fact(kind="on_segment", items=["EF"], point="X"), Fact(kind="on_segment", items=["AB"], point="X"))),
    # "isosceles" said besides the equal sides that make it so.
    (_r(Fact(kind="isosceles", items=["ABC"]), Fact(kind="congruent_segments", items=["AB", "AC"])),
     _r(Fact(kind="congruent_segments", items=["AB", "AC"]))),
    # ∠1 listed as a point.
    (_r(points=["A", "B", "1"]), _r(points=["A", "B"])),
    # m∠C asked for is ∠C.
    (_r(find=[Target(kind="angle", item="m∠C")], triangles=["ABC"]),
     _r(find=[Target(kind="angle", item="ACB")], triangles=["ABC"])),
    # "Find …" that is no angle or segment checks nothing.
    (_r(find=[Target(kind="other", item="which theorem")]), _r()),
    # "Can you provide the drawing?" read as the sides the problem has.
    (_r(requested=[Part(kind="segment", item="AC")], segments=["AB", "AC"]), _r(segments=["AB", "AC"])),
])
def test_other_words_for_the_same_reading_agree(a: FigureFacts, b: FigureFacts) -> None:
    assert disagreements(a, b) == [] and disagreements(b, a) == []


def test_agreed_readings_keep_both_wordings_checks() -> None:
    from api.core.geometry.facts import merged

    a = _r(Fact(kind="intersect", items=["EF", "AB"], point="X"))
    b = _r(Fact(kind="on_segment", items=["AB"], point="X"), Fact(kind="on_segment", items=["EF"], point="X"))
    kinds = [f.kind for f in merged(a, b).givens]
    assert kinds == ["intersect", "on_segment", "on_segment"]  # a check more, never one fewer


def test_a_shape_asked_for_is_a_polygon() -> None:
    assert Part.model_validate({"kind": "rectangle", "item": "ABCD"}).kind == "polygon"
    with pytest.raises(ValueError):
        Part.model_validate({"kind": "diagram", "item": "x"})


def test_an_unnamed_length_is_shown_by_a_label() -> None:
    reading = FigureFacts(givens=[Fact(kind="rectangle"), Fact(kind="equal_length", value=7),
                                  Fact(kind="equal_length", value=24)])
    rect = {"A": (0, 0), "B": (24, 0), "C": (24, 7), "D": (0, 7)}
    labelled = _fig(rect, segments=["AB", "BC", "CD", "DA"], side_labels={"AB": "24 in.", "BC": "7"})
    bare = _fig(rect, segments=["AB", "BC", "CD", "DA"], side_labels={"AB": "24 in."})
    text = "A rectangle has a width of 7 inches and a length of 24 inches."
    assert check_construction(labelled, text, facts=reading) == []
    assert any("a side of length 7" in i.message for i in check_construction(bare, text, facts=reading))


def test_triangles_named_apart_are_drawn_apart() -> None:
    reading = FigureFacts(points=list("ABCDEF"), triangles=["ABC", "DEF"])
    apart = _fig({"A": (0, 0), "B": (4, 0), "C": (2, 3), "D": (6, 0), "E": (9, 0), "F": (7, 2)},
                 segments=["AB", "BC", "CA", "DE", "EF", "FD"])
    crossing = _fig({"A": (0, 0), "B": (4, 0), "C": (2, 3), "D": (1, -1), "E": (4, -1), "F": (2, 1)},
                    segments=["AB", "BC", "CA", "DE", "EF", "FD"])
    inside = _fig({"A": (0, 0), "B": (8, 0), "C": (4, 6), "D": (3, 1), "E": (5, 1), "F": (4, 2)},
                  segments=["AB", "BC", "CA", "DE", "EF", "FD"])
    assert check_construction(apart, "", facts=reading) == []
    for fig in (crossing, inside):
        assert any("ABC and DEF overlap" in i.message for i in check_construction(fig, "", facts=reading))
