"""The fact card (api/core/geometry/fact_card.py): the facts of a problem the
AI writes, checked by code, with the problem's words written by code from
them, one fixed phrase per fact kind.

The phrases are held to two things: the exact words (so a change is seen)
and the existing coverage allowlist (api/core/geometry/coverage.py), written
for the readings: every word of a phrase must be accounted for by the card's
own fact, so a phrase can't say more than its fact checks.
"""
from __future__ import annotations

from typing import Any

import pytest

from api.core.geometry.coverage import coverage_gaps
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.fact_card import (
    AUTHOR_KINDS,
    CARD_SCHEMA,
    as_drawn,
    card_text,
    clean_context,
    clean_hint,
    constructed_drawn,
    read_card,
    sentence,
    student_constructs,
)
from api.core.geometry.facts import CODE_KINDS, Fact, FigureFacts, as_prompt, with_step


def F(kind: str, items: list[str], **kw: Any) -> dict[str, Any]:  # noqa: N802 - a fact
    return {"kind": kind, "items": items, **kw}


POINTS = list("ABCDEFGHMOP")

# One fact per kind an author card may use, with its phrase.
PHRASES: dict[str, tuple[dict[str, Any], dict[str, Any], str]] = {
    "parallel": ({}, F("parallel", ["AB", "CD"]), r"$\overline{AB} \parallel \overline{CD}$"),
    "perpendicular": ({}, F("perpendicular", ["AB", "CD"], point="E"), r"$\overline{AB} \perp \overline{CD}$ at $E$"),
    "congruent_segments": ({}, F("congruent_segments", ["AB", "CD"]), r"$\overline{AB} \cong \overline{CD}$"),
    "congruent_angles": ({}, F("congruent_angles", ["ABC", "DEF"]), r"$\angle ABC \cong \angle DEF$"),
    "equal_length": ({}, F("equal_length", ["BC"], value=7), r"$BC = 7$"),
    "angle_measure": ({}, F("angle_measure", ["ABC"], value=40), r"$m\angle ABC = 40^\circ$"),
    "midpoint": ({}, F("midpoint", ["AB"], point="M"), r"$M$ is the midpoint of $\overline{AB}$"),
    "on_segment": ({}, F("on_segment", ["AB"], point="M"), r"$M$ is on $\overline{AB}$"),
    "on_line": ({"lines": ["AB"]}, F("on_line", ["AB"], point="M"), r"$M$ is on $\overleftrightarrow{AB}$"),
    "collinear": ({}, F("collinear", ["A", "M", "B"]), r"Points $A$, $M$, and $B$ are collinear"),
    "intersect": ({}, F("intersect", ["AB", "CD"], point="E"), r"$\overline{AB}$ and $\overline{CD}$ intersect at $E$"),
    "bisects_segment": ({}, F("bisects_segment", ["CD", "AB"], point="M"),
                        r"$\overline{CD}$ bisects $\overline{AB}$ at $M$"),
    "bisects_angle": ({}, F("bisects_angle", ["BD", "ABC"]), r"$\overrightarrow{BD}$ bisects $\angle ABC$"),
    "right_angle": ({}, F("right_angle", ["ABC"]), r"$\angle ABC$ is a right angle"),
    "opposite_rays": ({}, F("opposite_rays", ["BA", "BC"]),
                      r"$\overrightarrow{BA}$ and $\overrightarrow{BC}$ are opposite rays"),
    "vertical_angles": ({}, F("vertical_angles", ["AEC", "BED"]), r"$\angle AEC$ and $\angle BED$ are vertical angles"),
    "linear_pair": ({}, F("linear_pair", ["AEC", "CEB"]), r"$\angle AEC$ and $\angle CEB$ form a linear pair"),
    "supplementary": ({}, F("supplementary", ["ABC", "DEF"]), r"$\angle ABC$ and $\angle DEF$ are supplementary"),
    "complementary": ({}, F("complementary", ["ABC", "DEF"]), r"$\angle ABC$ and $\angle DEF$ are complementary"),
    "congruent_triangles": ({}, F("congruent_triangles", ["ABC", "DEF"]), r"$\triangle ABC \cong \triangle DEF$"),
    "similar_triangles": ({}, F("similar_triangles", ["ABC", "DEF"]), r"$\triangle ABC \sim \triangle DEF$"),
    "isosceles": ({}, F("isosceles", ["ABC"], point="A"),
                  r"$\triangle ABC$ is isosceles with $\overline{AB} \cong \overline{AC}$"),
    "equilateral": ({}, F("equilateral", ["ABC"]), r"$\triangle ABC$ is equilateral"),
    "right_triangle": ({}, F("right_triangle", ["ABC"], point="C"), r"$\triangle ABC$ has a right angle at $C$"),
    "parallelogram": ({}, F("parallelogram", ["ABCD"]), r"$ABCD$ is a parallelogram"),
    "rectangle": ({}, F("rectangle", ["ABCD"]), r"$ABCD$ is a rectangle"),
    "square": ({}, F("square", ["ABCD"]), r"$ABCD$ is a square"),
    "rhombus": ({}, F("rhombus", ["ABCD"]), r"$ABCD$ is a rhombus"),
    "trapezoid": ({}, F("trapezoid", ["ABCD"]), r"$ABCD$ is a trapezoid"),
    "isosceles_trapezoid": ({}, F("isosceles_trapezoid", ["ABCD"]), r"$ABCD$ is an isosceles trapezoid"),
    "kite": ({}, F("kite", ["ABCD"]), r"$ABCD$ is a kite"),
    "on_circle": ({"circles": ["O"]}, F("on_circle", ["A", "B", "C"], circle="O"),
                  r"Points $A$, $B$, and $C$ lie on circle $O$"),
    "tangent": ({"circles": ["O"], "lines": ["PA"]}, F("tangent", ["PA"], circle="O", point="A"),
                r"$\overleftrightarrow{PA}$ is tangent to circle $O$ at $A$"),
    "chord": ({"circles": ["O"]}, F("chord", ["AB"], circle="O"), r"$\overline{AB}$ is a chord of circle $O$"),
    "diameter": ({"circles": ["O"]}, F("diameter", ["AB"], circle="O"), r"$\overline{AB}$ is a diameter of circle $O$"),
    "radius": ({"circles": ["O"]}, F("radius", ["OA"], circle="O", value=3),
               r"$\overline{OA}$ is a radius of circle $O$, and $OA = 3$"),
    "central_angle": ({"circles": ["O"]}, F("central_angle", ["AOB"], circle="O", value=80),
                      r"$\angle AOB$ is a central angle of circle $O$, and $m\angle AOB = 80^\circ$"),
    "inscribed_angle": ({"circles": ["O"]}, F("inscribed_angle", ["ACB"], circle="O", value=40),
                        r"$\angle ACB$ is inscribed in circle $O$, and $m\angle ACB = 40^\circ$"),
    "numbered_angle": ({}, F("numbered_angle", ["1", "ABC"]), r"$\angle ABC$ is labeled $\angle 1$"),
    "transversal": ({"lines": ["AB", "CD", "EF"]}, F("transversal", ["EF", "AB", "CD"]),
                    r"$\overleftrightarrow{EF}$ is a transversal of $\overleftrightarrow{AB}$ and "
                    r"$\overleftrightarrow{CD}$"),
    "alternate_interior": ({}, F("alternate_interior", ["AGH", "GHD"]),
                           r"$\angle AGH$ and $\angle GHD$ are alternate interior angles"),
    "alternate_exterior": ({}, F("alternate_exterior", ["EGB", "CHF"]),
                           r"$\angle EGB$ and $\angle CHF$ are alternate exterior angles"),
    "corresponding": ({}, F("corresponding", ["EGB", "GHD"]),
                      r"$\angle EGB$ and $\angle GHD$ are corresponding angles"),
    "same_side_interior": ({}, F("same_side_interior", ["BGH", "GHD"]),
                           r"$\angle BGH$ and $\angle GHD$ are same-side interior angles"),
}
# The figure carries a numbered angle's label; coverage has no word for "labeled".
NOT_IN_COVERAGE = {"numbered_angle"}


def _card(extra: dict[str, Any], *givens: dict[str, Any], **kw: Any) -> dict[str, Any]:
    return {"points": POINTS, **extra, "givens": list(givens), "find": [{"kind": "segment", "item": "AB"}], **kw}


def test_every_author_kind_has_a_phrase() -> None:
    assert set(PHRASES) == set(AUTHOR_KINDS)
    assert "other" not in AUTHOR_KINDS and not set(CODE_KINDS) & set(AUTHOR_KINDS)
    assert CARD_SCHEMA["properties"]["givens"]["items"]["properties"]["kind"]["enum"] == list(AUTHOR_KINDS)


@pytest.mark.parametrize("kind", sorted(PHRASES))
def test_each_kind_has_one_fixed_phrase_that_says_only_its_fact(kind: str) -> None:
    extra, fact, want = PHRASES[kind]
    card, why = read_card(_card(extra, fact))
    assert card is not None, why
    got = sentence(card.givens[0], card)
    assert got == want
    assert card.givens[0].quote == want  # the fact's quote is code's phrase, never the AI's words
    if kind not in NOT_IN_COVERAGE:
        # The readings' own allowlist: every word of the phrase is accounted
        # for by the fact it was written from.
        assert coverage_gaps(f"{got}.", card) == []


# ── What a card is refused for ─────────────────────────────────────────


@pytest.mark.parametrize(("raw", "why"), [
    (_card({}, F("other", ["AB"])), "kind"),
    (_card({}, F("extension", ["BC"], point="D")), "kind"),  # code writes it from a reading's words
    (_card({}, F("obtuse_angle", ["ABC"])), "kind"),
    (_card({}, F("parallel", ["AB", "XY"])), "names a point the card doesn't show"),
    (_card({}, F("midpoint", ["AB"], point="Z")), "names a point the card doesn't show"),
    (_card({}, F("on_circle", ["A"], circle="Q")), "circle"),
    (_card({"segments": ["AZ"]}, F("parallel", ["AB", "CD"])), "segment"),
    (_card({}, F("angle_measure", ["ABC"], value=200)), "more than a straight angle"),
    (_card({}, F("angle_measure", ["ABC"])), "needs its measure"),  # a measure with no value checks nothing
    (_card({}, F("parallel", []), ), "names no part"),
    ({"points": POINTS, "givens": [F("parallel", ["AB", "CD"])]}, "asks nothing"),
    ({**_card({}, F("parallel", ["AB", "CD"])), "find": [{"kind": "other", "item": "the area of ABCD"}]},
     "can't phrase"),
    ({**_card({}, F("parallel", ["AB", "CD"])), "find": [{"kind": "other", "item": "y"}]}, "never show"),
    # Review round 1: "Find x" where the words never show x (an expr the
    # phrase leaves out: a parallel's, or one beside a value).
    ({**_card({}, F("parallel", ["AB", "CD"], expr="2x+1")), "find": [{"kind": "other", "item": "x"}]},
     "never show"),
    ({**_card({}, F("angle_measure", ["ABC"], value=40, expr="3x+1")), "find": [{"kind": "other", "item": "x"}]},
     "never show"),
    # Review round 1: facts whose phrase would drop a part, or come out empty.
    (_card({}, F("perpendicular", ["AB", "BC", "CD"])), "wrong number of parts"),
    (_card({"circles": ["D"]}, F("on_circle", ["A", "B"])), "needs its circle"),
    (_card({"circles": ["D"]}, F("tangent", ["AB"], point="B")), "needs its circle"),
    (_card({}, F("midpoint", ["AB"])), "needs its point"),
    (_card({}, F("bisects_segment", ["AD"])), "wrong number of parts"),
    (_card({}, F("numbered_angle", ["1"])), "wrong number of parts"),
    (_card({}, F("isosceles", ["ABB"], point="B")), "repeated point"),
    (_card({}, F("equal_length", ["AB"], value=-5)), "positive number"),
    (_card({}, F("equal_length", ["AB"], value=0)), "positive number"),
    (_card({}, F("equal_length", ["AB"], value=1e21)), "positive number"),
    (_card({}, F("angle_measure", ["ABC"], value=True)), "true/false"),
    ({"points": list("ABC"), "triangles": ["ABC"], "constructs": [F("midpoint", ["AB"])]}, "needs its point"),
    ({"points": list("ABC"), "triangles": ["ABC"], "constructs": [F("angle_measure", ["ABD"])]},
     "needs its measure"),
    ({"points": list("ABC"), "triangles": ["ABC"], "constructs": [F("bisects_segment", ["AB"])]},
     "wrong number of parts"),
    # Review round 2: items of the wrong shape (a phrase reading backwards),
    # numbered angles no fact labels, expressions that break the LaTeX, an
    # apex off the triangle, and asks the givens already answer.
    (_card({}, F("numbered_angle", ["ABC", "1"])), "aren't the kind"),
    (_card({}, F("numbered_angle", ["1", "AB"])), "aren't the kind"),
    (_card({"circles": ["D"]}, F("on_circle", ["AB", "C"], circle="D")), "aren't the kind"),
    (_card({}, F("collinear", ["AB", "C", "D"])), "aren't the kind"),
    (_card({}, F("congruent_angles", ["1", "2"])), "numbered angle the card doesn't label"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("equal_length", ["AB"], value=6)],
      "find": [{"kind": "angle", "item": "1"}]}, "angle it doesn't label"),
    (_card({}, F("angle_measure", ["ABC"], expr="$2x$")), "plain arithmetic"),
    (_card({}, F("angle_measure", ["ABC"], expr="2x$")), "plain arithmetic"),
    (_card({}, F("isosceles", ["ABC"], point="D")), "apex"),
    (_card({}, F("equal_length", ["AB"], value=0.00001)), "positive number"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("angle_measure", ["ABC"], value=50)],
      "find": [{"kind": "angle", "item": "ABC"}]}, "angle it gives"),
    (_card({}, F("equal_length", ["AB"], value=3))  # _card finds AB
     , "length it gives"),
    # Review round 3: the same ask, written another way.
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("angle_measure", ["ABC"], value=50)],
      "find": [{"kind": "angle", "item": "CBA"}]}, "angle it gives"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("equal_length", ["AB", "AC"], value=5)],
      "find": [{"kind": "segment", "item": "CA"}]}, "length it gives"),
    ({"points": list("OAB"), "circles": ["O"], "givens": [F("radius", ["OA"], circle="O", value=3)],
      "find": [{"kind": "segment", "item": "OA"}]}, "length it gives"),
    ({"points": list("OAB"), "circles": ["O"], "segments": ["OA", "OB"],
      "givens": [F("central_angle", ["AOB"], circle="O", value=80)],
      "find": [{"kind": "angle", "item": "BOA"}]}, "angle it gives"),
    ({"points": list("ABCDE"), "segments": ["AB", "CD"],
      "givens": [F("intersect", ["AB", "CD"], point="E"), F("numbered_angle", ["1", "AEC"]),
                 F("angle_measure", ["1"], value=50)],
      "find": [{"kind": "angle", "item": "CEA"}]}, "angle it gives"),
    # Review round 4: ∠B is ∠ABC in the triangle; △DEF ≅ △ABC is △ABC ≅ △DEF;
    # an x only in a statement to prove or a construction step.
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("angle_measure", ["ABC"], value=50)],
      "find": [{"kind": "angle", "item": "B"}]}, "angle it gives"),
    ({"points": list("ABC"), "triangles": ["ABC"],
      "givens": [F("numbered_angle", ["1", "ABC"]), F("angle_measure", ["1"], value=40)],
      "find": [{"kind": "angle", "item": "B"}]}, "angle it gives"),
    ({"points": list("ABCDEF"), "triangles": ["ABC", "DEF"], "givens": [F("congruent_triangles", ["DEF", "ABC"])],
      "prove": [F("congruent_triangles", ["ABC", "DEF"])]}, "prove a given"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("congruent_segments", ["AB", "AC"])],
      "prove": [F("equal_length", ["AB"], expr="x")], "find": [{"kind": "other", "item": "x"}]}, "never show"),
    # Independent review round: an angle a value-less fact fixes is given.
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("right_angle", ["ABC"])],
      "find": [{"kind": "angle", "item": "ABC"}]}, "angle it gives"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("right_triangle", ["ABC"], point="C")],
      "find": [{"kind": "angle", "item": "BCA"}]}, "angle it gives"),
    ({"points": list("ABCD"), "segments": ["AB", "CD"], "givens": [F("perpendicular", ["AB", "CD"], point="D")],
      "find": [{"kind": "angle", "item": "ADC"}]}, "angle it gives"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("equilateral", ["ABC"])],
      "find": [{"kind": "angle", "item": "CAB"}]}, "angle it gives"),
    ({"points": list("ABCD"), "polygons": ["ABCD"], "givens": [F("square", ["ABCD"])],
      "find": [{"kind": "angle", "item": "DAB"}]}, "angle it gives"),
    ({"points": list("ABCD"), "polygons": ["ABCD"], "givens": [F("rectangle", ["ABCD"])],
      "find": [{"kind": "angle", "item": "C"}]}, "angle it gives"),
    # "Find a" where only code's English ("is a right angle") has an a.
    ({"points": list("ABC"), "triangles": ["ABC"],
      "givens": [F("right_angle", ["ACB"]), F("equal_length", ["AB"], value=5)],
      "find": [{"kind": "other", "item": "a"}]}, "never show"),
    ({"points": list("ABC"), "triangles": ["ABC"], "givens": [F("congruent_segments", ["AB", "AC"])],
      "prove": [F("congruent_segments", ["AC", "AB"])]}, "prove a given"),
    # Review round 1: a construction step whose every point the figure
    # shows (D listed as a point): the figure would show the construction.
    ({"points": list("ABCD"), "segments": ["AD"], "givens": [F("congruent_segments", ["AB", "AC"])],
      "constructs": [F("bisects_angle", ["AD", "BAC"]), F("on_segment", ["BC"], point="D")],
      "prove": [F("congruent_segments", ["BD", "DC"])]}, "makes nothing the figure doesn't show"),
    ({"points": list("ABCD"), "givens": [F("congruent_segments", ["AB", "AC"])],
      "constructs": [F("bisects_angle", ["AD", "BAC"]), F("on_segment", ["BC"], point="D")],
      "prove": [F("congruent_triangles", ["ABD", "ACD"])]}, "makes nothing the figure doesn't show"),
    ({**_card({}, F("parallel", ["AB", "CD"])), "find": [{"kind": "angle", "item": "XYZ"}]}, "doesn't show"),
    ({**_card({}, F("parallel", ["AB", "CD"])), "quote": "AB ∥ CD"}, "fields it can't have"),
    ({**_card({}, F("parallel", ["AB", "CD"])), "source": "reading"}, "fields it can't have"),
    ({"points": ["A", "A", "B"], "givens": [F("equal_length", ["AB"], value=2)],
      "find": [{"kind": "segment", "item": "AB"}]}, "listed once"),
    ("not a card", "no fact card"),
])
def test_a_card_code_cant_hold_a_figure_to_is_refused(raw: Any, why: str) -> None:
    card, reasons = read_card(raw)
    assert card is None and any(why in r for r in reasons), reasons


def test_a_variable_the_givens_use_can_be_found() -> None:
    card, why = read_card({"points": POINTS, "lines": ["AB", "CD", "EF"], "givens": [
        F("parallel", ["AB", "CD"]), F("intersect", ["EF", "AB"], point="G"), F("intersect", ["EF", "CD"], point="H"),
        F("angle_measure", ["AGE"], expr="3x+14"), F("angle_measure", ["CHG"], value=50)],
        "find": [{"kind": "other", "item": "x"}]})
    assert card is not None, why
    assert card.source == "author"
    assert card_text(card).endswith("Find $x$.")


def test_the_card_names_the_parts_its_facts_use() -> None:
    """A figure must draw what the words name: the triangles and segments a
    fact names join the card's lists (so the checker requires them)."""
    card, _ = read_card({"points": list("ABCDEF"), "givens": [F("congruent_segments", ["AB", "DE"])],
                         "prove": [F("congruent_triangles", ["ABC", "DEF"])]})
    assert card is not None
    assert {"ABC", "DEF"} <= set(card.triangles) and {"AB", "DE"} <= set(card.segments)


# ── The problem's words ────────────────────────────────────────────────


MEDIAN = {"points": list("ABCD"), "triangles": ["ABC"], "segments": ["AD"],
          "givens": [F("congruent_segments", ["AB", "AC"]), F("midpoint", ["BC"], point="D")],
          "prove": [F("congruent_angles", ["B", "C"])]}


def test_the_problem_text_is_written_from_the_card() -> None:
    card, _ = read_card(MEDIAN)
    assert card is not None
    assert card_text(card, context="A carpenter is building a roof truss.", hint="Look for congruent triangles.") == (
        r"A carpenter is building a roof truss. The figure shows $\triangle ABC$ and $\overline{AD}$. "
        r"Given: $\overline{AB} \cong \overline{AC}$ and $D$ is the midpoint of $\overline{BC}$. "
        r"Prove: $\angle B \cong \angle C$. Hint: Look for congruent triangles."
    )


def test_a_find_problem_states_its_givens_then_asks() -> None:
    card, _ = read_card({"points": list("ABC"), "triangles": ["ABC"], "givens": [
        F("right_angle", ["ACB"]), F("equal_length", ["AB"], value=13), F("equal_length", ["BC"], value=5)],
        "find": [{"kind": "segment", "item": "AC"}]})
    assert card is not None
    assert card_text(card) == (r"The figure shows $\triangle ABC$. $\angle ACB$ is a right angle. $AB = 13$. "
                               r"$BC = 5$. Find $AC$.")


def test_a_construction_says_what_the_student_constructs() -> None:
    card, why = read_card({"points": list("ABC"), "triangles": ["ABC"],
                           "givens": [F("congruent_segments", ["AB", "AC"])],
                           "constructs": [F("bisects_angle", ["AD", "BAC"]), F("on_segment", ["BC"], point="D")],
                           "prove": [F("congruent_triangles", ["ABD", "ACD"])]})
    assert card is not None, why
    assert student_constructs(card)
    assert card_text(card) == (
        r"The figure shows $\triangle ABC$. Given: $\overline{AB} \cong \overline{AC}$. "
        r"Make a construction so that $\overrightarrow{AD}$ bisects $\angle BAC$ and $D$ is on $\overline{BC}$. "
        r"Prove: $\triangle ABD \cong \triangle ACD$.")
    # The construction's own parts are not among what the figure shows.
    assert card.triangles == ["ABC"] and "D" not in card.points
    drawn = as_drawn(card)
    assert drawn.prove == [] and drawn.triangles == ["ABC"]  # △ABD is on the student's drawing, not the figure
    assert not student_constructs(read_card(MEDIAN)[0])


@pytest.mark.parametrize(("context", "kept"), [
    ("A carpenter is building a roof frame", "A carpenter is building a roof frame."),  # the period is the list's
    ("A carpenter is building a roof truss.", ""),  # not on the list
    ("A ladder AB leans against a wall.", ""),  # a point name
    ("The ladder is 13 feet long.", ""),  # a number: the card says every number
    ("Two parallel roads cross a river.", ""),  # a relation the card doesn't check
    ("The garden is a square.", ""),
    ("A rectangular garden has a path.", ""),  # a shape the card may not have
    ("A circular track has a fence.", ""),
    (r"In $\triangle ABC$ the sides are equal.", ""),
    # Independent review round: number words, hyphen variants, relation
    # verbs, and a cap on length (a blocklist alone can't list every word).
    ("A ladder twelve feet long leans against a wall.", ""),
    ("A rope runs from the top of a ten foot pole.", ""),
    ("Two roads run side-by-side and never touch.", ""),
    ("Two roads run side  by  side.", ""),
    ("The posts stood lined-up.", ""),  # only the hyphen keeps "lined up" apart
    ("A carpenter builds truss ABC.", ""),  # only the point names
    ("A path splits the garden into halves.", ""),
    ("The two triangles match.", ""),
    ("A fence and a wall share a post.", ""),
    ("A dozen students stand in a field.", ""),
    ("The first beam rests on the second.", ""),
    ("Both poles stand in the yard.", ""),
    ("A single wire runs to the roof.", ""),
    ("A pair of trails cross near the lake.", ""),
    ("Three friends meet at a cafe.", ""),
    ("The shelves line up along the wall.", ""),
    ("A kite flies above the park.", ""),
    ("A ramp is steep.", ""),
    ("The sail is a quarter of the mast.", ""),
    ("A park lies between a road and a river.", ""),
    ("A ladder leans against a wall.", ""),
    ("A garden has two paths that start at one spot on its edge.", ""),
    ("A twenty-one foot flagpole stands by a school.", ""),
    ("The roof's beams are the same length.", ""),
    ("A school is planning a new garden with benches, paths, a fountain and lots of shady trees "
     "for students.", ""),  # more than fifteen words
    ("A painter is fixing a house. The house is old.", ""),  # more than one sentence
    ("A city planner is laying out a park.", "A city planner is laying out a park."),
    # Independent review round 2: a word list misses forms and synonyms.
    ("A pole stands perpendicularly on the ground.", ""),
    ("A ladder rests against a wall at its base.", ""),
    ("Its beams are equidistant.", ""),
    ("Its gables are alike.", ""),
    ("A roof truss has twin beams.", ""),
    ("The garden beds are aligned.", ""),
    ("A pole is plumb.", ""),
    ("a carpenter is building a roof frame.", ""),  # exact match only
    # Review round 2: relations said without the listed words.
    ("The two ramps are identical.", ""),
    ("The shelf is level and the post is upright.", ""),
    ("Two roads run side by side.", ""),
    ("Two lamps stand halfway along the path.", ""),
    ("", ""),
])
def test_the_context_is_kept_only_when_it_states_nothing(context: str, kept: str) -> None:
    assert clean_context(context)[0] == kept


@pytest.mark.parametrize(("hint", "kept"), [
    ("List what you know, then what you need", "List what you know, then what you need."),
    ("Look for a theorem that links the givens to what you need.",
     "Look for a theorem that links the givens to what you need."),
    ("Work backward from what you need to prove.", ""),  # speaks of proving: needs a card with a prove
    # Independent round 3: a theorem's name claims the givens support it; none is listed.
    ("Use SAS.", ""), ("Use SSS.", ""), ("Use ASA.", ""), ("Use AAS.", ""), ("Use HL.", ""), ("Use CPCTC.", ""),
    # Anything not on the list is dropped: free text can't be checked.
    ("Try CPCTC", ""),
    ("Use SAS on triangles ABD and ACD.", ""),
    ("Use the 30-60-90 rule.", ""),
    ("Draw an auxiliary line first.", ""),
    ("Look for a pair of congruent triangles", ""),
    ("Use the parallel lines.", ""),
    ("Show the two triangles match first.", ""),  # independent review round
    ("Notice the shared side.", ""),
    ("The diagonal splits it into halves.", ""),
    ("use sas.", ""),
    ("", ""),
])
def test_the_hint_is_kept_only_without_names_numbers_or_drawing(hint: str, kept: str) -> None:
    assert clean_hint(hint)[0] == kept


# ── Who draws what ─────────────────────────────────────────────────────


BISECTOR = {"points": list("ABC"), "triangles": ["ABC"], "givens": [F("congruent_segments", ["AB", "AC"])],
            "constructs": [F("bisects_angle", ["AD", "BAC"]), F("on_segment", ["BC"], point="D")],
            "prove": [F("congruent_triangles", ["ABD", "ACD"])]}
TRI = {"type": "geometry", "shape": "construction", "points": {"A": [3, 5], "B": [0, 0], "C": [6, 0]},
       "segments": ["AB", "BC", "CA"], "tick_groups": [["AB", "AC"]]}


def test_a_figure_that_draws_what_the_student_constructs_is_caught() -> None:
    card, _ = read_card(BISECTOR)
    assert card is not None
    with_d = ConstructionFigure.model_validate({**TRI, "points": {**TRI["points"], "D": [3, 0]},
                                                "segments": [*TRI["segments"], "AD"]})
    assert constructed_drawn(with_d, card) == ["the figure draws D, which the student constructs",
                                               "the figure draws AD, which the student constructs"]
    assert constructed_drawn(ConstructionFigure.model_validate(TRI), card) == []
    # An auxiliary line the card shows is not the student's.
    median, _ = read_card(MEDIAN)
    assert median is not None and constructed_drawn(with_d, median) == []


# ── Stored and shown ───────────────────────────────────────────────────


def test_a_reading_prompt_is_unchanged_by_the_card_fields() -> None:
    """The redraw and chat prompts show a reading as before (its recordings
    still replay): `source` "reading" and empty `constructs` are left out."""
    reading = FigureFacts(points=["A"], givens=[Fact(kind="midpoint", items=["BC"], point="A")])
    shown = as_prompt(reading.model_dump(exclude_none=True, exclude={"dropped"}))
    assert "source" not in shown and "constructs" not in shown
    card, _ = read_card(BISECTOR)
    assert card is not None
    shown = as_prompt(card.model_dump())
    assert shown["source"] == "author" and shown["constructs"]


def test_a_stored_reading_from_before_cards_is_a_reading() -> None:
    old = {"points": ["A", "B"], "givens": [], "prove": [], "find": [], "requested": [], "dropped": []}
    assert FigureFacts.model_validate(old).source == "reading"


def test_a_step_read_from_its_words_makes_the_step_facts_a_reading() -> None:
    card, _ = read_card(MEDIAN)
    assert card is not None
    step = FigureFacts(points=["A"], givens=[])
    assert with_step(card, step).source == "reading"
    assert with_step(card, card).source == "author"


def test_read_card_refuses_rather_than_crashes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Review round 1: a fact the phrases can't handle killed the whole job.
    Anything unexpected refuses the card (fail closed), never raises."""
    import api.core.geometry.fact_card as fc

    odd: list[Any] = [
        {"points": POINTS, "givens": [{"kind": "parallel", "items": [["AB"], "CD"]}], "find": []},
        {"points": POINTS, "givens": "AB ∥ CD", "find": [{"kind": "segment", "item": "AB"}]},
        {"points": None, "find": [{"kind": "segment", "item": "AB"}]},
        {"points": POINTS, "givens": [None], "find": [{"kind": "segment", "item": "AB"}]},
        {"points": POINTS, "find": [{"kind": "angle", "item": None}]},
    ]
    for raw in odd:
        card, why = read_card(raw)
        assert card is None and why, raw

    def boom(*_a: Any, **_k: Any) -> str:
        raise IndexError("list index out of range")

    monkeypatch.setattr(fc, "sentence", boom)
    card, why = read_card(_card({}, F("parallel", ["AB", "CD"])))
    assert card is None and "couldn't be read (IndexError)" in why[0]


def test_a_construction_says_make_a_construction_not_the_figure() -> None:
    """Review round 1: "Construct the figure so that …" points at a figure,
    so a teacher's "the student draws it" (no figure) could never be met."""
    from api.core.question_bank_generation import _FIGURE_REFERENCE

    card, why = read_card({"points": list("ABC"), "triangles": ["ABC"],
                           "givens": [F("congruent_segments", ["AB", "AC"])],
                           "constructs": [F("bisects_angle", ["AD", "BAC"]), F("on_segment", ["BC"], point="D")],
                           "prove": [F("congruent_triangles", ["ABD", "ACD"])]})
    assert card is not None, why
    for figure in (True, False):
        text = card_text(card, figure=figure)
        assert "Make a construction so that" in text
        assert not _FIGURE_REFERENCE.search(card_text(card, figure=False))


def test_a_sentence_that_comes_out_empty_is_refused_even_past_the_field_checks(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """The backstop under _incomplete: an empty `$$` or `= $` in a phrase."""
    import api.core.geometry.fact_card as fc

    monkeypatch.setattr(fc, "_incomplete", lambda f: [])
    card, why = read_card(_card({}, F("midpoint", ["AB"])))
    assert card is None and why == ["a fact's sentence came out incomplete"]



@pytest.mark.parametrize("raw", [
    # Review round 3: ordinary problems the "already given" rule refused.
    {"points": list("ABCDE"), "segments": ["AB", "CD"],
     "givens": [F("intersect", ["AB", "CD"], point="E"), F("numbered_angle", ["1", "AEC"]),
                F("numbered_angle", ["2", "BED"]), F("angle_measure", ["1"], value=50)],
     "find": [{"kind": "angle", "item": "2"}]},
    {"points": list("ABCD"), "triangles": ["ABC"], "segments": ["AD"],
     "givens": [F("on_segment", ["BC"], point="D"), F("congruent_angles", ["BAD", "CAD"]),
                F("congruent_segments", ["AB", "AC"])],
     "prove": [F("congruent_angles", ["ABD", "ACD"])]},
    # A right triangle's other angles are not given by its right angle.
    {"points": list("ABC"), "triangles": ["ABC"],
     "givens": [F("right_triangle", ["ABC"], point="C"), F("angle_measure", ["BAC"], value=35)],
     "find": [{"kind": "angle", "item": "ABC"}]},
    # Empty optional fields read as absent ("circle": "", "expr": "").
    _card({}, F("parallel", ["AB", "CD"], circle="", expr="", point="")),
])
def test_an_ordinary_card_is_accepted(raw: dict[str, Any]) -> None:
    card, why = read_card(raw)
    assert card is not None, why


@pytest.mark.parametrize("context", [
    "Engineers plan to construct a bridge.", "An architect will sketch a floor plan.",
    "A hiker will graph the path she walks.",
])
def test_a_context_that_speaks_of_drawing_is_left_out(context: str) -> None:
    """Review round 3: the words would read as the student drawing (who
    draws it is on the card)."""
    assert clean_context(context)[0] == ""



def test_a_blank_card_is_no_card() -> None:
    from api.core.geometry.fact_card import is_blank_card

    assert is_blank_card({}) and is_blank_card({"points": [], "givens": [], "context": ""})
    assert not is_blank_card({"points": ["A"]}) and not is_blank_card(None) and not is_blank_card("card")



def test_the_hint_is_a_closed_choice_in_the_schema() -> None:
    from api.core.geometry.fact_card import HINT_FIELD, HINTS

    assert HINT_FIELD["enum"] == ["", *HINTS]


# ── An ask the givens already answer: one model (_Measures) ────────────
# Independent review round 2: the case-by-case rule missed a perpendicular
# with no point, the same angle named by another point on its ray, and
# lengths made equal by definition. One model now: rays canonical, angles
# and segments in equivalence classes, values from value-less facts too.

def _ask(givens: list[dict[str, Any]], find: dict[str, str], points: str = "ABCDEF",
         **parts: Any) -> dict[str, Any]:
    return {"points": list(points), **parts, "givens": givens, "find": [find]}


ANGLE, SEGMENT = "angle", "segment"
ANSWERED = {
    "perpendicular, no point (from the shared letter)": _ask(
        [F("perpendicular", ["AB", "BC"])], {"kind": ANGLE, "item": "ABC"}, "ABC", segments=["AB", "BC"]),
    "perpendicular at its point": _ask(
        [F("perpendicular", ["AB", "CD"], point="E"), F("on_segment", ["AB"], point="E"),
         F("on_segment", ["CD"], point="E")], {"kind": ANGLE, "item": "AEC"}, "ABCDE", segments=["AB", "CD"]),
    "right angle, another point on the ray": _ask(
        [F("right_angle", ["ABC"]), F("on_segment", ["BC"], point="D")], {"kind": ANGLE, "item": "ABD"},
        "ABCD", triangles=["ABC"]),
    "measured angle, another point on the ray": _ask(
        [F("angle_measure", ["ABC"], value=50), F("on_segment", ["BC"], point="D")], {"kind": ANGLE, "item": "ABD"},
        "ABCD", triangles=["ABC"]),
    "measured angle, midpoint on the ray": _ask(
        [F("angle_measure", ["ABC"], value=50), F("midpoint", ["BC"], point="M")], {"kind": ANGLE, "item": "ABM"},
        "ABCM", triangles=["ABC"]),
    "measured angle, collinear in order": _ask(
        [F("angle_measure", ["ABC"], value=50), F("collinear", ["B", "D", "C"])], {"kind": ANGLE, "item": "ABD"},
        "ABCD", triangles=["ABC"]),
    "rectangle corner by vertex": _ask(
        [F("rectangle", ["ABCD"])], {"kind": ANGLE, "item": "BCD"}, "ABCD", polygons=["ABCD"]),
    "measured angle, a point on the ray from the far end": _ask(
        [F("angle_measure", ["ACB"], value=50), F("on_segment", ["BC"], point="D")], {"kind": ANGLE, "item": "ACD"},
        "ABCD", triangles=["ABC"]),
    "right triangle's right angle": _ask(
        [F("right_triangle", ["ABC"], point="C")], {"kind": ANGLE, "item": "ACB"}, "ABC", triangles=["ABC"]),
    "a numbered angle is the angle it labels": _ask(
        [F("numbered_angle", ["1", "ABC"]), F("angle_measure", ["ABC"], value=50)], {"kind": ANGLE, "item": "1"},
        "ABC", triangles=["ABC"]),
    "angle B asked, angle ABC given": _ask(
        [F("angle_measure", ["ABC"], value=50)], {"kind": ANGLE, "item": "B"}, "ABC", triangles=["ABC"]),
    "a rectangle's corner asked by its vertex": _ask(
        [F("rectangle", ["ABCD"])], {"kind": ANGLE, "item": "B"}, "ABCD", polygons=["ABCD"]),
    "a length the givens state, written backwards": _ask(
        [F("equal_length", ["AB"], value=5)], {"kind": SEGMENT, "item": "BA"}, "AB", segments=["AB"]),
    "a radius the givens state": {"points": list("OA"), "circles": ["O"],
                                  "givens": [F("radius", ["OA"], circle="O", value=3)],
                                  "find": [{"kind": SEGMENT, "item": "AO"}]},
    "right angle written as its vertex, one angle named there": _ask(
        [F("right_angle", ["B"]), F("numbered_angle", ["1", "ABC"])], {"kind": ANGLE, "item": "ABC"}, "ABC",
        triangles=["ABC"]),
    "the angle a given measures, through a numbered label": {
        "points": list("ABC"), "triangles": ["ABC"],
        "givens": [F("angle_measure", ["1"], value=50), F("numbered_angle", ["1", "ABC"])],
        "find": [{"kind": ANGLE, "item": "CBA"}]},
}
DERIVED = {  # one theorem step: the student's work, so the card is kept
    "alternate interior angles": _ask(
        [F("parallel", ["AB", "CD"]), F("transversal", ["EF", "AB", "CD"]), F("angle_measure", ["AGH"], value=50),
         F("alternate_interior", ["AGH", "GHD"]), F("on_segment", ["AB"], point="G"),
         F("on_segment", ["CD"], point="H"), F("on_segment", ["EF"], point="G"), F("on_segment", ["EF"], point="H")],
        {"kind": ANGLE, "item": "GHD"}, "ABCDEFGH", segments=["AB", "CD", "EF"]),
    "vertical angles": _ask(
        [F("intersect", ["AB", "CD"], point="E"), F("numbered_angle", ["1", "AEC"]), F("numbered_angle", ["2", "BED"]),
         F("angle_measure", ["1"], value=50)], {"kind": ANGLE, "item": "2"}, "ABCDE", segments=["AB", "CD"]),
    "right triangle's other angle": _ask(
        [F("right_triangle", ["ABC"], point="C"), F("angle_measure", ["BAC"], value=35)],
        {"kind": ANGLE, "item": "ABC"}, "ABC", triangles=["ABC"]),
    "a part of the angle (D inside, not on a ray)": _ask(
        [F("angle_measure", ["ABC"], value=80), F("bisects_angle", ["BD", "ABC"])], {"kind": ANGLE, "item": "ABD"},
        "ABCD", triangles=["ABC"], rays=["BD"]),
    "a part of the segment": _ask(
        [F("on_segment", ["AB"], point="D"), F("equal_length", ["AB"], value=10), F("equal_length", ["AD"], value=4)],
        {"kind": SEGMENT, "item": "DB"}, "ABD", segments=["AB"]),
    "hypotenuse": _ask(
        [F("right_triangle", ["ABC"], point="C"), F("equal_length", ["AC"], value=3),
         F("equal_length", ["BC"], value=4)],
        {"kind": SEGMENT, "item": "AB"}, "ABC", triangles=["ABC"]),
    "the opposite ray is a different angle": _ask(
        [F("angle_measure", ["ABC"], value=50), F("on_segment", ["AD"], point="B")], {"kind": ANGLE, "item": "DBC"},
        "ABCD", triangles=["ABC"], segments=["AD"]),
    # Independent round 4: the asked angle doesn't name itself, so a ∠B
    # given reads as ∠ABC only when a statement names ∠ABC.
    "angle ABC asked, angle B given, no statement names ABC": _ask(
        [F("angle_measure", ["B"], value=50)], {"kind": ANGLE, "item": "ABC"}, "ABC", triangles=["ABC"]),
    "right angle B, only the ask names an angle at B": _ask(
        [F("right_angle", ["B"]), F("angle_measure", ["BAD"], value=30)], {"kind": ANGLE, "item": "ABD"}, "ABCD",
        rays=["BA", "BC", "BD"], segments=["AD"]),
    # Independent round 3 (the rule narrowed): an equal partner's value is
    # one step, an exercise in its own right, not an answer a given states.
    "equilateral side": _ask(
        [F("equilateral", ["ABC"]), F("equal_length", ["AB"], value=5)], {"kind": SEGMENT, "item": "BC"},
        "ABC", triangles=["ABC"]),
    "square side": _ask(
        [F("square", ["ABCD"]), F("equal_length", ["AB"], value=5)], {"kind": SEGMENT, "item": "CD"},
        "ABCD", polygons=["ABCD"]),
    "rhombus side": _ask(
        [F("rhombus", ["ABCD"]), F("equal_length", ["AB"], value=5)], {"kind": SEGMENT, "item": "BC"},
        "ABCD", polygons=["ABCD"]),
    "congruent segments": _ask(
        [F("congruent_segments", ["AB", "CD"]), F("equal_length", ["AB"], value=5)], {"kind": SEGMENT, "item": "DC"},
        "ABCD", segments=["AB", "CD"]),
    "congruent angles": _ask(
        [F("congruent_angles", ["ABC", "DEF"]), F("angle_measure", ["ABC"], value=40)],
        {"kind": ANGLE, "item": "FED"}, triangles=["ABC", "DEF"]),
    "isosceles legs, apex given": _ask(
        [F("isosceles", ["ABC"], point="A"), F("equal_length", ["AB"], value=6)], {"kind": SEGMENT, "item": "AC"},
        "ABC", triangles=["ABC"]),
    "midpoint halves": _ask(
        [F("midpoint", ["AB"], point="M"), F("equal_length", ["AM"], value=4)], {"kind": SEGMENT, "item": "MB"},
        "ABM", segments=["AB"]),
    "radii of one circle": {"points": list("OAB"), "circles": ["O"],
                            "givens": [F("radius", ["OA"], circle="O", value=3), F("radius", ["OB"], circle="O")],
                            "find": [{"kind": SEGMENT, "item": "OB"}]},
    "congruent angles, the value on the other one": _ask(
        [F("congruent_angles", ["ABC", "DEF"]), F("angle_measure", ["DEF"], value=40)],
        {"kind": ANGLE, "item": "CBA"}, triangles=["ABC", "DEF"]),
    "complementary part, right angle written as its vertex": _ask(
        [F("right_angle", ["B"]), F("angle_measure", ["ABD"], value=30)], {"kind": ANGLE, "item": "DBC"},
        "ABCD", rays=["BA", "BC", "BD"]),
    "complementary part, inside a perpendicular's right angle": _ask(
        [F("perpendicular", ["AB", "CD"], point="E"), F("on_segment", ["AB"], point="E"),
         F("on_segment", ["CD"], point="E"), F("angle_measure", ["AEF"], value=35)], {"kind": ANGLE, "item": "FEC"},
        "ABCDEF", segments=["AB", "CD"], rays=["EF"]),
    "angle B with two angles named at B": _ask(
        [F("angle_measure", ["ABD"], value=30), F("angle_measure", ["DBC"], value=40)], {"kind": ANGLE, "item": "B"},
        "ABCD", rays=["BA", "BC", "BD"]),
}


@pytest.mark.parametrize("name", sorted(ANSWERED))
def test_an_ask_the_givens_answer_is_refused(name: str) -> None:
    card, why = read_card(ANSWERED[name])
    assert card is None and any("it gives" in w for w in why), (name, why)


def test_proving_a_given_congruence_written_the_other_way_round_is_refused() -> None:
    card, why = read_card({"points": list("ABCD"), "triangles": ["ABD", "CBD"],
                           "givens": [F("congruent_triangles", ["ABD", "CBD"])],
                           "prove": [F("congruent_triangles", ["CBD", "ABD"])]})
    assert card is None and any("prove a given" in w for w in why), why


def _prove(givens: list[dict[str, Any]], prove: dict[str, Any], points: str = "ABCD", **parts: Any) -> dict[str, Any]:
    return {"points": list(points), **parts, "givens": givens, "prove": [prove]}


GIVEN, SELF = "prove a given", "congruent to itself"
# Each statement to prove, against its givens: refused (with why) when it says
# what a given says in other words, kept when it says something new. Every
# kind's reorderings (independent rounds 3 and 4).
PROVE_GIVEN: dict[str, tuple[dict[str, Any], str | None]] = {
    # Ordered kinds: a different order is a different statement.
    "AB bisects CD; prove CD bisects AB": (_prove(
        [F("bisects_segment", ["AB", "CD"], point="M"), F("parallel", ["AC", "DB"])],
        F("bisects_segment", ["CD", "AB"], point="M"), "ABCDM", segments=["AB", "CD", "AC", "DB"]), None),
    "AB bisects CD; prove BA bisects DC": (_prove(
        [F("bisects_segment", ["AB", "CD"], point="M")], F("bisects_segment", ["BA", "DC"], point="M"), "ABCDM",
        segments=["AB", "CD"]), GIVEN),
    "BD bisects angle ABC; prove BD bisects angle CBA": (_prove(
        [F("bisects_angle", ["BD", "ABC"])], F("bisects_angle", ["BD", "CBA"]), rays=["BA", "BC", "BD"]), GIVEN),
    "BD bisects angle ABC; prove BA bisects angle DBC": (_prove(
        [F("bisects_angle", ["BD", "ABC"])], F("bisects_angle", ["BA", "DBC"]), rays=["BA", "BC", "BD"]), None),
    # Angles: the vertex is kept, letters are not sorted.
    "right angle ACB; prove right angle BAC": (_prove(
        [F("right_angle", ["ACB"])], F("right_angle", ["BAC"]), "ABC", triangles=["ABC"]), None),
    "right angle ABC, angle 1 labels it; prove angle 1 right": (_prove(
        [F("right_angle", ["ABC"]), F("numbered_angle", ["1", "ABC"])], F("right_angle", ["1"]), "ABC",
        triangles=["ABC"]), GIVEN),
    "angles ABC and DEF congruent; prove FED and CBA congruent": (_prove(
        [F("congruent_angles", ["ABC", "DEF"])], F("congruent_angles", ["FED", "CBA"]), "ABCDEF",
        triangles=["ABC", "DEF"]), GIVEN),
    "angle ABC congruent to DEF; prove ABC congruent to DFE": (_prove(
        [F("congruent_angles", ["ABC", "DEF"])], F("congruent_angles", ["ABC", "DFE"]), "ABCDEF",
        triangles=["ABC", "DEF"]), None),
    "D on BC, angle ABC congruent to DEF... prove ABD congruent to DEF": (_prove(
        [F("on_segment", ["BC"], point="D"), F("congruent_angles", ["ABC", "EFG"])],
        F("congruent_angles", ["ABD", "EFG"]), "ABCDEFG", triangles=["ABC", "EFG"]), GIVEN),
    # Segments and lines: by their ends, either order.
    "AB congruent to CD; prove DC congruent to BA": (_prove(
        [F("congruent_segments", ["AB", "CD"])], F("congruent_segments", ["DC", "BA"]), segments=["AB", "CD"]), GIVEN),
    "AB congruent to CD; prove AC congruent to BD": (_prove(
        [F("congruent_segments", ["AB", "CD"])], F("congruent_segments", ["AC", "BD"]),
        segments=["AB", "CD", "AC", "BD"]), None),
    "AB parallel to CD; prove DC parallel to BA": (_prove(
        [F("parallel", ["AB", "CD"])], F("parallel", ["DC", "BA"]), segments=["AB", "CD"]), GIVEN),
    "AB parallel to CD; prove AC parallel to BD": (_prove(
        [F("parallel", ["AB", "CD"])], F("parallel", ["AC", "BD"]), segments=["AB", "CD", "AC", "BD"]), None),
    "M midpoint of AB; prove M midpoint of BA": (_prove(
        [F("midpoint", ["AB"], point="M")], F("midpoint", ["BA"], point="M"), "ABM", segments=["AB"]), GIVEN),
    "M midpoint of AB; prove M midpoint of AC": (_prove(
        [F("midpoint", ["AB"], point="M"), F("on_segment", ["AC"], point="B")], F("midpoint", ["AC"], point="M"),
        "ABCM", segments=["AC"]), None),
    "EF cuts AB and CD; prove EF cuts CD and AB": (_prove(
        [F("transversal", ["EF", "AB", "CD"])], F("transversal", ["FE", "CD", "AB"]), "ABCDEF",
        lines=["AB", "CD", "EF"]), GIVEN),
    "EF cuts AB and CD; prove AB cuts EF and CD": (_prove(
        [F("transversal", ["EF", "AB", "CD"])], F("transversal", ["AB", "EF", "CD"]), "ABCDEF",
        lines=["AB", "CD", "EF"]), None),
    # One polygon: any rotation or reversal of its name is the same polygon.
    "equilateral ABC; prove equilateral BCA": (_prove(
        [F("equilateral", ["ABC"])], F("equilateral", ["BCA"]), "ABC", triangles=["ABC"]), GIVEN),
    "isosceles ABC apex A; prove isosceles ACB apex A": (_prove(
        [F("isosceles", ["ABC"], point="A")], F("isosceles", ["ACB"], point="A"), "ABC", triangles=["ABC"]), GIVEN),
    "isosceles ABC apex A; prove isosceles ABC apex B": (_prove(
        [F("isosceles", ["ABC"], point="A")], F("isosceles", ["ABC"], point="B"), "ABC", triangles=["ABC"]), None),
    "right triangle ABC at B; prove right triangle CBA at B": (_prove(
        [F("right_triangle", ["ABC"], point="B")], F("right_triangle", ["CBA"], point="B"), "ABC",
        triangles=["ABC"]), GIVEN),
    "square ABCD; prove square BCDA": (_prove(
        [F("square", ["ABCD"])], F("square", ["BCDA"]), polygons=["ABCD"]), GIVEN),
    "parallelogram ABCD; prove parallelogram DCBA": (_prove(
        [F("parallelogram", ["ABCD"])], F("parallelogram", ["DCBA"]), polygons=["ABCD"]), GIVEN),
    "parallelogram ABCD; prove parallelogram ACBD (a different quadrilateral)": (_prove(
        [F("parallelogram", ["ABCD"])], F("parallelogram", ["ACBD"]), polygons=["ABCD"]), None),
    # Congruent triangles: their correspondence, however listed.
    "ABC congruent to DEF; prove BCA congruent to EFD": (_prove(
        [F("congruent_triangles", ["ABC", "DEF"])], F("congruent_triangles", ["BCA", "EFD"]), "ABCDEF",
        triangles=["ABC", "DEF"]), GIVEN),
    "ABC congruent to DEF; prove DEF congruent to ABC": (_prove(
        [F("congruent_triangles", ["ABC", "DEF"])], F("congruent_triangles", ["DEF", "ABC"]), "ABCDEF",
        triangles=["ABC", "DEF"]), GIVEN),
    "ABC congruent to DEF; prove ABC congruent to EDF (another correspondence)": (_prove(
        [F("congruent_triangles", ["ABC", "DEF"])], F("congruent_triangles", ["ABC", "EDF"]), "ABCDEF",
        triangles=["ABC", "DEF"]), None),
    # A part congruent to itself says nothing.
    "prove AB congruent to BA": (_prove(
        [F("on_segment", ["AB"], point="C")], F("congruent_segments", ["AB", "BA"]), "ABC", segments=["AB"]), SELF),
    "D on BC; prove ABD congruent to ABC": (_prove(
        [F("on_segment", ["BC"], point="D")], F("congruent_angles", ["ABD", "ABC"]), triangles=["ABC"]), SELF),
    "a given that says AB is congruent to BA": (_prove(
        [F("congruent_segments", ["AB", "BA"]), F("on_segment", ["AB"], point="C")],
        F("congruent_segments", ["AC", "CB"]), "ABC", segments=["AB"]), SELF),
    # A value the givens fix, restated.
    "right triangle ABC at B; prove angle ABC right": (_prove(
        [F("right_triangle", ["ABC"], point="B")], F("right_angle", ["ABC"]), "ABC", triangles=["ABC"]), GIVEN),
    "right angle ABC; prove m angle ABC = 90": (_prove(
        [F("right_angle", ["ABC"])], F("angle_measure", ["ABC"], value=90), "ABC", triangles=["ABC"]), GIVEN),
    "AB perpendicular to BC at B; prove angle ABC right": (_prove(
        [F("perpendicular", ["AB", "BC"], point="B")], F("right_angle", ["ABC"]), "ABC", segments=["AB", "BC"]), GIVEN),
    "right angle ABC; prove AB perpendicular to BC at B": (_prove(
        [F("right_angle", ["ABC"])], F("perpendicular", ["AB", "BC"], point="B"), "ABC", triangles=["ABC"]), GIVEN),
    "equilateral ABC; prove m angle BAC = 60": (_prove(
        [F("equilateral", ["ABC"])], F("angle_measure", ["BAC"], value=60), "ABC", triangles=["ABC"]), GIVEN),
    "right triangle ABC at C; prove angle ABC right (a different angle)": (_prove(
        [F("right_triangle", ["ABC"], point="C")], F("right_angle", ["ABC"]), "ABC", triangles=["ABC"]), None),
    "AB perpendicular to CD at E, AEC right; prove AEC congruent to AED": (_prove(
        [F("perpendicular", ["AB", "CD"], point="E"), F("on_segment", ["AB"], point="E"),
         F("on_segment", ["CD"], point="E"), F("right_angle", ["AEC"])], F("congruent_angles", ["AEC", "AED"]),
        "ABCDE", segments=["AB", "CD"]), None),
}


@pytest.mark.parametrize("name", sorted(PROVE_GIVEN))
def test_proving_a_given_is_refused_and_only_that(name: str) -> None:
    raw, refused = PROVE_GIVEN[name]
    card, why = read_card(raw)
    if refused is None:
        assert card is not None, (name, why)
    else:
        assert card is None and any(refused in w for w in why), (name, why)


@pytest.mark.parametrize("name", sorted(DERIVED))
def test_an_ask_one_theorem_step_away_is_kept(name: str) -> None:
    card, why = read_card(DERIVED[name])
    assert card is not None, (name, why)


def test_a_perpendicular_needs_its_point() -> None:
    """No point and no shared letter: refused (its angles can't be placed)."""
    card, why = read_card(_ask([F("perpendicular", ["AB", "CD"])], {"kind": SEGMENT, "item": "AB"}, "ABCD",
                               segments=["AB", "CD"]))
    assert card is None and any("needs its point" in w for w in why), why
    card, why = read_card(_ask([F("perpendicular", ["AB", "BC"])], {"kind": SEGMENT, "item": "AC"}, "ABC",
                               segments=["AB", "BC"]))
    assert card is not None and card.givens[0].point == "B", why



def test_every_listed_setting_and_hint_is_kept_and_the_schema_lists_them() -> None:
    from api.core.geometry.fact_card import CONTEXT_FIELD, CONTEXTS, HINT_FIELD, HINTS

    assert CONTEXT_FIELD["enum"] == ["", *CONTEXTS] and HINT_FIELD["enum"] == ["", *HINTS]
    assert all(clean_context(c) == (c, "") for c in CONTEXTS)


PROVE_TRIANGLES = {"points": list("ABCD"), "triangles": ["ABD", "CBD"],
                   "givens": [F("congruent_segments", ["AB", "CB"]), F("congruent_segments", ["AD", "CD"])],
                   "prove": [F("congruent_triangles", ["ABD", "CBD"])]}
FIND_ANGLE = {"points": list("ABC"), "triangles": ["ABC"], "givens": [F("angle_measure", ["BAC"], value=40)],
              "find": [{"kind": "angle", "item": "ABC"}]}


@pytest.mark.parametrize(("raw", "hint", "kept"), [
    # Independent round 3: no theorem's name is a hint (it claims the givens
    # support it); a hint about proving needs something to prove.
    (PROVE_TRIANGLES, "Work backward from what you need to prove.", True),
    (FIND_ANGLE, "Work backward from what you need to prove.", False),
    (FIND_ANGLE, "List what you know, then what you need.", True),
    (FIND_ANGLE, "Look for a theorem that links the givens to what you need.", True),
    (PROVE_TRIANGLES, "Use SSS.", False),
    (PROVE_TRIANGLES, "Use CPCTC.", False),
])
def test_a_hint_makes_no_claim_about_the_figure(raw: dict[str, Any], hint: str, kept: bool) -> None:
    card, why = read_card(raw)
    assert card is not None, why
    assert (clean_hint(hint, card)[0] == hint) is kept
