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
    ("A carpenter is building a roof truss", "A carpenter is building a roof truss."),
    ("A ladder AB leans against a wall.", ""),  # a point name
    ("The ladder is 13 feet long.", ""),  # a number: the card says every number
    ("Two parallel roads cross a river.", ""),  # a relation the card doesn't check
    ("The garden is a square.", ""),
    ("A rectangular garden has a path.", ""),  # a shape the card may not have
    ("A circular track has a fence.", ""),
    (r"In $\triangle ABC$ the sides are equal.", ""),
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
    ("Look for a pair of congruent triangles", "Look for a pair of congruent triangles."),
    ("Use SAS on triangles ABD and ACD.", ""),  # names points
    # Review round 2: a theorem's initials are not a point; a hint that
    # states a relation is a fact code can't check.
    ("Use SAS.", "Use SAS."),
    ("Try CPCTC", "Try CPCTC."),
    ("Remember that the lines are parallel.", ""),
    ("Notice the triangles are congruent.", ""),
    ("The base angles are equal.", ""),
    ("Use the 30-60-90 rule.", ""),  # a number
    ("Draw an auxiliary line first.", ""),  # the student would draw: grading would need to know
    ("Construct a perpendicular.", ""),
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
