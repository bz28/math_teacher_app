"""Review round 6 of PR #989: coverage is an allowlist.

Five more false passes came from rules that exempted parts of a sentence
(a name trailing a statement, a question's whole clause, a list of
complement words around a shading). They are gone. Instead every token of
the problem (name, number, symbol, word) must be accounted for:

1. by a verified fact, when the token lies in that fact's exact quote and
   the fact uses it in the role the text gives it ("at C": C is the
   fact's vertex; "= 7": the fact's value). The quote must hold a word or
   symbol of the fact's own relation and name a part of the fact; what
   else the quote holds is not accounted for;
2. by what is asked, and only the target's own tokens ("m∠A", "the length
   of", the asked part's name);
3. by what code reads itself (a shading statement "X is shaded" and
   nothing around it, coordinates, a listed part named as what it is, a
   part to draw, a method's name, the hypotenuse or legs of a stated right
   angle);
4. by a short list of inert words (articles, "is", "find" …). A word that
   says something about the figure is never inert.

Each test below fails if its rule is reverted (tests/revert_round6 in the
PR description lists the reverts run).
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from api.core.geometry import coverage as cv
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, Target, coverage_gaps, standard_reading
from api.core.geometry.figure_check import check_construction


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def refused(text: str, facts: FigureFacts, figure: ConstructionFigure) -> bool:
    """The pipeline's order: the standard reading, its coverage, the check."""
    s = standard_reading(facts)
    return bool(coverage_gaps(text, s)) or bool(check_construction(figure, text, facts=s))


# ── 1. A quote accounts only for what its fact uses ─────────────────

def test_a_trailing_name_needs_the_fact_at_that_vertex() -> None:
    """Reviewer t1: "right angles at A and C" read as one right angle ∠ACB
    (at C, between A and B: a diagonal) passed; the trailing "C" counted as
    named by the fact. C is ∠ACB's vertex, but ∠ACB is not the angle at C
    of quadrilateral ABCD (its sides there are CB and CD)."""
    text = r"Quadrilateral $ABCD$ has right angles at $A$ and $C$, and $AB = 3$. Find $BD$."
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"], find=[Target(kind="segment", item="BD")],
                        givens=[F("right_angle", ["ACB"], quote="right angles at A and C"),
                                F("equal_length", ["AB"], value=3, quote="AB = 3")])
    wrong = fig(points={"A": (0, 0), "B": (3, 0), "C": (1.5, 1.5), "D": (-1, 3)},
                segments=["AB", "BC", "CD", "DA", "AC"], side_labels={"AB": "3"}, right_angles=["ACB"])
    gaps = coverage_gaps(text, standard_reading(facts))
    assert "“C”" in gaps and any("A" in g for g in gaps if g != "“C”")
    assert refused(text, facts, wrong)


def test_an_overlong_quote_accounts_only_for_its_own_fact() -> None:
    """Reviewer t1b: "AB = 3, ∠A" quoted for AB = 3 accounted for ∠A (A
    is an end of AB), so the right angle at A needed no fact."""
    text = r"Quadrilateral $ABCD$ has $AB = 3$, $\angle A$ and $\angle C$ are right angles. Find $BD$."
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"], find=[Target(kind="segment", item="BD")],
                        givens=[F("right_angle", ["BCD"], quote="∠C are right angles"),
                                F("equal_length", ["AB"], value=3, quote="AB = 3, ∠A")])
    wrong = fig(points={"A": (0, 0), "B": (3, 0), "C": (3, 3), "D": (-1, 3)},
                segments=["AB", "BC", "CD", "DA"], side_labels={"AB": "3"}, right_angles=["BCD"])
    assert coverage_gaps(text, standard_reading(facts)) == ["“A”"]
    assert refused(text, facts, wrong)


def test_a_quote_naming_no_part_accounts_for_nothing() -> None:
    """Found in round 6: "the vertex angle measures 40°" read as m∠B = 40°
    (a base angle) passed: the quote names no angle, so which angle is the
    reading's choice alone."""
    text = r"In isosceles $\triangle ABC$ with $AB = AC$, the vertex angle measures $40^\circ$. Find $m\angle C$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="C")], givens=[
        F("isosceles", ["ABC"], point="A", quote="isosceles △ABC with AB = AC"),
        F("angle_measure", ["B"], value=40, quote="the vertex angle measures 40°")])
    assert coverage_gaps(text, facts) == ["“measures 40°”"]
    # Named, it is accounted for.
    named = (r"In isosceles $\triangle ABC$ with $AB = AC$, the vertex angle $\angle A$ measures $40^\circ$. "
             r"Find $m\angle C$.")
    at_a = facts.model_copy(update={"givens": [facts.givens[0], F("angle_measure", ["A"], value=40,
                                                                    quote="the vertex angle ∠A measures 40°")]})
    assert coverage_gaps(named, at_a) == []


def test_a_quote_without_its_relation_accounts_for_nothing() -> None:
    text = r"In the figure, $\overline{AB}$ and $\overline{CD}$ are drawn."
    facts = FigureFacts(points=list("ABCD"), segments=["AB", "CD"],
                        givens=[F("parallel", ["AB", "CD"], quote="AB and CD")])
    assert coverage_gaps(text, facts) == ["“AB”", "“CD”", "“drawn”"]


def test_a_quote_must_be_an_exact_run_of_the_text() -> None:
    text = r"$M$ is the midpoint of $\overline{AC}$ and $\overline{BD}$. Prove $\triangle AMB \cong \triangle CMD$."
    facts = FigureFacts(points=list("ABCDM"), triangles=["AMB", "CMD"], givens=[
        F("midpoint", ["AC"], point="M", quote="M is the midpoint of AC"),
        F("midpoint", ["BD"], point="M", quote="M is the midpoint of BD")],
        prove=[F("congruent_triangles", ["AMB", "CMD"], quote="△AMB ≅ △CMD")])
    assert coverage_gaps(text, facts) == ["“BD”"]
    whole = facts.model_copy(update={"givens": [facts.givens[0], F("midpoint", ["BD"], point="M",
                                                                     quote="M is the midpoint of AC and BD")]})
    assert coverage_gaps(text, whole) == []


def test_a_side_of_an_equal_sided_shape_is_any_side() -> None:
    """"Equilateral △ABC has side length 6" read as AB = 6 is exact; in a
    scalene triangle, "a side has length 6" is not."""
    text = r"Equilateral $\triangle ABC$ has side length 6."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("equilateral", ["ABC"], quote="Equilateral △ABC"), F("equal_length", ["AB"], value=6,
                                                                 quote="has side length 6")])
    assert coverage_gaps(text, facts) == []
    text = r"In $\triangle ABC$, a side has length 6."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("equal_length", ["AB"], value=6, quote="a side has length 6")])
    assert coverage_gaps(text, facts) == ["“length 6”"]


def test_hypotenuse_and_legs_need_the_right_angle() -> None:
    """Found in round 6: "hypotenuse" and "leg" were length words, so "the
    hypotenuse AB = 10 and the leg BC = 6" passed a triangle with no right
    angle. They are accounted for only by a stated right angle they fit."""
    text = r"In $\triangle ABC$, the hypotenuse $AB = 10$ and the leg $BC = 6$. Find $AC$."
    base = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="segment", item="AC")], givens=[
        F("equal_length", ["AB"], value=10, quote="the hypotenuse AB = 10"),
        F("equal_length", ["BC"], value=6, quote="the leg BC = 6")])
    assert coverage_gaps(text, base) == ["“hypotenuse”", "“leg”"]
    at_c = base.model_copy(update={"givens": [*base.givens, F("right_angle", ["ACB"], quote="x")]})
    assert coverage_gaps(text, at_c) == []
    at_b = base.model_copy(update={"givens": [*base.givens, F("right_angle", ["ABC"], quote="x")]})
    assert coverage_gaps(text, at_b) == ["“hypotenuse”"]  # BC is a leg of the right angle at B
    at_a = base.model_copy(update={"givens": [*base.givens, F("right_angle", ["BAC"], quote="x")]})
    assert coverage_gaps(text, at_a) == ["“hypotenuse”", "“leg”"]
    text = r"Right $\triangle ABC$ has hypotenuse $AB$. Find $AB$ if $AC = 3$ and $BC = 4$."
    for vertex, gap in (("C", ["“AB”"]), ("A", ["“hypotenuse AB”"])):
        facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="segment", item="AB")], givens=[
            F("right_triangle", ["ABC"], point=vertex, quote="Right △ABC"),
            F("equal_length", ["AC"], value=3, quote="AC = 3"), F("equal_length", ["BC"], value=4, quote="BC = 4")])
        assert coverage_gaps(text, facts) == gap, vertex


# ── 2. Only a target's own tokens are exempt ────────────────────────

@pytest.mark.parametrize("text", [
    r"In circle $O$, find the length of the diameter, $AB$, if $OA = 5$.",
    r"In circle $O$ with $OA = 5$, find the length of the diameter, $\overline{AB}$.",
    r"In circle $O$ with $OA = 5$, find the length of the diameter $\overline{AB}$.",
])
def test_a_word_in_the_target_is_not_exempt(text: str) -> None:
    """Reviewer t2: "the diameter, AB" in a question was exempt, so a chord
    AB that misses the centre passed."""
    facts = FigureFacts(points=list("ABO"), circles=["O"], segments=["AB"], find=[Target(kind="segment", item="AB")],
                        givens=[F("equal_length", ["OA"], value=5, quote="OA = 5")])
    chord = fig(points={"O": (0, 0), "A": (5, 0), "B": (5 * math.cos(2.0), 5 * math.sin(2.0))},
                circles=[{"center": "O", "radius": 5}], segments=["AB", "OA"], side_labels={"OA": "5"})
    assert coverage_gaps(text, facts) == ["“diameter”"]
    assert refused(text, facts, chord)


@pytest.mark.parametrize("text, gaps", [
    (r"In $\triangle ABC$, $AB = 5$ and $AC = 6$. Find the angle opposite the side $BC = 7$.",
     ["“opposite”", "“BC = 7”"]),
    (r"In $\triangle ABC$, $AB = 5$ and $AC = 6$. Find $m\angle A$ opposite side $BC = 7$.",
     ["“opposite”", "“BC = 7”"]),
    (r"In $\triangle ABC$, $AB = 5$ and $AC = 6$. Find $m\angle A$ when $BC = 7$.", ["“when BC = 7”"]),
])
def test_a_statement_inside_a_question_needs_its_fact(text: str, gaps: list[str]) -> None:
    """Reviewer t4: "find m∠A opposite side BC = 7" exempted BC = 7, so a
    triangle with BC = 4 passed."""
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="A")], givens=[
        F("equal_length", ["AB"], value=5, quote="AB = 5"), F("equal_length", ["AC"], value=6, quote="AC = 6")])
    x = (25 + 16 - 36) / 10
    short = fig(points={"A": (5, 0), "B": (0, 0), "C": (x, math.sqrt(16 - x * x))}, segments=["AB", "BC", "CA"],
                side_labels={"AB": "5", "AC": "6"})
    assert coverage_gaps(text, facts) == gaps
    assert refused(text, facts, short)


def test_an_unknown_not_asked_is_a_gap() -> None:
    text = r"In $\triangle ABC$, $m\angle A = 40^\circ$. Find $x$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"],
                        givens=[F("angle_measure", ["A"], value=40, quote="m∠A = 40°")])
    assert coverage_gaps(text, facts) == ["“x”"]
    for item in ("x", "value of x", "the value of x"):
        assert coverage_gaps(text, facts.model_copy(update={"find": [Target(kind="other", item=item)]})) == []


def test_an_asked_angle_is_named_as_the_reading_writes_it() -> None:
    text = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$ and $m\angle B = 65^\circ$. Find $m\angle C$."
    for item in ("C", "∠C", "m∠C", "ACB"):
        facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item=item)], givens=[
            F("congruent_segments", ["AB", "AC"], quote="AB ≅ AC"), F("angle_measure", ["B"], value=65,
                                                                        quote="m∠B = 65°")])
        assert coverage_gaps(text, facts) == [], item
    other = facts.model_copy(update={"find": [Target(kind="angle", item="m∠A")]})
    assert coverage_gaps(text, other) == ["“C”"]


# ── 3. A shading statement is only "X is shaded" ────────────────────

@pytest.mark.parametrize("text", [
    r"Triangle $ABC$ is shaded, save for its middle third. Find the shaded area.",
    r"Triangle $ABC$ is shaded, excepting its middle third. Find the shaded area.",
    r"Only the top half of triangle $ABC$ is shaded. Find the shaded area.",
    r"Half of triangle $ABC$ is shaded. Find the shaded area.",
    r"Triangle $ABC$ is shaded. Its middle third is left white. Find the shaded area.",
    r"Triangle $ABC$ is shaded; its middle third is unshaded. Find the shaded area.",
    r"Triangle $ABC$ is shaded, with a hole in the middle. Find the shaded area.",
    r"Triangle $ABC$ is shaded, aside from a small circle. Find the shaded area.",
    r"Triangle $ABC$ is shaded, excluding a small circle. Find the shaded area.",
    r"A strip of triangle $ABC$ is shaded. Find the shaded area.",
    r"Part of triangle $ABC$ is shaded. Find the shaded area.",
])
def test_whatever_surrounds_a_shading_is_accounted_for_like_anything_else(text: str) -> None:
    """Reviewer t5: the complement word list had holes ("save for",
    "excepting", "with a hole", "part of", the next sentence, "unshaded").
    There is no list now: the shading accounts only for "X is shaded"."""
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="shaded area")])
    full = fig(points={"A": (0, 0), "B": (6, 0), "C": (2, 4)}, segments=["AB", "BC", "CA"],
               shaded=[{"polygon": ["A", "B", "C"]}])
    assert coverage_gaps(text, facts) != []
    assert refused(text, facts, full)


def test_a_plain_shading_is_accounted_for() -> None:
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="shaded area")])
    for text in (r"Triangle $ABC$ is shaded. Find the shaded area.", r"Shade $\triangle ABC$. Find the shaded area."):
        assert coverage_gaps(text, facts) == [], text


# ── 4. An "other" fact accounts for nothing ─────────────────────────

@pytest.mark.parametrize("text", [
    r"In acute $\triangle ABC$ with $AB$ the longest side, find $m\angle C$.",
    r"In acute $\triangle ABC$ with $AB$ opposite the biggest angle, find $m\angle C$.",
    r"In acute $\triangle ABC$ with $AB$ longer than $BC$, find $m\angle C$.",
    r"In acute $\triangle ABC$ with $AB$ shorter than $BC$, find $m\angle C$.",
    r"In acute $\triangle ABC$ with $AB$ twice $BC$, find $m\angle C$.",
])
def test_an_exact_shape_quote_covers_only_its_own_words(text: str) -> None:
    """Reviewer t6: the quote "acute △ABC" became an acute-triangle fact
    and the rest of the clause ("with AB the longest side") rode along."""
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="C")],
                        givens=[F("other", ["ABC"], quote="acute △ABC")])
    acute_ab_shortest = fig(points={"A": (0, 0), "B": (3, 0), "C": (1.6, 4)}, segments=["AB", "BC", "CA"])
    gaps = coverage_gaps(text, standard_reading(facts))
    assert gaps and all("acute" not in g for g in gaps)  # the shape itself is read; the rest is not
    assert refused(text, facts, acute_ab_shortest)


# ── 5. The inert list ───────────────────────────────────────────────

def test_no_word_of_any_relation_is_inert() -> None:
    relation_words = {w for v in cv.VOCAB.values() for w in v if not w.startswith("sym:")}
    assert cv.INERT_WORDS.isdisjoint(relation_words)
    domain = {"on", "at", "between", "through", "acute", "obtuse", "right", "shaded", "longest", "opposite",
              "part", "half", "middle", "except", "diameter", "hypotenuse", "leg", "base", "each", "both",
              "them", "other", "one", "proof", "exterior", "interior", "arc", "diagonal"}
    assert cv.INERT_WORDS.isdisjoint(domain)


def test_an_inert_word_is_not_a_gap_and_any_other_word_is() -> None:
    facts = FigureFacts(points=list("AB"), segments=["AB"], givens=[F("equal_length", ["AB"], value=5, quote="AB = 5")])
    assert coverage_gaps(r"In the figure below, $AB = 5$.", facts) == []
    assert coverage_gaps(r"In the figure below, $AB = 5$ roughly.", facts) == ["“roughly”"]


# ── 6. Exact readings that restore figures ──────────────────────────

def test_the_minus_sign_and_a_unicode_fraction_match_the_text() -> None:
    text = r"$m\angle ABD = \left(2\frac{1}{2}x\right)^\circ$ and $m\angle DBC = (5x - 3)^\circ$. Find $x$."
    facts = FigureFacts(points=list("ABCD"), find=[Target(kind="other", item="x")], givens=[
        F("angle_measure", ["ABD"], expr="5x/2", quote="m∠ABD = (2½x)°"),
        F("angle_measure", ["DBC"], expr="5x-3", quote="m∠DBC = (5x − 3)°")])
    assert coverage_gaps(text, facts) == []


@pytest.mark.parametrize("text, fact", [
    (r"In $\triangle ABC$, $\overline{AD}$ is perpendicular to $\overline{BC}$ at $D$.",
     F("perpendicular", ["AD", "BC"], quote="AD is perpendicular to BC at D")),
    (r"$\overline{PA}$ is tangent to circle $O$ at $A$.", F("tangent", ["PA", "O"], point="A",
                                                            quote="PA is tangent to circle O at A")),
    (r"$\angle 1$ and $\angle 2$ form a linear pair.", F("linear_pair", ["1", "2"],
                                                         quote="∠1 and ∠2 form a linear pair")),
])
def test_a_relations_own_words_are_its_vocabulary(text: str, fact: Fact) -> None:
    pts = sorted({c for x in [*fact.items, fact.point or ""] for c in x if c.isupper()})
    facts = FigureFacts(points=pts, triangles=["ABC"] if "ABC" in text else [],
                        circles=["O"] if "circle" in text else [],
                        segments=["AD", "BC"] if "AD" in text else [], givens=[fact])
    gaps = coverage_gaps(text, facts)
    assert all(w not in g for g in gaps for w in ("to", "form")), gaps


def test_a_line_named_by_a_letter_is_named() -> None:
    facts = FigureFacts(lines=["m", "n"], givens=[F("parallel", ["m", "n"], quote="Lines m and n are parallel")])
    assert coverage_gaps(r"Lines $m$ and $n$ are parallel.", facts) == []


def test_an_angle_is_not_the_point_at_its_vertex() -> None:
    """A fact about point D does not use "∠D", which names an angle."""
    facts = FigureFacts(points=list("BCD"), segments=["BC"], givens=[F("on_segment", ["BC"], point="D",
                                                                      quote="∠D lies on BC")])
    assert coverage_gaps(r"$\angle D$ lies on $\overline{BC}$.", facts) == ["“D”"]


def test_a_fact_the_checker_cant_verify_accounts_for_nothing() -> None:
    facts = FigureFacts(points=list("ABCD"), givens=[F("other", ["AB", "CD"], quote="AB ∥ CD")])
    assert coverage_gaps(r"$\overline{AB} \parallel \overline{CD}$.", facts) == ["“AB ∥ CD”"]


# ── 7. A method's name, and nothing after it ────────────────────────

METHOD_FACTS = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="B")],
                           givens=[F("angle_measure", ["A"], value=40, quote="m∠A = 40°")])


@pytest.mark.parametrize("text", [
    # Found in round 6: "using …", "by the definition …" and "(Hint: …)"
    # each exempted the rest of their sentence, and a theorem's name took up
    # to six words before "theorem", statement words included.
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. Find $m\angle B$ using the fact that $\triangle ABC$ is isosceles.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. (Hint: the triangle is isosceles.) Find $m\angle B$.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. By the definition of an isosceles triangle, the base angles are "
    r"congruent. Find $m\angle B$.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$ and the triangle is isosceles by the Base Angles Converse Theorem. "
    r"Find $m\angle B$.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. Determine whether $m\angle B$ is 70, given that the triangle is "
    r"isosceles.",
])
def test_a_method_accounts_only_for_its_own_name(text: str) -> None:
    scalene = fig(points={"A": (0, 0), "B": (6, 0), "C": (1, 3)}, segments=["AB", "BC", "CA"],
                  angle_labels={"CAB": "40°"})
    # (In the definition's own name "isosceles" is the method's; what the
    # sentence then states, "the base angles are congruent", is the gap.)
    assert any("isosceles" in g or "congruent" in g for g in coverage_gaps(text, METHOD_FACTS)), text
    assert refused(text, METHOD_FACTS, scalene)


@pytest.mark.parametrize("text", [
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. Find $m\angle B$ by the Triangle Sum Theorem.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. Use the Corollary to the Triangle Sum Theorem to find $m\angle B$.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. Find $m\angle B$ using SAS and the corresponding angles postulate.",
    r"In $\triangle ABC$, $m\angle A = 40^\circ$. Find $m\angle B$ by the definition of angle bisector.",
])
def test_a_methods_name_is_accounted_for(text: str) -> None:
    assert coverage_gaps(text, METHOD_FACTS) == [], text
