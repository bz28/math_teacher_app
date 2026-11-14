"""Review round 8 of PR #989: the facts code derives are checked, losslessly.

The cold reviewer at 4e952f1c showed five false passes:

1. "QT ⊥ PR and EF ∥ PQ and intersects PR at S" took QT (the first name
   of the sentence) as the subject of "intersects": the subject must come
   from the same clause, and an ambiguous clause is a gap.
2. "EF … intersects PR at S" read as S on the LINE PR (or as an
   intersection of the two lines) passed a drawing with S past R: the
   comparison treated a segment, a ray and a line as one.
3. "ray QT … intersects PR at S" read as S on line QT passed S behind Q.
4. "Using the Corollary to the Triangle Sum Theorem" was accounted for as
   inert, but the corollary is about a right triangle.
5. "altitude CD is perpendicular to AB" read without its foot D passed a
   drawing with D off AB.

The rule now (coverage.py, "Derived facts"; construction_figures.py,
trusted_reading): what code derives from the words, with its exact kind
(on a segment, a ray or a line; a perpendicular with its foot), is ADDED to
the facts the drawing is checked against, whatever the reading says. A
reading that measures the same part otherwise is refused. The canonical
form readings are compared in keeps a segment, a ray and a line apart and
a perpendicular's foot. A method that applies only to some figure counts
only when the reading states that figure.

Each reviewer script is pinned below with its wrong figure refused, and
the right figure for the same words still passing.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from api.core.construction_figures import trusted_reading
from api.core.geometry import coverage as cv
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, Target, standard_reading
from api.core.geometry.figure_check import check_construction


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def trusted(text: str, facts: FigureFacts) -> FigureFacts | None:
    return trusted_reading(text, facts, facts)[0]


def passes(text: str, facts: FigureFacts, figure: ConstructionFigure) -> bool:
    t = trusted(text, facts)
    return t is not None and not check_construction(figure, text, facts=t)


def derived(text: str, facts: FigureFacts) -> list[tuple[Any, ...]]:
    return [(d.kind, tuple(d.items), d.point) for d in cv.coverage(text, standard_reading(facts))[1]]


# ── 1. The subject of "intersects" comes from its own clause ─────────

SUBJ = (r"In $\triangle PQR$, $\overline{QT} \perp \overline{PR}$ and $\overline{EF} \parallel \overline{PQ}$ and "
        r"intersects $\overline{PR}$ at $S$. Find $PS$.")


def _subj_facts(subj: str) -> FigureFacts:
    return FigureFacts(points=list("PQRSTEF"), triangles=["PQR"], segments=["QT", "EF"],
                       find=[Target(kind="segment", item="PS")], givens=[
        F("perpendicular", ["QT", "PR"], quote="QT ⊥ PR"), F("parallel", ["EF", "PQ"], quote="EF ∥ PQ"),
        F("on_segment", ["PR"], point="S", quote="intersects PR at S"),
        F("on_segment", [subj], point="S", quote="intersects PR at S")])


def test_the_subject_of_intersects_is_in_the_same_clause() -> None:
    """Reviewer script subj: S at QT's foot, EF nowhere near S."""
    wrong = fig(points={"P": (0, 0), "R": (6, 0), "Q": (2, 4), "T": (2, -1), "S": (2, 0), "E": (4, 1), "F": (5, 3)},
                segments=["PQ", "QR", "RP", "QT", "EF"], parallel_groups=[["EF", "PQ"]], right_angles=["QSP"])
    assert derived(SUBJ, _subj_facts("QT")) == [("on_segment", ("PR",), "S"), ("on_segment", ("EF",), "S")]
    assert not passes(SUBJ, _subj_facts("QT"), wrong)
    # EF through S (S on PR, EF ∥ PQ) is the figure the words describe.
    right = fig(points={"P": (0, 0), "R": (6, 0), "Q": (2, 4), "T": (2, 0), "S": (3, 0), "E": (2, -2),
                        "F": (4, 2)},
                segments=["PQ", "QR", "RP", "QT", "EF"], parallel_groups=[["EF", "PQ"]], right_angles=["QTP"])
    assert passes(SUBJ, _subj_facts("EF"), right)


@pytest.mark.parametrize("text", [
    # Two names head a verb phrase in the clause: which one intersects is
    # not said exactly.
    r"In $\triangle PQR$, $\overline{QT}$ and $\overline{EF}$ are drawn and intersects $\overline{PR}$ at $S$.",
])
def test_an_ambiguous_subject_is_a_gap(text: str) -> None:
    facts = FigureFacts(points=list("PQRSTEF"), triangles=["PQR"], segments=["QT", "EF"], givens=[
        F("on_segment", ["PR"], point="S", quote="intersects PR at S"),
        F("on_segment", ["EF"], point="S", quote="intersects PR at S")])
    assert cv.coverage(text, standard_reading(facts))[0] != []


# ── 2, 3. A segment, a ray and a line stay distinct ──────────────────

ONLINE = (r"In $\triangle PQR$, $\overline{EF} \parallel \overline{PQ}$ and intersects $\overline{PR}$ at $S$. "
          r"Find $PS$.")
# S on line PR past R (not on segment PR); EF through S parallel to PQ.
PAST_R = fig(points={"P": (0, 0), "R": (4, 0), "Q": (1, 3), "S": (6, 0), "E": (5, -3), "F": (7, 3)},
             segments=["PQ", "QR", "RP", "EF"], parallel_groups=[["EF", "PQ"]])


def _online(*givens: Fact) -> FigureFacts:
    return FigureFacts(points=list("PQRSEF"), triangles=["PQR"], segments=["EF"],
                       find=[Target(kind="segment", item="PS")],
                       givens=[F("parallel", ["EF", "PQ"], quote="EF ∥ PQ"), *givens])


@pytest.mark.parametrize("givens", [
    [F("on_line", ["PR"], point="S", quote="intersects PR at S"),
     F("on_line", ["EF"], point="S", quote="intersects PR at S")],
    [F("intersect", ["EF", "PR"], point="S", quote="intersects PR at S")],
    [F("on_segment", ["PR"], point="S", quote="intersects PR at S"),
     F("on_line", ["EF"], point="S", quote="intersects PR at S")],
])
def test_the_overline_puts_the_point_on_the_segment(givens: list[Fact]) -> None:
    """Reviewer script online: read as S on line PR (or as lines meeting),
    S past R passed. The overline derives S on segment PR."""
    facts = _online(*givens)
    assert ("on_segment", ("PR",), "S") in derived(ONLINE, facts)
    assert not passes(ONLINE, facts, PAST_R)
    inside = fig(points={"P": (0, 0), "R": (4, 0), "Q": (1, 3), "S": (2, 0), "E": (1.5, -1.5), "F": (3, 3)},
                 segments=["PQ", "QR", "RP", "EF"], parallel_groups=[["EF", "PQ"]])
    assert passes(ONLINE, facts, inside)


RAY = (r"In $\triangle PQR$, ray $\overrightarrow{QT} \perp \overline{PQ}$ and intersects $\overline{PR}$ at $S$. "
       r"Find $PS$.")


def test_a_ray_that_intersects_puts_the_point_on_the_ray() -> None:
    """Reviewer script ray: S on line QT behind Q passed."""
    facts = FigureFacts(points=list("PQRST"), triangles=["PQR"], rays=["QT"], find=[Target(kind="segment", item="PS")],
                        givens=[F("perpendicular", ["QT", "PQ"], point="Q", quote="QT ⊥ PQ"),
                                F("on_segment", ["PR"], point="S", quote="intersects PR at S"),
                                F("on_line", ["QT"], point="S", quote="intersects PR at S")])
    assert derived(RAY, facts) == [("on_segment", ("PR",), "S"), ("on_ray", ("QT",), "S")]
    behind = fig(points={"P": (0, 0), "R": (6, 0), "Q": (1, 1), "T": (0, 2), "S": (2, 0)},
                 segments=["PQ", "QR", "RP"], rays=["QT"], right_angles=["PQT"])
    assert not passes(RAY, facts, behind)
    ahead = fig(points={"P": (0, 0), "R": (6, 0), "Q": (1, 1), "T": (1.5, 0.5), "S": (2, 0)},
                segments=["PQ", "QR", "RP"], rays=["QT"], right_angles=["PQT"])
    assert passes(RAY, facts, ahead)


# ── 4. A method about a special figure asserts that figure ───────────

COROLLARY = (r"In $\triangle ABC$, $m\angle B = 35^\circ$. Using the Corollary to the Triangle Sum Theorem, "
             r"find $m\angle A$.")


def test_the_corollary_is_not_inert() -> None:
    """Reviewer script corollary: no right angle anywhere passed."""
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="A")],
                        givens=[F("angle_measure", ["B"], value=35, quote="m∠B = 35°")])
    ab = 4 * math.sin(math.radians(100)) / math.sin(math.radians(45))
    wrong = fig(points={"A": (ab * math.cos(math.radians(35)), ab * math.sin(math.radians(35))), "B": (0, 0),
                        "C": (4, 0)}, segments=["AB", "BC", "CA"], angle_labels={"ABC": "35°"})
    assert any("Corollary" in g for g in cv.coverage(COROLLARY, standard_reading(facts))[0])
    assert not passes(COROLLARY, facts, wrong)
    assert all("Corollary" not in rx for rx, _n, _c in cv.METHOD_NAMES)


@pytest.mark.parametrize("name, needs", [(rx, needs) for rx, needs, _c in cv.METHOD_NAMES])
def test_every_method_name_needs_its_figure_or_none(name: str, needs: str) -> None:
    """Round 8 (D), the audit: each listed method either asserts nothing
    about the figure (reflexive, transitive, substitution, symmetric, the
    definition of congruence) or needs the reading to state its figure."""
    inert = {"reflexive", "transitive", "definitions? of congruen"}
    assert (needs == "") == any(w in name for w in inert), name


# ── 5. An altitude's foot is on the side it is drawn to ──────────────

ALTITUDE = (r"In $\triangle ABC$, altitude $\overline{CD}$ is perpendicular to $\overline{AB}$, $AB = 8$ and $CD = 2$. "
            r"Find the area of $\triangle ABC$.")


@pytest.mark.parametrize("foot", [{}, {"point": "D"}])
def test_an_altitude_has_its_foot(foot: dict[str, str]) -> None:
    """Reviewer script altitude: CD ⊥ AB read without D passed D off AB."""
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["CD"],
                        find=[Target(kind="other", item="area of △ABC")], givens=[
        F("perpendicular", ["CD", "AB"], quote="CD is perpendicular to AB", **foot),
        F("equal_length", ["AB"], value=8, quote="AB = 8"), F("equal_length", ["CD"], value=2, quote="CD = 2")])
    assert derived(ALTITUDE, facts) == [("perpendicular", ("CD", "AB"), "D")]
    off = fig(points={"A": (0, 0), "B": (8, 0), "C": (0, 5), "D": (0, 3)}, segments=["AB", "BC", "CA", "CD"],
              side_labels={"AB": "8", "CD": "2"}, right_angles=["CAB"])
    assert not passes(ALTITUDE, facts, off)
    on = fig(points={"A": (0, 0), "B": (8, 0), "C": (3, 2), "D": (3, 0)}, segments=["AB", "BC", "CA", "CD"],
             side_labels={"AB": "8", "CD": "2"}, right_angles=["CDB"])
    assert passes(ALTITUDE, facts, on)


# ── In-session: an expression is read whole, signs included ──────────

@pytest.mark.parametrize("expr, ok", [("5x-3", True), ("5x+3", False), ("3-5x", False), ("5(x-3)", False),
                                      ("10x/2-3", True)])
def test_an_expression_is_accounted_for_only_as_written(expr: str, ok: bool) -> None:
    """Found in round 8 (in session): "(5x − 3)°" read as 5x + 3 was
    accounted for, number by number, since the signs were any algebra's.
    Now the text's expression is read whole and must equal the fact's."""
    text = r"In $\triangle ABC$, $m\angle B = (5x - 3)^\circ$. Find $x$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="x")],
                        givens=[F("angle_measure", ["B"], expr=expr, quote="m∠B = (5x − 3)°")])
    assert (cv.coverage(text, facts)[0] == []) is ok, expr


@pytest.mark.parametrize("text, expr", [
    (r"$m\angle ABD = \left(2\frac{1}{2}x\right)^\circ$. Find $x$.", "5x/2"),
    (r"$AB = 2(x + 5)$. Find $x$.", "2x+10"),
    (r"$AB = \frac{x}{2} + 1$. Find $x$.", "x/2+1"),
    (r"$AB = (3x + 1)$. Find $x$.", "3x+1"),
])
def test_an_expression_in_other_forms_is_read_whole(text: str, expr: str) -> None:
    kind = "angle_measure" if "angle" in text else "equal_length"
    item = "ABD" if kind == "angle_measure" else "AB"
    quote = "m∠ABD = (2½x)°" if kind == "angle_measure" else text.split("$")[1]
    facts = FigureFacts(points=list("ABD"), find=[Target(kind="other", item="x")],
                        givens=[F(kind, [item], expr=expr, quote=quote)])
    assert cv.coverage(text, facts)[0] == [], text


# ── Each reading is compared with what the words derive ──────────────

FOOT_TEXT = (r"In right triangle $PQR$ with the right angle at $Q$, altitude $\overline{QS}$ is drawn to hypotenuse "
             r"$\overline{PR}$. If $PS = 4$ and $SR = 9$, find $QS$.")


def _foot(point: str | None) -> FigureFacts:
    return FigureFacts(points=list("PQRS"), triangles=["PQR"], find=[Target(kind="segment", item="QS")], givens=[
        F("right_triangle", ["PQR"], point="Q", quote="right triangle PQR with the right angle at Q"),
        F("on_segment", ["PR"], point="S", quote="altitude QS is drawn to hypotenuse PR"),
        F("perpendicular", ["QS", "PR"], point=point, quote="altitude QS is drawn to hypotenuse PR"),
        F("equal_length", ["PS"], value=4, quote="PS = 4"), F("equal_length", ["SR"], value=9, quote="SR = 9")])


def test_a_reading_without_the_foot_the_words_state_agrees_with_one_that_has_it() -> None:
    """Prod 97b3010d / b7b1595b: one reading wrote QS ⊥ PR at S, the other
    QS ⊥ PR. "altitude QS" states the foot, so with the derived facts added
    both say the same; without the altitude wording they still differ."""
    agreed, why = trusted_reading(FOOT_TEXT, _foot("S"), _foot(None))
    assert agreed is not None, why
    plain = FOOT_TEXT.replace("altitude", "segment")
    assert trusted_reading(plain, _foot("S"), _foot(None))[0] is None


def test_a_derived_fact_the_reading_states_is_not_added_twice() -> None:
    """Prod ab10c024: the reading's m∠B = 5x − 3 is the derived m∠ABC = 5x −
    3; adding it again listed every measure twice in the reasons."""
    q = "each base angle measures (5x - 3)°"
    text = r"In isosceles $\triangle ABC$, $AB = AC$. Each base angle measures $(5x - 3)^\circ$. Find $x$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="x")], givens=[
        F("isosceles", ["ABC"], point="A", quote="isosceles △ABC, AB = AC"),
        F("angle_measure", ["B"], expr="5x-3", quote="Each base angle measures (5x - 3)°"),
        F("angle_measure", ["C"], expr="5x-3", quote="Each base angle measures (5x - 3)°")])
    t = trusted(text, facts)
    assert t is not None and sum(g.kind == "angle_measure" for g in t.givens) == 2, q


# ── Pins for the derived-fact grammar's edges ────────────────────────

def test_to_before_a_question_verb_is_the_questions() -> None:
    text = r"In $\triangle ABC$, $m\angle A = 40^\circ$. Use the Triangle Sum Theorem to find $m\angle B$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="B")],
                        givens=[F("angle_measure", ["A"], value=40, quote="m∠A = 40°")])
    assert cv.coverage(text, facts)[0] == []


def test_properties_of_parallel_lines_is_no_method_list_even_with_congruent_triangles() -> None:
    text = r"$AB = 5$. Find $CD$ using properties of parallel lines."
    facts = FigureFacts(points=list("ABCD"), segments=["AB", "CD"], find=[Target(kind="segment", item="CD")],
                        givens=[F("equal_length", ["AB"], value=5, quote="AB = 5")],
                        prove=[F("congruent_triangles", ["ABC", "DBC"], quote="x")])
    assert any("parallel" in g for g in cv.coverage(text, facts)[0])


def test_the_base_angles_satisfy_needs_one_triangle_holding_them() -> None:
    """Two listed triangles hold ∠Q and ∠R: which one's base is not said."""
    text = (r"$PQ = PR$ and $SQ = SR$. The base angles satisfy $m\angle Q = (5y - 8)^\circ$ and "
            r"$m\angle R = (3y + 14)^\circ$. Find $y$.")
    facts = FigureFacts(points=list("PQRS"), triangles=["PQR", "SQR"], find=[Target(kind="other", item="y")], givens=[
        F("congruent_segments", ["PQ", "PR"], quote="PQ = PR"), F("congruent_segments", ["SQ", "SR"], quote="SQ = SR"),
        F("angle_measure", ["Q"], expr="5y-8", quote="m∠Q = (5y - 8)°"),
        F("angle_measure", ["R"], expr="3y+14", quote="m∠R = (3y + 14)°")])
    assert any("base" in g for g in cv.coverage(text, facts)[0])


def test_intersects_needs_the_kind_of_its_subject() -> None:
    """A bare "QT" says neither segment, ray nor line: S's place on it is
    not stated exactly, so the words are a gap."""
    text = r"In $\triangle PQR$, $QT$ bisects $\angle PQR$ and intersects $\overline{PR}$ at $S$."
    facts = FigureFacts(points=list("PQRST"), triangles=["PQR"], segments=["QT"], givens=[
        F("bisects_angle", ["QT", "PQR"], quote="QT bisects ∠PQR"),
        F("on_segment", ["PR"], point="S", quote="intersects PR at S"),
        F("on_segment", ["QT"], point="S", quote="intersects PR at S")])
    assert cv.coverage(text, standard_reading(facts))[0] != []


def test_the_subject_is_not_taken_past_a_comma() -> None:
    from api.core.geometry.figure_check import _clean

    text = (r"$\overline{EF} \parallel \overline{PQ}$, the triangle is drawn and intersects $\overline{PR}$ "
            r"at $S$.")
    toks = cv.tokens(_clean(text), set("EFPQRS"))
    at = next(n for n, k in enumerate(toks) if k.norm == "intersects")
    assert cv._subject_of(toks, at) is None
