"""Review round 2 of PR #989: each reviewer reproduction, as a test that
fails if its fix is reverted.

1. A figure that collapses (points on one spot, a flat triangle or
   parallelogram, "parallel" pieces on one line) is refused.
2. Measures and lengths given as algebra are held to the drawing.
3. Labels are read by their parts and each part is checked.
4. Coverage counts each stated relation on its own.
5. Shape words match whole words ("bisector" is not "sector").
6. The model's reply never describes the figure; a part asked for by
   description is reported as not added.
(7, the PATCH route, is in tests/test_question_text_edit_figures.py.)
"""

from __future__ import annotations

import math
import os
from types import SimpleNamespace
from typing import Any

from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, Part, Target, coverage_gaps, unverifiable
from api.core.geometry.figure_check import check_construction, unbacked_marks


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def check(f: ConstructionFigure, text: str, facts: FigureFacts, **kw: Any) -> list[str]:
    return [i.message for i in check_construction(f, text, facts=facts, **kw)]


# ── 1. Degenerate figures ─────────────────────────────────────────────

ISO = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$. Prove: $\angle B \cong \angle C$."
ISO_FACTS = FigureFacts(points=list("ABC"), triangles=["ABC"],
                        givens=[F("congruent_segments", ["AB", "AC"], quote="AB ≅ AC")],
                        prove=[F("congruent_angles", ["B", "C"], quote="∠B ≅ ∠C")])


def test_a_flat_parallelogram_is_refused() -> None:
    text = r"Given: ABCD is a parallelogram. Prove: $\overline{AB} \cong \overline{CD}$."
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"],
                        givens=[F("parallelogram", ["ABCD"], quote="ABCD is a parallelogram")],
                        prove=[F("congruent_segments", ["AB", "CD"], quote="AB ≅ CD")])
    flat = fig(points={"A": (0, 0), "B": (2, 0), "C": (5, 0), "D": (3, 0)}, segments=["AB", "BC", "CD", "DA"])
    out = check(flat, text, facts)
    assert "ABCD is drawn flat (it has no area)" in out
    assert "the given parallelogram ABCD (AB ∥ CD) is not true in the drawing" in out
    good = fig(points={"A": (0, 0), "B": (4, 0), "C": (5, 3), "D": (1, 3)}, segments=["AB", "BC", "CD", "DA"],
               parallel_groups=[["AB", "CD"], ["BC", "DA"]])
    assert check(good, text, facts) == []


def test_a_flat_triangle_is_refused() -> None:
    flat = fig(points={"B": (0, 0), "A": (3, 0), "C": (6, 0)}, segments=["AB", "BC", "CA"], tick_groups=[["AB", "AC"]])
    assert check(flat, ISO, ISO_FACTS) == ["triangle ABC is drawn flat (it has no area)"]
    assert check(fig(points={"B": (0, 0), "A": (3, 4), "C": (6, 0)}, segments=["AB", "BC", "CA"],
                     tick_groups=[["AB", "AC"]]), ISO, ISO_FACTS) == []


def test_three_corners_in_a_row_is_no_polygon() -> None:
    """A quadrilateral with C on BD: it has area, but C is no corner."""
    text = "Quadrilateral $ABCD$."
    facts = FigureFacts(points=list("ABCD"), polygons=["ABCD"])
    f = fig(points={"A": (0, 0), "B": (4, 0), "C": (4, 2), "D": (4, 4)}, segments=["AB", "BC", "CD", "DA"])
    assert "ABCD is drawn with B, C, D in a row, so C is no corner" in check(f, text, facts)


def test_parallel_pieces_on_one_line_are_not_parallel() -> None:
    text = r"Lines $m$ and $n$ are parallel."
    facts = FigureFacts(named_lines=["m", "n"], givens=[F("parallel", ["m", "n"], quote="m ∥ n")])
    same = fig(points={"_a": (0, 0), "_b": (4, 0), "_c": (6, 0), "_d": (9, 0)},
               lines=[{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}],
               parallel_groups=[["m", "n"]])
    assert check(same, text, facts) == ["the given m ∥ n is not true in the drawing",
                                        "the parallel arrows on m, n are on pieces that aren't parallel in the drawing"]
    apart = fig(points={"_a": (0, 0), "_b": (4, 0), "_c": (0, 3), "_d": (4, 3)},
                lines=[{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}],
                parallel_groups=[["m", "n"]])
    assert check(apart, text, facts) == []
    text2 = r"Given $\overline{AB} \parallel \overline{CD}$."
    facts2 = FigureFacts(points=list("ABCD"), segments=["AB", "CD"], givens=[F("parallel", ["AB", "CD"])])
    one_line = fig(points={"A": (0, 0), "B": (2, 0), "C": (4, 0), "D": (7, 0)}, segments=["AB", "CD"],
                   parallel_groups=[["AB", "CD"]])
    assert check(one_line, text2, facts2) == [
        "the given AB ∥ CD is not true in the drawing",
        "the parallel arrows on AB, CD are on pieces that aren't parallel in the drawing"]


def test_parallel_arrows_on_one_line_are_a_false_mark() -> None:
    text = "Segments $AB$ and $CD$."
    facts = FigureFacts(points=list("ABCD"), segments=["AB", "CD"])
    f = fig(points={"A": (0, 0), "B": (2, 0), "C": (4, 0), "D": (7, 0)}, segments=["AB", "CD"],
            parallel_groups=[["AB", "CD"]])
    assert "the parallel arrows on AB, CD are on pieces that aren't parallel in the drawing" in check(f, text, facts)


def test_two_named_points_on_one_spot_are_refused() -> None:
    text = r"In $\triangle ABC$, $D$ lies on $\overline{BC}$. Draw $\overline{AD}$."
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["AD"],
                        givens=[F("on_segment", ["BC"], point="D", quote="D lies on BC")])
    at_b = fig(points={"A": (1, 3), "B": (0, 0), "C": (5, 0), "D": (0, 0)}, segments=["AB", "BC", "CA", "AD"])
    assert check(at_b, text, facts) == ["points B and D are drawn on the same spot"]
    between = fig(points={"A": (1, 3), "B": (0, 0), "C": (5, 0), "D": (2, 0)}, segments=["AB", "BC", "CA", "AD"])
    assert check(between, text, facts) == []


# ── 2. Algebra ────────────────────────────────────────────────────────


def test_angles_given_as_algebra_are_held_to_the_drawing() -> None:
    """m∠A = x°, m∠B = (2x)°: nothing fixes x, but ∠B must be twice ∠A."""
    text = r"In $\triangle ABC$, $m\angle A = x^\circ$ and $m\angle B = (2x)^\circ$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("angle_measure", ["A"], expr="x", quote="m∠A = x°"),
        F("angle_measure", ["B"], expr="2x", quote="m∠B = (2x)°")])
    assert unverifiable(facts) == []
    equal = fig(points={"A": (0, 0), "B": (4, 0), "C": (2, 2)}, segments=["AB", "BC", "CA"])
    assert check(equal, text, facts) == ["the given m∠A = x, m∠B = 2x is not true in the drawing"]
    # ∠A = 30°, ∠B = 60°: x = 30.
    c = (3 * math.cos(math.radians(30)) ** 2, 3 * math.cos(math.radians(30)) * math.sin(math.radians(30)))
    twice = fig(points={"A": (0, 0), "B": (3, 0), "C": c}, segments=["AB", "BC", "CA"])
    assert check(twice, text, facts) == []


def test_lengths_given_as_algebra_are_held_to_the_drawing() -> None:
    text = r"In $\triangle ABC$, $AB = 2x$, $AC = 2x$ and $BC = x + 3$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("equal_length", ["AB"], expr="2x", quote="AB = 2x"),
        F("equal_length", ["AC"], expr="2x", quote="AC = 2x"),
        F("equal_length", ["BC"], expr="x + 3", quote="BC = x + 3")])
    unequal = fig(points={"A": (0, 0), "B": (6, 0), "C": (1, 2)}, segments=["AB", "BC", "CA"])
    assert "the given AB = 2x, AC = 2x, BC = x + 3 is not true in the drawing" in check(unequal, text, facts)
    # x = 3: AB = AC = 6, BC = 6 (any scale): an equilateral triangle.
    equilateral = fig(points={"A": (0, 0), "B": (4, 0), "C": (2, 2 * math.sqrt(3))}, segments=["AB", "BC", "CA"])
    assert check(equilateral, text, facts) == []
    # 2, 2, 3 is x = 1.5 at any scale; BC under half of AB would need x + 3 < x.
    fits = fig(points={"A": (0, 0), "B": (2, 0), "C": (-0.25, math.sqrt(4 - 0.0625))},
               segments=["AB", "BC", "CA"])
    assert check(fits, text, facts) == []
    no_x = fig(points={"A": (0, 0), "B": (2, 0), "C": (2 * math.cos(math.radians(20)), 2 * math.sin(math.radians(20)))},
               segments=["AB", "BC", "CA"])
    assert "the given AB = 2x, AC = 2x, BC = x + 3 is not true in the drawing" in check(no_x, text, facts)


def test_a_length_given_as_algebra_is_never_length_zero() -> None:
    """Before: AB = 2x was "AB = 0", and dropped as no length."""
    from api.core.geometry.facts import to_relations

    facts = FigureFacts(points=list("AB"), givens=[F("equal_length", ["AB"], expr="2x")])
    rels = to_relations(facts.givens[0], facts)
    assert [r.kind for r in rels] == ["lenexpr"]


def test_algebra_no_drawing_can_be_held_to_is_unverifiable() -> None:
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("angle_measure", ["A"], expr="x^2", quote="m∠A = x²"),
        F("equal_length", ["AB"], expr="x + y", quote="AB = x + y")])
    assert unverifiable(facts) == ["m∠A = x²", "AB = x + y"]


# ── 3. Labels ─────────────────────────────────────────────────────────

FIND_C = r"In $\triangle ABC$, $\angle A \cong \angle C$ and $m\angle A = 50^\circ$. Find $m\angle C$."
FIND_C_FACTS = FigureFacts(points=list("ABC"), triangles=["ABC"],
                           givens=[F("congruent_angles", ["A", "C"]), F("angle_measure", ["A"], value=50)],
                           find=[Target(kind="angle", item="C")])
_H = 3 * math.tan(math.radians(50))
FIND_C_BASE: dict[str, Any] = {"points": {"A": (0, 0), "B": (3, _H), "C": (6, 0)}, "segments": ["AB", "BC", "CA"],
                               "arc_groups": [["BAC", "ACB"]]}


def test_the_answer_on_its_angle_is_caught_however_it_is_written() -> None:
    for label in ("50°", "m∠C = 50°", "∠C = 50°", "50 °", "$50^\\circ$", "m\\angle C = 50^{\\circ}"):
        f = fig(**FIND_C_BASE, angle_labels={"BAC": "50°", "ACB": label})
        out = check(f, FIND_C, FIND_C_FACTS, final_answer="50°")
        assert f"the label {label!r} on ∠ACB gives away the answer (the problem asks for it)" in out, label
    f = fig(**FIND_C_BASE, angle_labels={"BAC": "50°", "ACB": "x = 50°"})
    out = check(f, FIND_C, FIND_C_FACTS, final_answer="50°")
    assert "the label 'x = 50°' on ∠ACB names x, which the problem doesn't call that angle" in out
    assert check(fig(**FIND_C_BASE, angle_labels={"BAC": "m∠A = 50°"}), FIND_C, FIND_C_FACTS, final_answer="50°") == []


def test_a_length_answer_is_caught_however_it_is_written() -> None:
    text = r"$AB = 5$ and $\overline{AB} \cong \overline{CD}$. Find $CD$."
    facts = FigureFacts(points=list("ABCD"), segments=["AB", "CD"],
                        givens=[F("equal_length", ["AB"], value=5), F("congruent_segments", ["AB", "CD"])],
                        find=[Target(kind="segment", item="CD")])
    base: dict[str, Any] = {"points": {"A": (0, 0), "B": (5, 0), "C": (0, 2), "D": (5, 2)}, "segments": ["AB", "CD"],
                            "tick_groups": [["AB", "CD"]]}
    for label in ("5", "CD = 5", "CD=5 cm"):
        out = check(fig(**base, side_labels={"AB": "5", "CD": label}), text, facts, final_answer="CD = 5")
        assert f"the label {label!r} on CD gives away the answer (the problem asks for it)" in out, label
    assert check(fig(**base, side_labels={"AB": "AB = 5"}), text, facts, final_answer="CD = 5") == []


def test_a_measure_label_is_checked_against_the_drawing_in_any_form() -> None:
    f = fig(**FIND_C_BASE, angle_labels={"ABC": "m∠B = 50°"})
    out = check(f, FIND_C, FIND_C_FACTS, final_answer="50°")
    assert "the label 'm∠B = 50°' on ∠ABC does not match the drawing (drawn as 80°)" in out


def test_a_number_the_problem_gives_for_another_part_is_not_given_for_this_one() -> None:
    """∠C = ∠B = 50° is the student's first step toward m∠A = 80°."""
    text = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$ and $m\angle B = 50^\circ$. Find $m\angle A$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"],
                        givens=[F("congruent_segments", ["AB", "AC"]), F("angle_measure", ["B"], value=50)],
                        find=[Target(kind="angle", item="A")])
    pts = {"A": (3, 3 * math.tan(math.radians(50))), "B": (0, 0), "C": (6, 0)}
    derived = fig(points=pts, segments=["AB", "BC", "CA"], angle_labels={"ABC": "50°", "ACB": "50°"},
                  tick_groups=[["AB", "AC"]])
    assert check(derived, text, facts, final_answer="80°") == [
        "the label '50°' on ∠ACB shows 50, which the problem doesn't give for ∠ACB",
    ]
    given = fig(points=pts, segments=["AB", "BC", "CA"], angle_labels={"ABC": "50°"}, tick_groups=[["AB", "AC"]])
    assert check(given, text, facts, final_answer="80°") == []
    # A length too: AB = 5 is not BC = 5.
    text = r"In $\triangle ABC$, $AB = 5$. Find $AC$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("equal_length", ["AB"], value=5)],
                        find=[Target(kind="segment", item="AC")])
    tri = {"points": {"A": (0, 0), "B": (5, 0), "C": (2, 4)}, "segments": ["AB", "BC", "CA"]}
    assert check(fig(**tri, side_labels={"AB": "5", "BC": "5"}), text, facts, final_answer="7") == [
        "the label '5' on BC shows 5, which the problem doesn't give for BC",
    ]
    assert check(fig(**tri, side_labels={"AB": "5"}), text, facts, final_answer="7") == []


def test_a_measure_solved_from_the_problem_is_not_given() -> None:
    """m∠A = 2x + 10 and x = 20 make ∠A 50°: a step, not a given."""
    text = r"$m\angle ABC = (2x + 10)^\circ$ and $m\angle ABC = 50^\circ$."
    facts = FigureFacts(points=list("ABC"), givens=[F("angle_measure", ["ABC"], expr="2x + 10")],
                        rays=["BA", "BC"])
    pts = {"A": (3 * math.cos(math.radians(50)), 3 * math.sin(math.radians(50))), "B": (0, 0), "C": (3, 0)}
    f = fig(points=pts, rays=["BA", "BC"], angle_labels={"ABC": "(2x + 10)°"})
    assert check(f, text, facts) == []
    f2 = fig(points=pts, rays=["BA", "BC"], angle_labels={"ABC": "2x+10"})
    assert check(f2, text, facts) == []
    f3 = fig(points=pts, rays=["BA", "BC"], angle_labels={"ABC": "3x"})
    assert check(f3, text, facts) == ["the label '3x' on ∠ABC shows 3x, which the problem doesn't give for ∠ABC"]
    # x, 2x, 3x in a triangle make ∠A 30°: the problem gives x°, not 30°.
    text = r"In $\triangle ABC$, $m\angle A = x^\circ$, $m\angle B = (2x)^\circ$ and $m\angle C = (3x)^\circ$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
        F("angle_measure", ["A"], expr="x"), F("angle_measure", ["B"], expr="2x"),
        F("angle_measure", ["C"], expr="3x")])
    c = math.cos(math.radians(30))
    tri = {"points": {"A": (0, 0), "B": (4, 0), "C": (4 * c * c, 4 * c * 0.5)}, "segments": ["AB", "BC", "CA"]}
    assert check(fig(**tri, angle_labels={"BAC": "x°"}), text, facts) == []
    assert check(fig(**tri, angle_labels={"BAC": "30°"}), text, facts) == [
        "the label '30°' on ∠BAC shows 30, which the problem doesn't give for ∠BAC"]
    # Solved from the facts: supplementary makes 5x + 30 = 180, so ∠ABD is
    # 70° — the student's work, not a given.
    text = (r"$\angle ABD$ and $\angle DBC$ are supplementary, $m\angle ABD = (2x + 10)^\circ$ and "
            r"$m\angle DBC = (3x + 20)^\circ$.")
    sup = FigureFacts(points=list("ABCD"), rays=["BA", "BD", "BC"], givens=[
        F("supplementary", ["ABD", "DBC"]), F("angle_measure", ["ABD"], expr="2x + 10"),
        F("angle_measure", ["DBC"], expr="3x + 20")])
    rays = {"points": {"A": (3, 0), "B": (0, 0), "C": (-3, 0),
                       "D": (3 * math.cos(math.radians(70)), 3 * math.sin(math.radians(70)))},
            "rays": ["BA", "BD", "BC"]}
    assert check(fig(**rays, angle_labels={"ABD": "(2x + 10)°"}), text, sup) == []
    assert check(fig(**rays, angle_labels={"ABD": "70°"}), text, sup) == [
        "the label '70°' on ∠ABD shows 70, which the problem doesn't give for ∠ABD"]
    text = r"In $\triangle ABC$, $m\angle A = x^\circ$, $m\angle B = (2x)^\circ$ and $m\angle C = (3x)^\circ$."
    # x is ∠A's variable, so it can't name ∠B.
    assert check(fig(**tri, angle_labels={"ABC": "x"}), text, facts) == [
        "the label 'x' on ∠ABC shows x, which the problem doesn't give for ∠ABC"]


def test_a_label_without_a_number_must_be_a_name_the_problem_uses() -> None:
    pts = {"A": (2, 4), "B": (0, 0), "C": (4, 0)}
    base: dict[str, Any] = {"points": pts, "segments": ["AB", "BC", "CA"], "tick_groups": [["AB", "AC"]]}
    for label, why in (("y", "shows y"), ("?", "shows ?"), (" ", "is empty"),
                       ("∠1", "names ∠1, which the problem doesn't have")):
        out = check(fig(**base, angle_labels={"BAC": label}), ISO, ISO_FACTS)
        assert any(why in m for m in out), (label, out)
    # The article "a" in the problem's words is not a name it gives.
    worded = r"In a triangle $ABC$, $\overline{AB} \cong \overline{AC}$."
    out = check(fig(**base, angle_labels={"BAC": "a"}), worded, ISO_FACTS.model_copy(update={"prove": []}))
    assert out == ["the label 'a' on ∠BAC shows a, which the problem doesn't give for ∠BAC"]


def test_a_name_label_must_name_a_part_the_problem_names() -> None:
    """Prod (2d8021e3): "∠AED" printed beside ∠AEC and ∠BED, a step of the proof."""
    text = (r"Given that lines $\overleftrightarrow{AB}$ and $\overleftrightarrow{CD}$ intersect at point $E$, "
            r"prove that $\angle AEC \cong \angle BED$.")
    facts = FigureFacts(points=list("ABCDE"), lines=["AB", "CD"],
                        givens=[F("intersect", ["AB", "CD"], point="E")],
                        prove=[F("congruent_angles", ["AEC", "BED"])])
    pts = {"A": (0, 4), "B": (10, 4), "C": (2.429, 0.936), "D": (7.571, 7.064), "E": (5, 4)}
    lines = [{"through": ["A", "B"]}, {"through": ["C", "D"]}]
    named = fig(points=pts, lines=lines, angle_labels={"AEC": "∠AEC", "BED": "∠BED"})
    assert check(named, text, facts) == []
    step = fig(points=pts, lines=lines, angle_labels={"AEC": "∠AEC", "BED": "∠BED", "AED": "∠AED"})
    assert check(step, text, facts) == ["the label '∠AED' on ∠AED names ∠AED, an angle the problem doesn't name"]
    swapped = fig(points=pts, lines=lines, angle_labels={"AEC": "∠BED", "BED": "∠AEC"})
    assert "the label '∠BED' on ∠AEC names ∠BED, a different angle" in check(swapped, text, facts)
    sides = fig(points={"A": (0, 0), "B": (4, 0), "C": (4, 3)}, segments=["AB", "BC", "CA"], side_labels={"AB": "AB"})
    assert check(sides, "Triangle $ABC$.", FigureFacts(points=list("ABC"), triangles=["ABC"])) == []
    other = fig(points={"A": (0, 0), "B": (4, 0), "C": (4, 3)}, segments=["AB", "BC", "CA"], side_labels={"AB": "BC"})
    assert check(other, "Triangle $ABC$.", FigureFacts(points=list("ABC"), triangles=["ABC"])) == [
        "the label 'BC' on AB names BC, a different segment"]
    on_line = fig(points={"A": (0, 0), "C": (2, 0), "B": (5, 0)}, lines=[{"through": ["A", "B"]}],
                  side_labels={"AC": "AC"})
    assert check(on_line, r"Line $\overleftrightarrow{AB}$ passes through $C$.",
                 FigureFacts(points=list("ABC"), lines=["AB"], givens=[F("on_line", ["AB"], point="C")])) == [
        "the label 'AC' on AC names AC, a segment the problem doesn't name"]


def test_a_label_never_makes_an_extra_piece_count_as_named() -> None:
    pts = {"A": (2, 4), "B": (0, 0), "C": (4, 0), "_m": (2, 0)}
    plain = fig(points=pts, segments=["AB", "BC", "CA", "A_m"], tick_groups=[["AB", "AC"]])
    assert check(plain, ISO, ISO_FACTS) == ["extra segment not in the problem: from A to an unnamed point"]
    for label in ("y", " ", "?", "40°"):
        f = fig(points=pts, segments=["AB", "BC", "CA", "A_m"], angle_labels={"BA_m": label},
                tick_groups=[["AB", "AC"]])
        out = check(f, ISO, ISO_FACTS)
        assert "extra segment not in the problem: from A to an unnamed point" in out, label
        assert not any("Am" in m or "_m" in m for m in out), out
        assert unbacked_marks(f, ISO, ISO_FACTS) == {}


def test_a_numbered_angle_label_still_places_its_angle() -> None:
    """∠1's arms are accounted for by ∠1 itself (the problem names nothing else)."""
    text = r"$\angle 1$ and $\angle 2$ form a linear pair."
    facts = FigureFacts(givens=[F("linear_pair", ["1", "2"])])
    pts = {"_a": (-3, 0), "_o": (0, 0), "_b": (3, 0), "_c": (1, 3)}
    f = fig(points=pts, rays=["_o_a", "_o_b", "_o_c"], angle_labels={"_a_o_c": "1", "_c_o_b": "2"})
    assert check(f, text, facts) == []
    # Beside named points: the ray off B is ∠1's arm, so it is no extra.
    text = r"Point $B$ lies on line $\overleftrightarrow{AC}$. $\angle 1$ and $\angle 2$ form a linear pair at $B$."
    facts = FigureFacts(points=list("ABC"), lines=["AC"],
                        givens=[F("on_line", ["AC"], point="B"), F("linear_pair", ["1", "2"])])
    pts = {"A": (0, 0), "B": (3, 0), "C": (6, 0), "_d": (4, 3)}
    f = fig(points=pts, lines=[{"through": ["A", "C"]}], rays=["B_d"], angle_labels={"AB_d": "1", "_dBC": "2"})
    assert check(f, text, facts) == []
    f = fig(points=pts, lines=[{"through": ["A", "C"]}], rays=["B_d"], angle_labels={"AB_d": "y", "_dBC": "z"})
    assert "extra ray not in the problem: from B to an unnamed point" in check(f, text, facts)


def test_ninety_is_given_only_for_the_right_angle() -> None:
    text = r"$\overline{AD} \perp \overline{BC}$ in $\triangle ABC$, with $D$ on $\overline{BC}$."
    facts = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["AD"],
                        givens=[F("perpendicular", ["AD", "BC"], point="D"), F("on_segment", ["BC"], point="D")])
    pts = {"A": (1, 3), "B": (0, 0), "C": (4, 0), "D": (1, 0)}
    right = fig(points=pts, segments=["AB", "BC", "CA", "AD"], angle_labels={"ADB": "90°"})
    assert check(right, text, facts) == []
    # ∠BAC drawn as 90°: true in the drawing, but the problem gives 90°
    # only for the angles at D.
    pts2 = {"A": (1.44, 1.92), "B": (0, 0), "C": (4, 0), "D": (1.44, 0)}
    wrong = fig(points=pts2, segments=["AB", "BC", "CA", "AD"], angle_labels={"BAC": "90°"}, right_angles=["ADB"])
    assert check(wrong, text, facts) == ["the label '90°' on ∠BAC shows 90, which the problem doesn't give for ∠BAC"]


# ── 4. Coverage ───────────────────────────────────────────────────────


def test_each_stated_relation_needs_its_own_fact() -> None:
    cases = [
        (r"In $\triangle ABC$, $D$ is a point on $\overline{BC}$ and $\overline{AD} \perp \overline{BC}$.",
         FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["AD"],
                     givens=[F("perpendicular", ["AD", "BC"], point="D", quote="AD ⊥ BC")]),
         F("on_segment", ["BC"], point="D", quote="D is a point on BC")),
        (r"In $\triangle ABC$, $m\angle A = 40^\circ$ and $\overline{AB} \cong \overline{AC}$.",
         FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("congruent_segments", ["AB", "AC"],
                                                                      quote="AB ≅ AC")]),
         F("angle_measure", ["A"], value=40, quote="m∠A = 40°")),
        (r"In quadrilateral $ABCD$, $AB = CD$ and $\overline{AB} \parallel \overline{CD}$.",
         FigureFacts(points=list("ABCD"), polygons=["ABCD"], givens=[F("parallel", ["AB", "CD"], quote="AB ∥ CD")]),
         F("congruent_segments", ["AB", "CD"], quote="AB = CD")),
        (r"$E$ is the intersection of $\overline{AC}$ and $\overline{BD}$, and "
         r"$\overline{AB} \parallel \overline{CD}$.",
         FigureFacts(points=list("ABCDE"), segments=["AC", "BD", "AB", "CD"],
                     givens=[F("parallel", ["AB", "CD"], quote="AB ∥ CD")]),
         F("intersect", ["AC", "BD"], point="E", quote="E is the intersection of AC and BD")),
        (r"$D$ is between $A$ and $B$, and $\overline{CD} \perp \overline{AB}$.",
         FigureFacts(points=list("ABCD"), segments=["CD", "AB"], givens=[F("perpendicular", ["CD", "AB"],
                                                                           quote="CD ⊥ AB")]),
         F("on_segment", ["AB"], point="D", quote="D is between A and B")),
        (r"Given $\overline{AB} \parallel \overline{CD}$ and $\overline{EF} \parallel \overline{GH}$.",
         FigureFacts(points=list("ABCDEFGH"), segments=["AB", "CD", "EF", "GH"],
                     givens=[F("parallel", ["AB", "CD"], quote="AB ∥ CD")]),
         F("parallel", ["EF", "GH"], quote="EF ∥ GH")),
        # One fact can't stand for two occurrences.
        (r"$D$ is a point on $\overline{BC}$ and $E$ is a point on $\overline{BC}$.",
         FigureFacts(points=list("BCDE"), segments=["BC"], givens=[F("on_segment", ["BC"], point="D",
                                                                       quote="D is a point on BC")]),
         F("on_segment", ["BC"], point="E", quote="E is a point on BC")),
        # "AB ∥ EF" needs a fact about both sides, not one about AB alone.
        (r"$\overline{AB} \parallel \overline{EF}$.",
         FigureFacts(points=list("ABCDEF"), segments=["AB", "CD", "EF"],
                     givens=[F("parallel", ["AB", "CD"], quote="AB ∥ EF")]),
         F("parallel", ["AB", "EF"], quote="AB ∥ EF")),
        (r"In $\triangle ABC$, $m\angle A = 2x + 5$ and $\overline{AB} \cong \overline{AC}$.",
         FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("congruent_segments", ["AB", "AC"],
                                                                      quote="AB ≅ AC")]),
         F("angle_measure", ["A"], expr="2x + 5", quote="m∠A = 2x + 5")),
        (r"In $\triangle ABC$, $\angle ABC$ measures $40^\circ$ and $\overline{AB} \cong \overline{AC}$.",
         FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("congruent_segments", ["AB", "AC"],
                                                                      quote="AB ≅ AC")]),
         F("angle_measure", ["ABC"], value=40, quote="∠ABC measures 40°")),
    ]
    for text, facts, missing in cases:
        assert coverage_gaps(text, facts) != [], text
        whole = facts.model_copy(update={"givens": [*facts.givens, missing]})
        assert coverage_gaps(text, whole) == [], text


def test_a_hint_states_no_fact() -> None:
    text = (r"Given $\angle QRT \cong \angle SRT$, $\angle RQT \cong \angle RST$. Prove $\overline{QT} \cong "
            r"\overline{ST}$. (*Hint:* First prove that $\triangle QRT \cong \triangle SRT$ using AAS.)")
    facts = FigureFacts(points=list("QRST"), triangles=["QRT", "SRT"], givens=[
        F("congruent_angles", ["QRT", "SRT"], quote="∠QRT ≅ ∠SRT"),
        F("congruent_angles", ["RQT", "RST"], quote="∠RQT ≅ ∠RST")],
        prove=[F("congruent_segments", ["QT", "ST"], quote="QT ≅ ST")])
    # Review round 6: a hint is read like the rest of the text. Its claim
    # (△QRT ≅ △SRT) is a statement no fact reads, so it is a gap: skipping a
    # hint could pass a figure that breaks it ("Hint: the triangle is
    # isosceles"). Only its label, its method ("using AAS") and the exact
    # instruction "first prove that" are accounted for.
    assert coverage_gaps(text, facts) == ["“≅”"]


def test_a_chain_is_one_fact_for_each_link() -> None:
    text = r"$\overline{AB} \parallel \overline{CD} \parallel \overline{EF}$."
    facts = FigureFacts(points=list("ABCDEF"), givens=[F("parallel", ["AB", "CD", "EF"], quote="AB ∥ CD ∥ EF")])
    assert coverage_gaps(text, facts) == []


# ── 5. Whole words ────────────────────────────────────────────────────


def test_bisector_allows_no_sector_arc_or_shading() -> None:
    text = r"$\overrightarrow{BD}$ is the bisector of $\angle ABC$."
    facts = FigureFacts(points=list("ABCD"), rays=["BD", "BA", "BC"], givens=[F("bisects_angle", ["BD", "ABC"])])
    pts = {"A": (4, 0), "B": (0, 0), "C": (4 * math.cos(math.radians(80)), 4 * math.sin(math.radians(80))),
           "D": (4 * math.cos(math.radians(40)), 4 * math.sin(math.radians(40)))}
    sector = {"center": "B", "endpoints": ["A", "D"]}
    f = fig(points=pts, rays=["BA", "BC", "BD"], sectors=[sector], shaded=[{"sector": sector}],
            arc_groups=[["ABD", "DBC"]])
    assert check(f, text, facts) == ["extra sector not in the problem", "extra shading not in the problem"]
    sector_text = text + " Shade the sector $ABD$."
    assert check(f, sector_text, facts) == []


# ── 6. The reply ──────────────────────────────────────────────────────


def _reply_env() -> None:
    os.environ.setdefault("CLAUDE_API_KEY", "sk-test")


def test_the_models_reply_never_describes_the_figure() -> None:
    """Round 2 6 / round 3 A (p4): when a proposal touches the figure, the
    reply is written by code from the proposal. No sentence of the model's
    is shown, however it describes the picture."""
    _reply_env()
    from api.core.question_bank_chat import _construction_reply

    text = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$."
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("congruent_segments", ["AB", "AC"])])
    spec = {"type": "geometry", "shape": "construction", "points": {"A": [2, 3], "B": [0, 0], "C": [4, 0]},
            "segments": ["AB", "BC", "CA"], "tick_groups": [["AB", "AC"]]}
    item = SimpleNamespace(figure_spec=None, figure_svg=None, final_answer="", solution_steps=None)
    proposal = {"figure_spec": spec, "figure_svg": "<svg/>", "figure_facts": facts.model_dump()}
    for said in ("Done! I've dropped the perpendicular to the base as well.",
                 "I put in the altitude too, so students can see the height.",
                 "Shaded the region between them.",
                 "I wrote the answer by the top corner so students can check their work.",
                 "The question's parallelogram is now wider and tilted to the right.",
                 "The hexagon in the problem is now regular and rotated to sit flat.",
                 "The region the question asks about is now colored blue.",
                 "Students can now see the 40° from the problem near the top.",
                 "The kite in the problem is now upright with the answer written inside.",
                 "I made the question harder by asking for the angle instead."):
        out = _construction_reply(f"Sure! {said}", proposal, item, "draw it", text,
                                  top_construction=True, top_issues=[], step_drops={})
        assert out == "I've added a diagram with points A, B and C; the givens are marked.", said


def test_the_reply_says_what_the_proposal_changed() -> None:
    """Round 3 A: the question, steps and answer sentences come from the
    proposal's difference from the item, not from the model."""
    _reply_env()
    from api.core.question_bank_chat import _construction_reply

    text = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$."
    steps = [{"title": "Base angles", "description": "AB = AC so the base angles match."}]
    item = SimpleNamespace(figure_spec=None, figure_svg=None, final_answer="5", solution_steps=steps)
    common = {"top_construction": True, "top_issues": ["the given AB ≅ AC is not true in the drawing"],
              "step_drops": {}}
    same = {"question": None, "solution_steps": steps, "final_answer": "5"}
    out = _construction_reply("I changed the question so AB = 10.", same, item, "draw it", text, **common)
    assert out == "I couldn't draw a correct diagram: the given AB ≅ AC is not true in the drawing."
    changed = {"question": text + " Find BC.", "solution_steps": [{"title": "New", "description": "x"}],
               "final_answer": "6"}
    out = _construction_reply("Sure!", changed, item, "draw it", text, **common)
    assert out.split("\n\n")[0] == (
        "I reworded the question. I rewrote the solution steps. The final answer is now “6”.")
    out = _construction_reply("Sure!", changed, item, "draw it", text, resolved=True, **common)
    assert out.startswith("I reworded the question. The solution steps and final answer below were re-derived")
    # Nothing touches a figure: the model's own reply stands.
    out = _construction_reply("I tightened the wording.", {"question": text}, item, "tidy", text,
                              top_construction=False, top_issues=[], step_drops={})
    assert out == "I tightened the wording."


def test_a_part_asked_for_by_description_is_reported_not_added() -> None:
    _reply_env()
    from api.core.question_bank_chat import _construction_reply

    text = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$."
    request = "please add the altitude from the top vertex"
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[F("congruent_segments", ["AB", "AC"])],
                        requested=[Part(kind="segment", item="altitude from the top vertex")])
    spec = {"type": "geometry", "shape": "construction", "points": {"A": [2, 3], "B": [0, 0], "C": [4, 0]},
            "segments": ["AB", "BC", "CA"], "tick_groups": [["AB", "AC"]]}
    item = SimpleNamespace(figure_spec=None, figure_svg=None, final_answer="")
    proposal = {"question": None, "figure_spec": spec, "figure_svg": "<svg/>", "figure_facts": facts.model_dump(),
                "solution_steps": None}
    out = _construction_reply("Done! I've dropped the perpendicular to the base as well.", proposal, item,
                              request, text, top_construction=True, top_issues=[], step_drops={})
    assert "perpendicular" not in out
    assert "I couldn't add “altitude from the top vertex”" in out


def test_the_messages_do_not_depend_on_the_order_labels_were_written_in() -> None:
    """The retry prompt carries the messages; a recording replays the model's
    figure with its labels in name order, so live and replay must agree."""
    pts = {"A": (0, 0), "B": (4, 0), "C": (1, 3)}
    labels = {"BAC": "52°", "ABC": "79°"}
    sides = {"BC": "6", "AB": "4"}
    one = fig(points=pts, segments=["AB", "BC", "CA"], angle_labels=labels, side_labels=sides)
    other = fig(points=pts, segments=["AB", "BC", "CA"], angle_labels=dict(reversed(labels.items())),
                side_labels=dict(reversed(sides.items())))
    facts = FigureFacts(points=list("ABC"), triangles=["ABC"])
    assert check(one, "Triangle $ABC$.", facts) == check(other, "Triangle $ABC$.", facts) != []
