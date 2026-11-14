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
    described_in_words,
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
TR = {"A": (0, 0), "B": (8, 0), "C": (0, 4), "D": (8, 4), "E": (2, -2), "F": (6, 6), "G": (3, 0), "H": (5, 4)}
TR_SWAPPED = {**TR, "C": (8, 4), "D": (0, 4)}  # each angle at H moves to the other side of EF
TR_FLIPPED = {**TR, "E": (6, 6), "F": (2, -2)}  # EF's ends change places
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
    # Two parallel lines AB (y = 0) and CD (y = 4) cut by EF at G and H:
    # B and D lie on one side of EF, A and C on the other.
    (Fact(kind="alternate_interior", items=["BGH", "CHG"]), {}, _fig(TR), _fig(TR_SWAPPED)),
    (Fact(kind="same_side_interior", items=["BGH", "DHG"]), {}, _fig(TR), _fig(TR_SWAPPED)),
    (Fact(kind="alternate_exterior", items=["BGE", "CHF"]), {}, _fig(TR), _fig(TR_SWAPPED)),
    (Fact(kind="corresponding", items=["BGH", "DHF"]), {}, _fig(TR), _fig(TR_SWAPPED)),
    # The same angles named by the far ends of EF: swapping E and F turns them from interior to exterior.
    (Fact(kind="alternate_interior", items=["BGF", "CHE"]), {}, _fig(TR), _fig(TR_FLIPPED)),
    (Fact(kind="alternate_exterior", items=["BGE", "CHF"]), {}, _fig(TR), _fig(TR_FLIPPED)),
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

    from api.core.geometry.facts import CODE_KINDS, FactKind

    tested = {c[0].kind for c in CASES} | {"equal_length"}  # below: lengths are checked in proportion
    assert set(get_args(FactKind)) - tested - set(CODE_KINDS) == {"other"}
    # Code's own kinds (never read by a model) are checked in
    # tests/test_figure_review_round3.py.


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
    assert coverage_gaps(text, wrong) == ["“∥” (about A, B, C, D)"]


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


# ── Readings that disagreed in the eval and say the same thing ─────────


def test_a_radius_with_a_value_states_its_length() -> None:
    """Adversarial 'tangent-op': one reading wrote 'radius OA = 3', the
    other also wrote 'OA = 3'. They say the same thing, and the radius's
    value is checked on the drawing as that length is."""
    tangent = Fact(kind="tangent", items=["PA"], point="A", circle="O")
    op = Fact(kind="equal_length", items=["OP"], value=5)
    radius = Fact(kind="radius", items=["OA"], value=3, circle="O")
    a = FigureFacts(points=["P", "A", "O"], circles=["O"], givens=[tangent, radius, op])
    b = a.model_copy(update={"givens": [tangent, radius, Fact(kind="equal_length", items=["OA"], value=3), op]})
    assert disagreements(a, b) == []
    assert disagreements(a, a.model_copy(update={"givens": [tangent, radius.model_copy(update={"value": 4}), op]}))
    circle = [{"center": "O", "radius": 3}]
    right = _fig({"O": (0, 0), "A": (3, 0), "P": (3, 4)}, segments=["OA", "PA", "OP"], circles=circle)
    stretched = _fig({"O": (0, 0), "A": (3, 0), "P": (3, 6)}, segments=["OA", "PA", "OP"], circles=circle)
    text = "PA is tangent to circle O at A. Find PA if radius OA = 3 and OP = 5."
    assert check_construction(right, text, facts=a) == []
    assert any("not in proportion" in i.message for i in check_construction(stretched, text, facts=a))


def test_a_part_asked_for_by_no_name_or_already_named_asks_nothing() -> None:
    """Prod 29be9c15: one reading listed lines p and q as named, the other
    didn't, and one asked for 'the transversal' by no name. The checker
    requires named lines anyway and can't require an unnamed part."""
    base = FigureFacts(named_lines=["p", "q"], givens=[Fact(kind="parallel", items=["p", "q"])])
    lines = [Part(kind="line", item="p"), Part(kind="line", item="q")]
    a = base.model_copy(update={"requested": lines})
    b = base.model_copy(update={"lines": ["p", "q"], "requested": [*lines, Part(kind="line", item="transversal")]})
    c = base.model_copy(update={"requested": [Part(kind="polygon", item="the first rectangle with its diagonal")]})
    assert disagreements(a, b) == []
    assert disagreements(base, c) == []
    # A part asked for by name still counts.
    assert disagreements(base, base.model_copy(update={"requested": [Part(kind="line", item="t")]}))


# ── Where two angles sit around a transversal ──────────────────────────

_SAME_SIDE_TEXT = ("Lines AB and CD are parallel, cut by transversal EF at G and H. ∠1 and ∠2 are same-side "
                   "interior angles, with m∠1 = 63° and m∠2 = (2x + 3)°. Find x.")


def _same_side_reading(*pair: Fact) -> FigureFacts:
    return FigureFacts(points=list("ABCDEFGH"), givens=[
        Fact(kind="parallel", items=["AB", "CD"]), Fact(kind="transversal", items=["EF", "AB", "CD"]),
        Fact(kind="on_line", items=["AB"], point="G"), Fact(kind="on_line", items=["CD"], point="H"),
        Fact(kind="on_line", items=["EF"], point="G"), Fact(kind="on_line", items=["EF"], point="H"),
        Fact(kind="angle_measure", items=["1"], value=63), Fact(kind="angle_measure", items=["2"], expr="2x + 3"),
        *pair,
    ], find=[Target(kind="other", item="x")])


def test_a_transversal_alone_does_not_account_for_where_two_angles_sit() -> None:
    """A reading that leaves out 'same-side interior' let a figure with ∠2 in
    the alternate position pass (∠2 drawn 63°, where the problem makes it
    117°). The words now need their own fact."""
    assert coverage_gaps(_SAME_SIDE_TEXT, _same_side_reading()) != []
    pair = Fact(kind="same_side_interior", items=["1", "2"])
    assert coverage_gaps(_SAME_SIDE_TEXT, _same_side_reading(pair)) == []
    # A theorem's name is a method, not a fact about the figure.
    for text in ("Lines AB ∥ CD. Prove ∠1 ≅ ∠2 by the Alternate Interior Angles Theorem.",
                 "Lines AB ∥ CD. Justify with the corresponding angles postulate.",
                 "Lines AB ∥ CD. Use the Converse of the Same-Side Interior Angles Theorem."):
        assert not [g for g in coverage_gaps(text, FigureFacts(points=list("ABCD"), givens=[
            Fact(kind="parallel", items=["AB", "CD"])])) if "interior" in g or "corresponding" in g], text


def test_the_angles_must_sit_where_the_problem_says() -> None:
    reading = _same_side_reading(Fact(kind="same_side_interior", items=["1", "2"]))
    lines = [{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}]
    right = _fig(TR, lines=lines, angle_labels={"BGH": "1", "DHG": "2"}, parallel_groups=[["AB", "CD"]])
    wrong = _fig(TR, lines=lines, angle_labels={"BGH": "1", "CHG": "2"},  # alternate interior instead
                 parallel_groups=[["AB", "CD"]])
    assert check_construction(right, _SAME_SIDE_TEXT, facts=reading) == []
    issues = check_construction(wrong, _SAME_SIDE_TEXT, facts=reading)
    assert any("∠1 and ∠2 are same-side interior angles" in i.message for i in issues), issues


# ── Circle facts in a problem with no circle ───────────────────────────


def test_a_circle_fact_in_a_problem_with_no_circle_is_set_aside_and_logged() -> None:
    """Prod 6d780084: one reading turned 'share hypotenuse BC' into 'BC is a
    diameter'. The problem names no circle, so that fact is set aside, and
    the stored facts say so."""
    from api.core.geometry.facts import grounded, merged

    text = ("△ABC and △DBC share hypotenuse BC, with right angles at A and D respectively, and AB = DB. "
            "Write a complete congruence statement.")
    common = [Fact(kind="right_triangle", items=["ABC"], point="A"),
              Fact(kind="right_triangle", items=["DBC"], point="D"),
              Fact(kind="congruent_segments", items=["AB", "DB"])]
    a = FigureFacts(points=list("ABCD"), triangles=["ABC", "DBC"], givens=common)
    b = a.model_copy(update={"givens": [*common, Fact(kind="diameter", items=["BC"])]})
    assert disagreements(a, b)
    ga, gb = grounded(a, text), grounded(b, text)
    assert disagreements(ga, gb) == []
    assert gb.dropped == ["set aside from givens: BC is a diameter of the circle (the problem names no circle)"]
    assert merged(ga, gb).dropped == gb.dropped
    # A problem that names a circle keeps its circle facts.
    assert grounded(b, text + " BC is a diameter of the circle.").dropped == []


# ── Reasons the teacher reads ──────────────────────────────────────────


def _stub_readings(monkeypatch: pytest.MonkeyPatch, a: FigureFacts, b: FigureFacts) -> None:
    import api.core.construction_figures as cf

    async def read_once(system: str, *args: Any, **kwargs: Any) -> FigureFacts:
        return a if system == cf._FACTS_SYSTEM_A else b

    monkeypatch.setattr(cf, "_read_once", read_once)


async def _why(text: str) -> tuple[Any, list[str]]:
    import api.core.construction_figures as cf

    return await cf.read_figure_facts(text, mode="t", user_id=None)


@pytest.mark.asyncio
async def test_parts_described_in_words_give_that_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prod 77195d48 / 31f9bf18: both readings hold a fact about parts the
    problem describes ("the acute angle at line m") rather than names."""
    a = FigureFacts(points=["P"], givens=[Fact(kind="other", items=["angle bisector"], quote="the bisector meets n")])
    b = FigureFacts(points=["P"], givens=[Fact(kind="other", items=["θ"], quote="an angle θ with line n")])
    _stub_readings(monkeypatch, a, b)
    facts, why = await _why("The angle bisector of the acute angle at line m meets line n at point P.")
    assert facts is None
    assert why == ["this problem describes the figure in words without naming its points; add point names "
                   "(e.g. 'lines AB and CD meet at E') and I can draw it"]


@pytest.mark.asyncio
async def test_a_disagreement_says_what_about(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prod 29be9c15: one reading said which angles are alternate interior,
    the other left it out."""
    base = FigureFacts(named_lines=["p", "q"], givens=[Fact(kind="parallel", items=["p", "q"])])
    _stub_readings(monkeypatch, base, base.model_copy(update={"givens": [
        *base.givens, Fact(kind="alternate_interior", items=[])]}))
    _f, why = await _why("Lines p and q are parallel. A transversal forms alternate interior angles.")
    assert why == ["two readings of the problem disagree about which angles are alternate interior, "
                   "so the figure can't be checked"]
    _stub_readings(monkeypatch, base, base.model_copy(update={"givens": [
        *base.givens, Fact(kind="alternate_interior", items=["1", "2"])]}))
    _f, why = await _why("Lines p and q are parallel. ∠1 and ∠2 are alternate interior angles.")
    assert why == ["two readings of the problem disagree about whether ∠1 and ∠2 are alternate interior angles, "
                   "so the figure can't be checked"]


@pytest.mark.asyncio
async def test_numbers_that_make_an_impossible_angle_say_so(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prod 05b4947e: the givens solve to ∠JKL = 276°."""
    text = (r"$\overrightarrow{KM}$ bisects $\angle JKL$, and $\overrightarrow{KN}$ bisects $\angle MKL$. "
            r"If $m\angle JKL = 10x - 4$ and $m\angle NKL = 2x + 13$, find $m\angle JKM$.")
    r = FigureFacts(points=list("JKLMN"), rays=["KM", "KN"], givens=[
        Fact(kind="bisects_angle", items=["KM", "JKL"]), Fact(kind="bisects_angle", items=["KN", "MKL"]),
        Fact(kind="angle_measure", items=["JKL"], expr="10x - 4"),
        Fact(kind="angle_measure", items=["NKL"], expr="2x + 13"),
    ], find=[Target(kind="angle", item="JKM")])
    _stub_readings(monkeypatch, r, r)
    facts, why = await _why(text)
    assert facts is None
    assert why == ["the problem's numbers make ∠JKL 276°, more than a straight angle; check the problem for a typo"]


@pytest.mark.asyncio
async def test_a_reading_cannot_write_the_log(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.core.construction_figures as cf

    async def call(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"points": ["A"], "dropped": ["nothing to see"]}

    monkeypatch.setattr(cf, "call_claude_json", call)
    got = await cf._read_once("s", "m", mode="t", user_id=None, generation_job_id=None)
    assert got.dropped == []


# ── A mark showing the statement to prove is removed ───────────────────


def test_a_mark_showing_the_statement_to_prove_is_removed_even_when_the_givens_back_it() -> None:
    """Prod 2f44f46d: ∠ADE = 4x + 8 and ∠ABC = 6x − 12 solve to 48° each,
    which 'backed' arcs on both; but ∠ADE ≅ ∠ABC is what the student must
    explain. The arcs are removed and the figure is shown."""
    from api.core.geometry.figure_check import unbacked_marks

    text = ("In the figure below, DE ∥ BC, where D lies on AB and E lies on AC. The measure of ∠ADE = 4x + 8 "
            "degrees, ∠ABC = 6x − 12 degrees, and ∠DAE = 38 degrees. Explain why ∠ADE and ∠ABC are congruent.")
    reading = FigureFacts(points=list("ABCDE"), segments=["DE", "BC", "AB", "AC"], triangles=["ABC", "ADE"], givens=[
        Fact(kind="parallel", items=["DE", "BC"]), Fact(kind="on_segment", items=["AB"], point="D"),
        Fact(kind="on_segment", items=["AC"], point="E"), Fact(kind="angle_measure", items=["ADE"], expr="4x + 8"),
        Fact(kind="angle_measure", items=["ABC"], expr="6x - 12"), Fact(kind="angle_measure", items=["DAE"], value=38),
    ], prove=[Fact(kind="congruent_angles", items=["ADE", "ABC"])])
    spec = {"points": {"A": (8.671, 9.629), "B": (0.0, 0.0), "C": (8.0, 0.0), "D": (4.336, 4.815), "E": (8.336, 4.815)},
            "segments": ["AB", "AC", "BC", "DE"], "parallel_groups": [["DE", "BC"]],
            "angle_labels": {"ABC": "6x − 12°", "ADE": "4x + 8°", "DAE": "38°"}}
    marked = _fig(spec["points"], **{k: v for k, v in spec.items() if k != "points"}, arc_groups=[["ADE", "ABC"]])
    assert unbacked_marks(marked, text, reading) == {"arc_groups": [0]}
    assert check_construction(_fig(spec["points"], **{k: v for k, v in spec.items() if k != "points"}),
                              text, facts=reading) == []
    # The givens' own marks stay.
    assert "parallel_groups" not in unbacked_marks(marked, text, reading)


def test_the_arms_of_a_named_angle_pair_are_drawn() -> None:
    reading = FigureFacts(points=list("BGHC"), givens=[Fact(kind="alternate_interior", items=["BGH", "CHG"])])
    pts = {k: TR[k] for k in "BGHC"}
    text = "∠BGH and ∠CHG are alternate interior angles."
    assert check_construction(_fig(pts, segments=["GB", "GH", "HC"]), text, facts=reading) == []
    assert check_construction(_fig(pts, segments=["GB", "GH"]), text, facts=reading) != []


@pytest.mark.asyncio
async def test_the_reading_step_sets_circle_facts_aside(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prod 6d780084, through the reading step: the readings agree once the
    made-up diameter is set aside, and the agreed facts carry the note."""
    right = "with right angles at A and D respectively"
    common = [Fact(kind="right_triangle", items=["ABC"], point="A", quote=right),
              Fact(kind="right_triangle", items=["DBC"], point="D", quote=right),
              Fact(kind="congruent_segments", items=["AB", "DB"], quote="AB = DB")]
    a = FigureFacts(points=list("ABCD"), triangles=["ABC", "DBC"], givens=common,
                    prove=[Fact(kind="congruent_triangles", items=["ABC", "DBC"])])
    b = a.model_copy(update={"givens": [*common, Fact(kind="diameter", items=["BC"])]})
    _stub_readings(monkeypatch, a, b)
    facts, why = await _why("△ABC and △DBC share hypotenuse BC, with right angles at A and D respectively, "
                            "and AB = DB. Write a complete congruence statement.")
    assert why == []
    assert facts.dropped == ["set aside from givens: BC is a diameter of the circle (the problem names no circle)"]
    assert all(f.kind != "diameter" for f in facts.givens)
    # Stored as JSON with the figure, the note survives.
    from api.core.geometry.facts import as_facts

    assert as_facts(facts.model_dump()).dropped == facts.dropped


def test_an_angle_number_with_no_angle_named_states_nothing() -> None:
    """Adversarial pair-same-side / pair-alt-exterior: a reading wrote '∠1
    labels ""' or '∠1 labels ∠1'. That names no angle: it must neither
    change what ∠1 means (one reading's 'm∠1 = 63°' read as a bad name)
    nor loop forever."""
    pair = Fact(kind="same_side_interior", items=["1", "2"])
    base = FigureFacts(points=list("ABCD"), givens=[pair, Fact(kind="angle_measure", items=["1"], value=63)])
    for target in ("", "1"):
        noted = base.model_copy(update={"givens": [Fact(kind="numbered_angle", items=["1", target]), *base.givens]})
        assert disagreements(base, noted) == [], target
        assert unverifiable(noted) == [] and described_in_words(noted) == []
    named = base.model_copy(update={"givens": [Fact(kind="numbered_angle", items=["1", "ABC"]), *base.givens]})
    assert disagreements(base, named)  # "∠1 is ∠ABC" does say something


def test_on_says_no_more_than_midpoint_and_a_part_is_congruent_to_itself() -> None:
    """Prod 7ef5c01b: one reading added 'M is on BC' to 'M is the midpoint
    of BC'. Prod 6d780084 / f4ac1109: 'BC ≅ BC' and 'AC ≅ CA' state nothing
    (a part matched with itself makes no pair)."""
    mid = Fact(kind="midpoint", items=["BC"], point="M")
    base = FigureFacts(points=list("ABCDM"), givens=[Fact(kind="parallel", items=["AB", "CD"]), mid])
    on = base.model_copy(update={"givens": [*base.givens, Fact(kind="on_segment", items=["BC"], point="M")]})
    assert disagreements(base, on) == []
    # On another segment it is a fact of its own.
    assert disagreements(base, base.model_copy(update={"givens": [
        *base.givens, Fact(kind="on_segment", items=["AD"], point="M")]}))
    for same in (["AC", "CA"], ["BC", "BC"]):
        assert disagreements(base, base.model_copy(update={"givens": [
            *base.givens, Fact(kind="congruent_segments", items=same)]})) == [], same
    assert disagreements(base, base.model_copy(update={"givens": [
        *base.givens, Fact(kind="congruent_segments", items=["AC", "BD"])]}))


# ── Breadth set (prod problems that are not triangle or parallel proofs) ─


@pytest.mark.asyncio
async def test_points_a_reading_made_up_mean_the_problem_is_unnamed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prod 779c31b5: 'An exterior angle of a triangle measures (11x − 4)°'
    names no points; both readings made up A, B, C, D and agreed on a wrong
    fact (the exterior angle as ∠CBD, a straight angle)."""
    from api.core.geometry.facts import invented_points

    text = ("An exterior angle of a triangle measures (11x - 4)°. The two non-adjacent interior angles "
            "measure (4x + 9)° and (5x + 3)°. Find the value of x.")
    r = FigureFacts(points=list("ABCD"), givens=[Fact(kind="opposite_rays", items=["BC", "BD"]),
                                                 Fact(kind="angle_measure", items=["CBD"], expr="11x - 4")])
    assert invented_points(r, text) == ["A", "B", "C", "D"]
    assert invented_points(r, r"In $\triangle ABC$, $\overrightarrow{BD}$ is opposite $\overrightarrow{BC}$.") == []
    primed = FigureFacts(points=["A", "B", "C", "A'", "B'", "C'"])
    assert invented_points(primed, r"Given: $\triangle ABC \cong \triangle A^{\prime}B^{\prime}C^{\prime}$.") == []
    assert invented_points(primed, "Given: △ABC ≅ △A′B′C′.") == []
    # A reading may write its primes as ′ too.
    assert invented_points(FigureFacts(points=["A′", "B′"]), "$A'B'$") == []
    _stub_readings(monkeypatch, r, r)
    facts, why = await _why(text)
    assert facts is None
    assert why == ["this problem describes the figure in words without naming its points; add point names "
                   "(e.g. 'lines AB and CD meet at E') and I can draw it"]


def test_an_altitude_is_accounted_for_by_its_own_perpendicular() -> None:
    """Prod 97b3010d: 'altitude QS is drawn to hypotenuse PR' was always a
    gap, though the readings state QS ⊥ PR. Only a perpendicular naming QS
    accounts for it."""
    text = ("In right triangle PQR with the right angle at Q, altitude $\\overline{QS}$ is drawn to hypotenuse "
            "$\\overline{PR}$. If PS = 4 and SR = 9, find QS.")
    base = [Fact(kind="right_triangle", items=["PQR"], point="Q"), Fact(kind="on_segment", items=["PR"], point="S")]
    with_alt = FigureFacts(points=list("PQRS"), givens=[*base, Fact(kind="perpendicular", items=["QS", "PR"])])
    other_perp = FigureFacts(points=list("PQRS"), givens=[*base, Fact(kind="perpendicular", items=["PQ", "QR"])])
    assert not [g for g in coverage_gaps(text, with_alt) if "altitude" in g]
    assert [g for g in coverage_gaps(text, other_perp) if "altitude" in g]
    # An altitude with no name has nothing to check against.
    assert [g for g in coverage_gaps("Draw an altitude of the triangle ABC.", FigureFacts(points=list("ABC")))
            if "altitude" in g]
