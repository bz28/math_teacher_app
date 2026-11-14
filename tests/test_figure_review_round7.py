"""Review round 7 of PR #989: special rules derive their facts from the words.

The cold reviewer at ab2eb303 showed six false passes. Each came from a
rule that credited the problem's words to whatever fact in the reading
"looked related": any isosceles triangle for "each base angle", the
reading's own order for "respectively", the nearest name for the subject
of "intersects", any angle at P for "the exterior angle at P", and method
phrases ("using properties of parallel lines") that assert a relation.

The rule now (coverage.py, "Derived facts"): a special wording is
accounted for only when code parses exactly those words with a fixed
grammar, derives the fact(s) they state, and finds each derived fact in
the agreed reading (canonical form). Anything the grammar doesn't parse,
or that fits more than one part, is a gap. Method names are accounted for
only from a reviewed list of names that assert nothing about the figure.

Each reviewer script is pinned below (its wrong figure is refused), with
the correct reading of the same words still accounted for.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import (
    Fact,
    FigureFacts,
    Target,
    coverage_gaps,
    grounded,
    merged,
    standard_reading,
    unverifiable,
    without_other,
)
from api.core.geometry.figure_check import check_construction


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def gaps(text: str, facts: FigureFacts) -> list[str]:
    return coverage_gaps(text, without_other(standard_reading(grounded(facts, text))))


def passes(text: str, facts: FigureFacts, figure: ConstructionFigure) -> bool:
    """The pipeline with both readings equal: standard form, coverage,
    verifiers, then the drawing check."""
    a = without_other(standard_reading(grounded(facts, text)))
    if coverage_gaps(text, a):
        return False
    m = merged(a, a)
    return not unverifiable(m) and not check_construction(figure, text, facts=m)


def _iso(apex: str, b1: str, b2: str, ox: float, base_angle: float) -> dict[str, tuple[float, float]]:
    h = 2 * math.tan(math.radians(base_angle))
    return {b1: (ox, 0), b2: (ox + 4, 0), apex: (ox + 2, h)}


TWO_ISO = [F("isosceles", ["ABC"], point="A", quote="Isosceles △ABC has AB = AC"),
           F("isosceles", ["DEF"], point="D", quote="isosceles △DEF has DE = DF")]
# DEF's base angles are 70°, not 50°; ABC's are 50°.
TWO_ISO_WRONG = fig(points={**_iso("A", "B", "C", 0, 50), **_iso("D", "E", "F", 6, 70)},
                    segments=["AB", "BC", "CA", "DE", "EF", "FD"], tick_groups=[["AB", "AC"], ["DE", "DF"]],
                    angle_labels={"ABC": "50°", "ACB": "50°"})


def _two_iso(text_q: str, vs: str) -> FigureFacts:
    return FigureFacts(points=list("ABCDEF"), triangles=["ABC", "DEF"], find=[Target(kind="angle", item="D")],
                       givens=[*TWO_ISO, *[F("angle_measure", [v], value=50, quote=text_q) for v in vs]])


def test_each_base_angle_of_a_named_triangle_is_that_triangles() -> None:
    """t_base_wrong_tri: "Each base angle of △DEF measures 50°" read as ∠B
    and ∠C (△ABC's) passed a figure where DEF's base angles are 70°."""
    text = (r"Isosceles $\triangle ABC$ has $AB = AC$ and isosceles $\triangle DEF$ has $DE = DF$. "
            r"Each base angle of $\triangle DEF$ measures $50^\circ$. Find $m\angle D$.")
    q = "Each base angle of △DEF measures 50°"
    assert not passes(text, _two_iso(q, "BC"), TWO_ISO_WRONG)
    assert gaps(text, _two_iso(q, "BC")) != []
    assert gaps(text, _two_iso(q, "EF")) == []  # DEF's base angles: accounted for (and checked: refused)
    assert not passes(text, _two_iso(q, "EF"), TWO_ISO_WRONG)
    assert gaps(text, _two_iso(q, "E")) != []  # one of the two only


def test_each_base_angle_with_two_isosceles_triangles_and_none_named_is_a_gap() -> None:
    """t_base_two: with two isosceles triangles, "each base angle" names no
    triangle, so no reading of it is exact."""
    text = (r"Isosceles $\triangle ABC$ has $AB = AC$ and isosceles $\triangle DEF$ has $DE = DF$. "
            r"Each base angle measures $50^\circ$. Find $m\angle D$.")
    q = "Each base angle measures 50°"
    for vs in ("BC", "EF", "BCEF"):
        assert gaps(text, _two_iso(q, vs)) != [], vs
    assert not passes(text, _two_iso(q, "BC"), TWO_ISO_WRONG)


def test_the_base_triangle_comes_from_its_stated_equal_legs() -> None:
    """The base vertices are derived from the equal legs the reading states,
    not from the reading's own apex."""
    text = r"In $\triangle ABC$, $AB = AC$. Each base angle measures $50^\circ$. Find $m\angle A$."
    q = "Each base angle measures 50°"
    legs = F("congruent_segments", ["AB", "AC"], quote="AB = AC")

    def facts(vs: str) -> FigureFacts:
        return FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="A")],
                           givens=[legs, *[F("angle_measure", [v], value=50, quote=q) for v in vs]])
    assert gaps(text, facts("BC")) == []
    assert gaps(text, facts("AB")) != []


RESP_TEXT = (r"$\overleftrightarrow{AB} \parallel \overleftrightarrow{CD}$, with transversal "
             r"$\overleftrightarrow{EF}$ cutting both lines at points $G$ and $H$ respectively.")
RESP_Q = "cutting both lines at points G and H respectively"


def _resp(order: list[str], gl: str, hl: str) -> FigureFacts:
    return FigureFacts(points=list("ABCDEFGH"), lines=["AB", "CD", "EF"], givens=[
        F("parallel", ["AB", "CD"], quote="↔AB ∥ ↔CD"),
        F("transversal", ["EF", *order], quote="transversal ↔EF cutting both lines"),
        F("intersect", ["EF", gl], point="G", quote=RESP_Q), F("intersect", ["EF", hl], point="H", quote=RESP_Q)])


def test_respectively_follows_the_order_the_text_names_the_lines() -> None:
    """t_respectively: with the transversal's lines written CD, AB in the
    reading, G on CD and H on AB passed. The lines are taken in the text's
    order (AB, then CD), whatever order the reading uses."""
    wrong = fig(points={"A": (0, 0), "B": (6, 0), "C": (0, 3), "D": (6, 3), "E": (1, -1), "F": (4, 4),
                        "G": (3.4, 3), "H": (1.6, 0)},
                lines=[{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}],
                parallel_groups=[["AB", "CD"]])
    assert not passes(RESP_TEXT, _resp(["CD", "AB"], "CD", "AB"), wrong)
    assert gaps(RESP_TEXT, _resp(["CD", "AB"], "CD", "AB")) != []
    assert gaps(RESP_TEXT, _resp(["AB", "CD"], "CD", "AB")) != []
    assert gaps(RESP_TEXT, _resp(["CD", "AB"], "AB", "CD")) == []  # right points, any order in the reading


INT_TEXT = (r"In $\triangle PQR$, ray $QT$ bisects $\angle PQR$, with $QS = 5$, and intersects $\overline{PR}$ "
            r"at point $S$. Find $PS$.")


def _int_facts(*extra: Fact) -> FigureFacts:
    return FigureFacts(points=list("PQRST"), triangles=["PQR"], rays=["QT"], segments=["QS"],
                       find=[Target(kind="segment", item="PS")], givens=[
        F("bisects_angle", ["QT", "PQR"], quote="ray QT bisects ∠PQR"),
        F("equal_length", ["QS"], value=5, quote="QS = 5"),
        F("on_segment", ["PR"], point="S", quote="intersects PR at point S"), *extra])


def test_the_subject_of_intersects_is_the_clauses_subject() -> None:
    """t_intersects: "ray QT bisects ∠PQR, with QS = 5, and intersects PR at
    S" took QS (the nearest name holding S) as the subject, so S off ray QT
    passed. The subject is QT: S must be on QT and on PR."""
    q, p, r = (0.0, 0.0), (6.0, 0.0), (0.0, 6.0)
    x = (6 + math.sqrt(36 - 22)) / 2
    s = (x, 6 - x)  # on PR, QS = 5, not on ray QT
    wrong = fig(points={"P": p, "Q": q, "R": r, "S": s, "T": (3, 3)}, segments=["PQ", "QR", "RP", "QS"],
                rays=["QT"], arc_groups=[["PQT", "TQR"]], side_labels={"QS": "5"})
    assert not passes(INT_TEXT, _int_facts(), wrong)
    assert gaps(INT_TEXT, _int_facts()) != []
    on_qt = F("on_line", ["QT"], point="S", quote="intersects PR at point S")
    assert gaps(INT_TEXT, _int_facts(on_qt)) == []
    assert not passes(INT_TEXT, _int_facts(on_qt), wrong)


@pytest.mark.parametrize("text, subject_ok", [
    (r"$\overleftrightarrow{EF}$ intersects $\overleftrightarrow{AB}$ at $G$.", True),
    (r"$\overline{QS}$, the bisector of $\angle PQR$, intersects $\overline{PR}$ at $S$.", True),
    (r"In $\triangle PQR$, ray $QS$ bisects $\angle PQR$ and intersects $\overline{PR}$ at point $S$.", True),
    (r"In $\triangle PQR$ the ray bisects $\angle PQR$ and intersects $\overline{PR}$ at point $S$.", False),
])
def test_the_subject_grammar(text: str, subject_ok: bool) -> None:
    from api.core.geometry import coverage as cv

    toks = cv.tokens(text, set("ABEFGPQRS"))
    at = next(n for n, k in enumerate(toks) if k.norm == "intersects")
    subject = cv._subject_of(toks, at)
    assert (subject is not None) == subject_ok, subject
    if subject is not None:
        assert subject.norm in ("EF", "QS")


EXT_TEXT = (r"In $\triangle PQR$, an exterior angle is formed at vertex $P$ by extending side $\overline{RP}$ beyond "
            r"$P$ to point $T$. The exterior angle at $P$ measures $110^\circ$. Find $m\angle Q$.")


def _ext(items: list[str]) -> FigureFacts:
    return FigureFacts(points=list("PQRT"), triangles=["PQR"], find=[Target(kind="angle", item="Q")], givens=[
        F("extension", ["RP"], point="T", quote="extending side RP beyond P to point T"),
        F("angle_measure", items, value=110, quote="The exterior angle at P measures 110°")])


def test_the_exterior_angle_at_p_is_the_one_its_extension_makes() -> None:
    """t_exterior: "the exterior angle at P measures 110°" read as the
    interior ∠QPR = 110° passed. The angle is derived: between the stated
    extension PT and the triangle's other side at P, ∠QPT."""
    p, r = (0.0, 0.0), (-5.0, 0.0)
    q = (4 * math.cos(math.radians(70)), 4 * math.sin(math.radians(70)))
    wrong = fig(points={"P": p, "Q": q, "R": r, "T": (3, 0)}, segments=["PQ", "QR", "RP", "PT"],
                angle_labels={"QPR": "110°"})  # interior 110°: the exterior is 70°
    for items in (["P"], ["QPR"]):
        assert not passes(EXT_TEXT, _ext(items), wrong), items
        assert gaps(EXT_TEXT, _ext(items)) != [], items
    assert gaps(EXT_TEXT, _ext(["QPT"])) == []
    assert not passes(EXT_TEXT, _ext(["QPT"]), wrong)


def test_using_properties_of_parallel_lines_asserts_parallel_lines() -> None:
    """t_props_parallel2: "Using properties of parallel lines" was a method
    list, so AB not parallel to CD passed."""
    text = (r"$\overleftrightarrow{EF}$ intersects $\overleftrightarrow{AB}$ at $G$ and "
            r"$\overleftrightarrow{CD}$ at $H$, and $m\angle AGH = 70^\circ$. Using properties of parallel lines, "
            r"find $m\angle GHD$.")
    facts = FigureFacts(points=list("ABCDEFGH"), lines=["AB", "CD", "EF"], find=[Target(kind="angle", item="GHD")],
                        givens=[F("intersect", ["EF", "AB"], point="G", quote="↔EF intersects ↔AB at G"),
                                F("intersect", ["EF", "CD"], point="H", quote="↔CD at H"),
                                F("angle_measure", ["AGH"], value=70, quote="m∠AGH = 70°")])
    g = (0.0, 0.0)
    a = math.radians(70)
    h = (2 * math.cos(a), 2 * math.sin(a))
    wrong = fig(points={"A": (3, 0), "B": (-3, 0), "C": (h[0] - 3, h[1] - 1.2), "D": (h[0] + 3, h[1] + 1.2),
                        "E": (-h[0], -h[1]), "F": (2 * h[0], 2 * h[1]), "G": g, "H": h},
                lines=[{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}],
                angle_labels={"AGH": "70°"})
    assert not passes(text, facts, wrong)
    assert any("parallel" in x for x in gaps(text, facts))


def test_the_arc_in_a_question_needs_one_circle_through_both_ends() -> None:
    text = r"Points $A$ and $B$ lie on circles $O$ and $P$. Find the length of arc $AB$."
    on = [F("on_circle", ["A", "B"], circle="O", quote="Points A and B lie on circles O and P"),
          F("on_circle", ["A", "B"], circle="P", quote="Points A and B lie on circles O and P")]
    facts = FigureFacts(points=list("ABOP"), circles=["O", "P"], givens=on)
    assert any("arc" in x for x in gaps(text, facts))  # which circle's arc: not exact


def test_each_acute_angle_in_a_question_needs_the_one_triangle_to_be_right() -> None:
    text = (r"In $\triangle ABC$ and $\triangle DEF$, $\angle C$ is a right angle. "
            r"Find the measure of each acute angle.")
    facts = FigureFacts(points=list("ABCDEF"), triangles=["ABC", "DEF"],
                        givens=[F("right_angle", ["C"], quote="∠C is a right angle")])
    assert any("acute" in x for x in gaps(text, facts))


def test_the_altitude_is_to_the_side_opposite_in_the_one_triangle_holding_it() -> None:
    text = r"In $\triangle ABC$ and $\triangle ACE$, altitude $\overline{AD}$ is perpendicular to $\overline{BC}$."
    facts = FigureFacts(points=list("ABCDE"), triangles=["ABC", "ACE"],
                        givens=[F("perpendicular", ["AD", "BC"], point="D", quote="AD is perpendicular to BC")])
    assert any("altitude" in x for x in gaps(text, facts))  # A is a corner of both triangles


def test_an_extension_accounts_for_the_end_it_is_extended_past() -> None:
    text = r"In $\triangle PQR$, side $\overline{RP}$ is extended beyond $P$ to point $T$."
    ok = FigureFacts(points=list("PQRT"), triangles=["PQR"],
                     givens=[F("extension", ["RP"], point="T", quote="RP is extended beyond P to point T")])
    assert gaps(text, ok) == []
    wrong = FigureFacts(points=list("PQRT"), triangles=["PQR"],
                        givens=[F("extension", ["PR"], point="T", quote="RP is extended beyond P to point T")])
    assert gaps(text, wrong) != []  # read the other way: past R


def test_each_base_angle_of_an_equilateral_triangle_names_no_two_angles() -> None:
    text = r"In $\triangle ABC$, $AB = BC = CA$. Each base angle measures $60^\circ$. Find $x$."
    q = "Each base angle measures 60°"
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="x")], givens=[
        F("congruent_segments", ["AB", "BC", "CA"], quote="AB = BC = CA"),
        F("angle_measure", ["B"], value=60, quote=q), F("angle_measure", ["C"], value=60, quote=q)])
    assert gaps(text, facts) != []  # every side is a leg: no one apex


def test_a_named_triangle_must_be_a_listed_one() -> None:
    text = r"In $\triangle ABC$, $DE = DF$. Each base angle of $\triangle DEF$ measures $50^\circ$. Find $x$."
    q = "Each base angle of △DEF measures 50°"
    facts = FigureFacts(points=list("ABCDEF"), triangles=["ABC"], find=[Target(kind="other", item="x")], givens=[
        F("congruent_segments", ["DE", "DF"], quote="DE = DF"),
        F("angle_measure", ["DEF"], value=50, quote=q), F("angle_measure", ["DFE"], value=50, quote=q)])
    assert gaps(text, facts) != []


def test_one_acute_angle_with_two_triangles_names_no_angle() -> None:
    text = (r"In right $\triangle ABC$ with the right angle at $C$, and $\triangle DEF$, one acute angle measures "
            r"$30^\circ$ and the other measures $60^\circ$. Find $x$.")
    facts = FigureFacts(points=list("ABCDEF"), triangles=["ABC", "DEF"], find=[Target(kind="other", item="x")],
                        givens=[F("right_triangle", ["ABC"], point="C", quote="right △ABC with the right angle at C"),
                                F("angle_measure", ["A"], value=30, quote="one acute angle measures 30°"),
                                F("angle_measure", ["B"], value=60, quote="the other measures 60°")])
    assert gaps(text, facts) != []  # DEF's acute angles too


def test_an_exterior_angle_formed_by_an_extension_needs_that_extension() -> None:
    text = (r"In $\triangle PQR$, an exterior angle is formed at vertex $P$ by extending side $\overline{RP}$ beyond "
            r"$P$ to point $T$.")
    without = FigureFacts(points=list("PQRT"), triangles=["PQR"], givens=[])
    assert gaps(text, without) != []
    with_ = FigureFacts(points=list("PQRT"), triangles=["PQR"], givens=[
        F("extension", ["RP"], point="T", quote="extending side RP beyond P to point T")])
    assert gaps(text, with_) == []
