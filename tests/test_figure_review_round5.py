"""Review round 5 of PR #989: each reviewer reproduction and each new rule,
as a test that fails if its fix is reverted.

The rule behind them: coverage (what the text says that a reading must
account for) is loosened only by rules that are exact. A loosening that
can't be stated as an exact equivalence is not made: the problem is
declined instead, and fewer figures are drawn.

1. In a question only the target phrase is exempt from the signal words,
   and only a word with no name after it ("find the acute angle"); a shape
   word naming a part ("the area of rectangle ABCD") needs its fact.
   "which", "draw", "label", "sketch" and "construct" don't ask: a relative
   "which" clause and a drawing instruction state parts of the figure. A
   question's target ends at its clause; only a following clause that is
   nothing but another target ("and the length of YZ") is asked too.
2. "major arc ACB" sets both the side and the point the arc passes through.
3. An "other" fact becomes a checkable kind only when its quote is exactly
   that phrase.
4. A quote over several clauses accounts only for the one that states its
   fact's relation (tests in test_figure_review_round4.py, section 9).
5. A complement word anywhere in a shading sentence ("…, except its
   middle") leaves the shading unread (unverifiable).
6. A statement said twice, exactly, needs its fact once.
7. A clause of only names that ends a statement ("C" in "right angles at A
   and C") is part of that statement: a fact must quote and name it.
8. "draw AD", exactly, is accounted for by the part the figure is checked
   to draw.

Review round 6 replaced rules 1, 4, 5 and 7 with token accounting (see
test_figure_review_round6.py); the tests here still hold, some now
expecting a refusal where the earlier rule accepted.
"""

from __future__ import annotations

import math
from typing import Any

import pytest

from api.core.geometry.coverage import _target_spans
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import (
    Fact,
    FigureFacts,
    Target,
    _question_spans,
    coverage_gaps,
    standard_reading,
    unverifiable,
)
from api.core.geometry.figure_check import _clean, check_construction, shaded_regions, with_arc_sides


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def check(f: ConstructionFigure, text: str, facts: FigureFacts) -> list[str]:
    return [i.message for i in check_construction(f, text, facts=facts)]


def P(deg: float, r: float = 5.0) -> tuple[float, float]:  # noqa: N802
    return (r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg)))


# ── 1. Only the exact target of a question is exempt ─────────────────

AB5 = F("equal_length", ["AB"], value=5, quote="AB = 5")
BC3 = F("equal_length", ["BC"], value=3, quote="BC = 3")


@pytest.mark.parametrize(("text", "word"), [
    (r"Find the area of rectangle $ABCD$ if $AB = 5$ and $BC = 3$.", "rectangle"),
    (r"Find the perimeter of square $ABCD$ if $AB = 5$ and $BC = 3$.", "square"),
    (r"What is the area of parallelogram $ABCD$ if $AB = 5$ and $BC = 3$?", "parallelogram"),
])
def test_a_shape_word_in_a_question_target_needs_its_fact(text: str, word: str) -> None:
    """Reviewer h_c1: the shape word sat inside the target and was exempt, so
    a skewed quadrilateral passed as the rectangle."""
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"], find=[Target(kind="other", item="area")],
                        givens=[AB5, BC3])
    assert any(word in g for g in coverage_gaps(text, facts))
    kind = {"rectangle": "rectangle", "square": "square", "parallelogram": "parallelogram"}[word]
    full = facts.model_copy(update={"givens": [AB5, BC3, F(kind, ["ABCD"], quote=f"{word} ABCD")]})
    assert coverage_gaps(text, full) == []


def test_the_skewed_rectangle_is_refused_end_to_end() -> None:
    """Reviewer h_c1b: with no rectangle fact the reading has a gap, so the
    skewed quadrilateral is never drawn as the answer's figure."""
    text = r"Find the area of rectangle $ABCD$ if $AB = 5$ and $BC = 3$."
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"], find=[Target(kind="other", item="area")],
                        givens=[AB5, BC3])
    assert coverage_gaps(text, facts)
    with_fact = facts.model_copy(update={"givens": [AB5, BC3, F("rectangle", ["ABCD"], quote="rectangle ABCD")]})
    c = (5 + 3 * math.cos(math.radians(60)), 3 * math.sin(math.radians(60)))
    skewed = fig(points={"A": (0, 0), "B": (5, 0), "C": c, "D": (0.3, 2.2)}, segments=["AB", "BC", "CD", "DA"],
                 side_labels={"AB": "5", "BC": "3"})
    assert check(skewed, text, with_fact) != []


def test_a_word_with_no_name_after_it_is_what_is_asked() -> None:
    text = r"In $\triangle ABC$, $m\angle B = 100^\circ$. Find the acute angle at $A$ if $AB = BC$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="A")],
                        givens=[F("angle_measure", ["B"], value=100, quote=r"m\angle B = 100^\circ"),
                                F("congruent_segments", ["AB", "BC"], quote="AB = BC")])
    # Review round 6: "acute" is a domain word, never exempt, even with no
    # name after it.
    assert coverage_gaps(r"In $\triangle ABC$, $m\angle B = 100^\circ$. Find the acute angle.", facts) == ["“acute”"]
    assert any("acute" in g for g in coverage_gaps(text, facts))


def test_the_diameter_named_in_a_question_needs_its_fact() -> None:
    text = r"Find the length of the diameter $AB$ of circle $O$ if $OA = 5$."
    facts = FigureFacts(points=list("ABO"), circles=["O"], givens=[F("equal_length", ["OA"], value=5,
                                                                       quote="OA = 5")])
    assert any("diameter" in g for g in coverage_gaps(text, facts))


def test_a_relative_which_clause_is_a_statement() -> None:
    """Reviewer h_c8 A: "which" counted as a question word, so "∠B, which is
    a right angle, is opposite side AC = 10" needed no facts at all."""
    text = r"In $\triangle ABC$, $\angle B$, which is a right angle, is opposite side $AC = 10$. Find $AB$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="segment", item="AB")])
    gaps = coverage_gaps(text, facts)
    assert any("right" in g for g in gaps) and "“AC = 10”" in gaps


DRAW_PERP = (r"In $\triangle ABC$, $AB = 6$. Draw $\overline{AD} \perp \overline{BC}$ with $D$ on $\overline{BC}$. "
             r"Find $AD$.")


def test_a_drawing_instruction_states_its_relations() -> None:
    """Reviewer h_c8 B: "Draw AD ⊥ BC" was a question, so the ⊥ needed no
    fact and a slanted AD passed."""
    on = F("on_segment", ["BC"], point="D", quote="D on BC")
    six = F("equal_length", ["AB"], value=6, quote="AB = 6")
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], find=[Target(kind="segment", item="AD")],
                        givens=[six, on])
    assert any("⊥" in g for g in coverage_gaps(DRAW_PERP, facts))
    full = facts.model_copy(update={"givens": [six, F("perpendicular", ["AD", "BC"], quote="AD ⊥ BC"), on]})
    assert coverage_gaps(DRAW_PERP, full) == []
    slanted = fig(points={"A": (1, 4), "B": (0, 0), "C": (6, 0), "D": (3, 0)}, segments=["AB", "BC", "CA", "AD"],
                  side_labels={"AB": "6"})
    assert any("AD ⊥ BC" in m for m in check(slanted, DRAW_PERP, full))


@pytest.mark.parametrize("verb", ["Label", "Sketch", "Construct"])
def test_other_drawing_verbs_ask_nothing(verb: str) -> None:
    t = _clean(rf"{verb} $\overline{{AD}} \perp \overline{{BC}}$.")
    assert _question_spans(t) == []


def test_a_question_target_ends_at_its_clause() -> None:
    """The round-4 continuation carried a question's target over the next
    clauses of its sentence; now only a clause that is nothing but another
    target is asked too."""
    text = r"In $\triangle XYZ$, $YZ = 8$. Find the value of $k$ and the length of $\overline{YZ}$."
    facts = FigureFacts(points=list("XYZ"), triangles=["XYZ"],
                        find=[Target(kind="other", item="k"), Target(kind="segment", item="YZ")],
                        givens=[F("equal_length", ["YZ"], value=8, quote="YZ = 8")])
    assert coverage_gaps(text, facts) == []
    t = _clean(text)
    # Review round 6: the target list runs to the sentence end; only its
    # target tokens are exempt.
    assert [t[a:b] for a, b in _target_spans(t)][-1].strip().endswith("YZ}")
    # A further clause that says something is a statement.
    stated = r"In $\triangle XYZ$, $YZ = 8$. Find $k$, and $\overline{XY} \perp \overline{YZ}$."
    assert any("⊥" in g for g in coverage_gaps(stated, facts))
    stated = r"In $\triangle XYZ$, $YZ = 8$. Find $k$ and the triangle is isosceles."
    assert any("isosceles" in g for g in coverage_gaps(stated, facts))


# ── 2. "major arc ACB" says both ─────────────────────────────────────

MAJOR_TEXT = r"Points $A$, $B$, and $C$ lie on circle $O$. Find the measure of major arc $ACB$."
MAJOR_FACTS = FigureFacts(points=list("OABC"), circles=["O"], find=[Target(kind="angle", item="AOB")],
                          givens=[F("on_circle", ["A", "B", "C"], circle="O",
                                    quote="Points A, B, and C lie on circle O")])


def _arc_fig(c_deg: float, major: bool | None = None, text: str = MAJOR_TEXT) -> ConstructionFigure:
    arc: dict[str, Any] = {"center": "O", "endpoints": ["A", "B"]}
    if major is not None:
        arc["major"] = major
    raw = {"type": "geometry", "shape": "construction",
           "points": {"O": (0, 0), "A": P(0), "B": P(100), "C": P(c_deg)},
           "circles": [{"center": "O", "through": "A"}], "segments": ["OA", "OB"], "arcs": [arc]}
    return ConstructionFigure.model_validate(with_arc_sides(raw, text))


def test_major_arc_acb_is_drawn_major() -> None:
    """Reviewer h_c6b: "major arc ACB" was not read at all, so the minor arc
    was drawn for it."""
    f = _arc_fig(230)
    assert f.arcs[0].major is True
    assert check(f, MAJOR_TEXT, MAJOR_FACTS) == []


def test_major_arc_acb_must_pass_through_c() -> None:
    # C on the minor side: the major arc doesn't pass through C.
    assert any("other side" in m for m in check(_arc_fig(50, major=True), MAJOR_TEXT, MAJOR_FACTS))
    minor = MAJOR_TEXT.replace("major arc", "minor arc")
    assert any("other side" in m for m in check(_arc_fig(230, text=minor), minor, MAJOR_FACTS))


# ── 3. An "other" fact converts only when its quote is exactly the phrase ─

def test_a_longer_other_quote_stays_unverifiable() -> None:
    """Reviewer h_c4: "acute △ABC with AB the longest side" became an
    acute-triangle fact, dropping "AB the longest side"."""
    q = r"acute \triangle ABC with AB the longest side"
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="C")],
                        givens=[F("other", ["ABC"], quote=q),
                                F("angle_measure", ["A"], value=70, quote=r"m\angle A = 70^\circ")])
    s = standard_reading(facts)
    assert unverifiable(s) == [q]
    exact = facts.model_copy(update={"givens": [F("other", ["ABC"], quote=r"acute \triangle ABC")]})
    assert [g.kind for g in standard_reading(exact).givens] == ["acute_triangle"]


def test_a_longer_angle_shape_quote_stays_unverifiable() -> None:
    q = r"\angle B is obtuse and \angle C is acute"
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("other", ["B"], quote=q)])
    assert unverifiable(standard_reading(facts)) == [q]
    exact = facts.model_copy(update={"givens": [F("other", ["B"], quote=r"\angle B is obtuse")]})
    assert [g.kind for g in standard_reading(exact).givens] == ["obtuse_angle"]


def test_a_longer_extension_quote_stays_unverifiable() -> None:
    q = "An exterior angle is formed at vertex P by extending side RP beyond P"
    facts = FigureFacts(points=list("PQR"), triangles=["PQR"], givens=[F("other", ["RP"], quote=q)])
    assert unverifiable(standard_reading(facts)) == [q]
    exact = facts.model_copy(update={"givens": [F("other", ["RP"], quote="extending side RP beyond P")]})
    assert [g.kind for g in standard_reading(exact).givens] == ["extension"]


# ── 4. A spanning quote: see test_figure_review_round4.py, section 9 ──

def test_a_spanning_quote_leaves_its_other_clause() -> None:
    """Reviewer h_c3: "m∠ABC = 40°, and ∠ABC is the largest angle" quoted
    whole for the 40° fact accounted for both clauses."""
    text = r"In $\triangle ABC$, $m\angle ABC = 40^\circ$, and $\angle ABC$ is the largest angle. Find $m\angle C$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="angle", item="C")],
                        givens=[F("angle_measure", ["ABC"], value=40,
                                  quote=r"m\angle ABC = 40^\circ, and \angle ABC is the largest angle")])
    assert any("largest" in g for g in coverage_gaps(text, facts))


# ── 5. Complement shading anywhere in the sentence ───────────────────

@pytest.mark.parametrize("text", [
    r"Triangle $ABC$ is shaded, except the middle third. Find the shaded area.",
    r"Shade triangle $ABC$, leaving out its middle. Find the shaded area.",
    r"Triangle $ABC$ is shaded except the middle. Find the shaded area.",
    r"Triangle $ABC$ is shaded, but not its middle. Find the shaded area.",
    r"Triangle $ABC$ is shaded, other than a small square. Find the shaded area.",
    r"Triangle $ABC$ is shaded, minus a small square. Find the shaded area.",
    r"Triangle $ABC$ is shaded, apart from a small square. Find the shaded area.",
])
def test_a_complement_after_the_shading_leaves_it_unread(text: str) -> None:
    """Reviewer h_c2: only the words before the shading were looked at, so
    "△ABC is shaded, except the middle third" passed a fully shaded △ABC.

    Review round 6: there is no list of complement words any more; a
    shading fact accounts only for "X is shaded" / "shade X", so whatever
    follows it is unaccounted for and the reading is declined."""
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="shaded area")])
    assert coverage_gaps(text, facts) != []


def test_a_plain_shading_is_still_read() -> None:
    text = r"Triangle $ABC$ is shaded. Find the shaded area."
    assert shaded_regions(_clean(text)) == [("polygon", ("A", "B", "C"))]
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], find=[Target(kind="other", item="shaded area")])
    assert coverage_gaps(text, facts) == []


# ── 6. A statement said twice, exactly ───────────────────────────────

RESTATED = ("In the figure below, $M$ is the midpoint of $\\overline{AC}$ and $\\overline{BM} \\perp \\overline{AC}$."
            "\n\n**Given:** $M$ is the midpoint of $\\overline{AC}$; $\\overline{BM} \\perp \\overline{AC}$"
            "\n\n**Prove:** $\\triangle ABM \\cong \\triangle CBM$")
_MID = F("midpoint", ["AC"], point="M", quote="M is the midpoint of AC")
_PERP = F("perpendicular", ["BM", "AC"], quote="BM ⊥ AC")
_PROVE = [F("congruent_triangles", ["ABM", "CBM"], quote="△ABM ≅ △CBM")]


def test_a_restated_given_needs_its_fact_once() -> None:
    """Generated problems restate their givens; each repeat counted as a
    gap, so all eight of a batch lost their figures."""
    facts = FigureFacts(points=list("ABCM"), triangles=["ABM", "CBM"], givens=[_MID, _PERP], prove=_PROVE)
    assert coverage_gaps(RESTATED, facts) == []
    # The repeat is accounted for only when what it repeats is.
    missing = facts.model_copy(update={"givens": [_MID]})
    assert any("BM ⊥ AC" in g for g in coverage_gaps(RESTATED, missing))


@pytest.mark.parametrize("given", [
    r"$\angle CAE \cong \angle BDE$",  # other names for the same angles: not a repeat
    r"$m$ is the midpoint of $\overline{AC}$",  # other case
    r"$M$ is the midpoint of $\overline{AB}$",
])
def test_only_an_exact_repeat_counts(given: str) -> None:
    text = (r"In the figure below, $M$ is the midpoint of $\overline{AC}$ and $\angle A \cong \angle D$."
            "\n\n**Given:** " + given)
    facts = FigureFacts(points=list("ABCDEM"), givens=[_MID, F("congruent_angles", ["A", "D"], quote="∠A ≅ ∠D")])
    assert coverage_gaps(text, facts) != []


def test_a_word_asked_then_stated_needs_its_fact() -> None:
    """Asked, "the acute angle" is exempt; said again outside the question,
    it is a statement and needs its fact (it is not a repeat: the words
    differ)."""
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"])
    assert coverage_gaps(r"In $\triangle ABC$, find the acute angle.", facts) == ["“acute”"]  # round 6
    assert any("acute" in g for g in coverage_gaps(r"In $\triangle ABC$, find the acute angle. The acute angle.",
                                                    facts))


# ── 7. The names that end a statement ────────────────────────────────

def test_the_last_name_of_a_plural_statement_needs_a_fact() -> None:
    """Found in round 5: "right angles at A and C" with one right angle (at
    A) passed, since "C" alone was read as only naming the figure."""
    for text in (r"Quadrilateral $ABCD$ has right angles at $A$ and $C$. Find $BD$.",
                 r"Quadrilateral $ABCD$ has right angles at $A$ and $C$, and $AB = 3$. Find $BD$."):
        at_a = F("right_angle", ["DAB"], quote="right angles at A")
        facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"], find=[Target(kind="segment", item="BD")],
                            givens=[at_a, F("equal_length", ["AB"], value=3, quote="AB = 3")])
        assert "“C”" in coverage_gaps(text, facts), text
        both = facts.model_copy(update={"givens": [
            F("right_angle", ["DAB"], quote="right angles at A and C"),
            F("right_angle", ["BCD"], quote="right angles at A and C"),
            F("equal_length", ["AB"], value=3, quote="AB = 3")]})
        assert coverage_gaps(text, both) == [], text


def test_points_on_two_sides_each_need_their_fact() -> None:
    text = r"In $\triangle ABC$, $D$ and $E$ lie on $\overline{AB}$ and $\overline{AC}$. Find $DE$."
    q = "D and E lie on AB and AC"
    wrong = FigureFacts(points=list("ABCDE"), triangles=["ABC"], find=[Target(kind="segment", item="DE")],
                        givens=[F("on_segment", ["AB"], point="D", quote=q),
                                F("on_segment", ["AB"], point="E", quote=q)])
    assert "“AC”" in coverage_gaps(text, wrong)
    right = wrong.model_copy(update={"givens": [F("on_segment", ["AB"], point="D", quote=q),
                                                F("on_segment", ["AC"], point="E", quote=q)]})
    assert coverage_gaps(text, right) == []


def test_the_second_point_of_a_relation_is_its_facts() -> None:
    text = r"$D$ is between $A$ and $B$. Find $AB$."
    facts = FigureFacts(points=list("ABD"), givens=[F("on_segment", ["AB"], point="D", quote="D is between A and B")],
                        find=[Target(kind="segment", item="AB")])
    assert coverage_gaps(text, facts) == []


# ── 8. "draw AD" ─────────────────────────────────────────────────────

DRAW_AD = (r"Given: $\triangle ABC$ with $\overline{AB} \cong \overline{AC}$. Let $D$ be the midpoint of "
           r"$\overline{BC}$, and draw $\overline{AD}$.")
GIVENS_AD = [F("congruent_segments", ["AB", "AC"], quote="AB ≅ AC"),
             F("midpoint", ["BC"], point="D", quote="D be the midpoint of BC")]


def test_draw_ad_is_the_segment_to_draw() -> None:
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["AD"], givens=GIVENS_AD)
    assert coverage_gaps(DRAW_AD, facts) == []
    assert any("draw AD" in g for g in coverage_gaps(DRAW_AD, facts.model_copy(update={"segments": []})))
    # Accounted for because it is checked: a figure without AD is refused.
    no_ad = fig(points={"A": (3, 4), "B": (0, 0), "C": (6, 0), "D": (3, 0)}, segments=["AB", "BC", "CA"],
                tick_groups=[["AB", "AC"], ["BD", "DC"]])
    assert any("not drawn: AD" in m for m in check(no_ad, DRAW_AD, facts))


def test_draw_says_more_is_not_exact() -> None:
    text = r"In $\triangle ABC$, draw $\overline{AD}$ to the longest side."
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["AD"])
    assert coverage_gaps(text, facts) != []


def test_draw_two_rays() -> None:
    text = r"Draw $\overrightarrow{AB}$ and $\overrightarrow{AC}$."
    facts = FigureFacts(points=list("ABC"), rays=["AB", "AC"])
    assert coverage_gaps(text, facts) == []
    assert coverage_gaps(text, facts.model_copy(update={"rays": ["AB", "CA"]})) != []
    assert coverage_gaps(text, facts.model_copy(update={"rays": ["AB"], "segments": ["AC"]})) != []
