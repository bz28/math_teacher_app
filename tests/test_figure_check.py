"""The construction-figure checker (api/core/geometry/figure_check.py).

Each rule has a passing and a failing fixture: the same problem with a
figure that meets the rule and one that breaks it. The checker never calls
an AI; it parses the problem text and measures the drawn coordinates.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.figure_check import check_construction, givens_marked, parse_problem, unbacked_marks


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def messages(problem: str, f: ConstructionFigure, **kw: Any) -> list[str]:
    return [i.message for i in check_construction(f, problem, **kw)]


def kinds(problem: str, f: ConstructionFigure, **kw: Any) -> set[str]:
    return {i.kind for i in check_construction(f, problem, **kw)}


SQUARE = {"A": (0, 0), "B": (4, 0), "C": (4, 4), "D": (0, 4)}
KITE = {"P": (0, 0), "Q": (4, 3), "R": (8, 0), "S": (4, -3)}


# ── Every named part is drawn ──────────────────────────────────────────


def test_missing_point() -> None:
    problem = r"Find $\overline{AB}$."
    assert messages(problem, fig(points={"A": (0, 0), "B": (3, 0)}, segments=["AB"])) == []
    out = messages(problem, fig(points={"A": (0, 0), "C": (3, 0)}, segments=["AC"]))
    assert "missing point: B" in out


def test_hidden_points_dont_count_as_the_problems_points() -> None:
    problem = r"Find $\overline{AB}$."
    out = messages(problem, fig(points={"A": (0, 0), "_b": (3, 0)}, segments=["A_b"]))
    assert "missing point: B" in out


def test_named_segment_drawn() -> None:
    problem = r"Given $\overline{AB} \cong \overline{CD}$."
    pts = {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (3, 2)}
    assert "not drawn: CD" not in messages(problem, fig(points=pts, segments=["AB", "CD"]))
    assert "not drawn: CD" in messages(problem, fig(points=pts, segments=["AB"]))


def test_segment_drawn_in_pieces_counts() -> None:
    """AB drawn as AM + MB (M on it) covers AB."""
    problem = r"$M$ is the midpoint of $\overline{AB}$."
    f = fig(points={"A": (0, 0), "M": (2, 0), "B": (4, 0)}, segments=["AM", "MB"], tick_groups=[["AM", "MB"]])
    assert messages(problem, f) == []


def test_triangle_in_words_needs_its_sides() -> None:
    problem = "Triangle $ABC$ has a right angle at $B$."
    pts = {"A": (0, 3), "B": (0, 0), "C": (4, 0)}
    assert parse_problem(problem).segments == {frozenset("AB"), frozenset("BC"), frozenset("CA")}
    assert messages(problem, fig(points=pts, segments=["AB", "BC", "CA"], right_angles=["ABC"])) == []
    assert "not drawn: AC" in messages(problem, fig(points=pts, segments=["AB", "BC"], right_angles=["ABC"]))


def test_ray_drawn() -> None:
    problem = r"$\overrightarrow{OA}$ is a ray."
    pts = {"O": (0, 0), "A": (3, 1)}
    assert messages(problem, fig(points=pts, rays=["OA"])) == []
    assert "not drawn: ray OA" in messages(problem, fig(points=pts))


def test_line_through_points_drawn() -> None:
    problem = r"$\overleftrightarrow{AB}$ is a line."
    pts = {"A": (0, 0), "B": (3, 1)}
    assert messages(problem, fig(points=pts, lines=[{"through": ["A", "B"]}])) == []
    assert "not drawn: line AB" in messages(problem, fig(points=pts))


def test_angle_arms_drawn() -> None:
    problem = r"Find $m\angle ABC$."
    pts = {"A": (0, 3), "B": (0, 0), "C": (4, 0)}
    assert messages(problem, fig(points=pts, segments=["BA", "BC"])) == []
    assert "not drawn: BC (a side of ∠ABC)" in messages(problem, fig(points=pts, segments=["BA"]))


def test_named_lines_drawn() -> None:
    problem = "Lines $p$ and $q$ are parallel and cut by transversal $t$."
    pts = {"_p1": (0, 0), "_p2": (8, 0), "_q1": (0, 3), "_q2": (8, 3), "_t1": (2, -1), "_t2": (5, 4)}
    lines = [
        {"name": "p", "through": ["_p1", "_p2"]},
        {"name": "q", "through": ["_q1", "_q2"]},
        {"name": "t", "through": ["_t1", "_t2"]},
    ]
    assert messages(problem, fig(points=pts, lines=lines, parallel_groups=[["p", "q"]])) == []
    assert "not drawn: line q" in messages(problem, fig(points=pts, lines=[lines[0], lines[2]]))


def test_numbered_angles_labelled() -> None:
    problem = r"$\angle 1$ and $\angle 2$ are a linear pair."
    pts = {"A": (-3, 0), "O": (0, 0), "B": (3, 0), "C": (1, 3)}
    base: dict[str, Any] = {"points": pts, "segments": ["AO", "OB", "OC"]}
    assert messages(problem, fig(**base, angle_labels={"AOC": "1", "COB": "2"})) == []
    assert "∠2 is not labelled" in messages(problem, fig(**base, angle_labels={"AOC": "1"}))


def test_transversal_drawn() -> None:
    problem = r"$\overline{AB} \parallel \overline{CD}$ are cut by a transversal."
    pts = {"A": (0, 0), "B": (6, 0), "C": (0, 3), "D": (6, 3), "E": (1, -1), "F": (4, 4)}
    assert "not drawn: the transversal" not in messages(problem, fig(points=pts, segments=["AB", "CD", "EF"]))
    assert "not drawn: the transversal" in messages(problem, fig(points=pts, segments=["AB", "CD"]))


def test_request_parts_drawn() -> None:
    """What the teacher asks for ("include segments WM and ZM") must be drawn."""
    problem = r"$M$ is the midpoint of $\overline{XY}$."
    pts = {"X": (0, 0), "M": (2, 0), "Y": (4, 0), "W": (0, 3), "Z": (4, 3)}
    req = "include segments WM and ZM"
    good = fig(points=pts, segments=["XM", "MY", "WM", "ZM"])
    assert "not drawn: MZ" not in messages(problem, good, request_text=req)
    bad = fig(points=pts, segments=["XM", "MY", "WM"])
    assert "not drawn: MZ" in messages(problem, bad, request_text=req)


# ── The givens are true in the drawing ─────────────────────────────────


GIVENS = [
    # (problem, passing figure, failing figure)
    (
        r"Given $\overline{AB} \parallel \overline{CD}$.",
        {"points": {"A": (0, 0), "B": (4, 0), "C": (0, 2), "D": (4, 2)}, "segments": ["AB", "CD"]},
        {"points": {"A": (0, 0), "B": (4, 0), "C": (0, 2), "D": (4, 3)}, "segments": ["AB", "CD"]},
    ),
    (
        r"Given $\overline{AB} \perp \overline{BC}$.",
        {"points": {"A": (0, 3), "B": (0, 0), "C": (4, 0)}, "segments": ["AB", "BC"]},
        {"points": {"A": (1, 3), "B": (0, 0), "C": (4, 0)}, "segments": ["AB", "BC"]},
    ),
    (
        r"Given $\overline{AB} \cong \overline{CD}$.",
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (3, 2)}, "segments": ["AB", "CD"]},
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (4, 2)}, "segments": ["AB", "CD"]},
    ),
    (
        r"Given $\angle ABC \cong \angle DEF$.",
        {"points": {"A": (0, 3), "B": (0, 0), "C": (3, 0), "D": (6, 3), "E": (6, 0), "F": (9, 0)},
         "segments": ["BA", "BC", "ED", "EF"]},
        {"points": {"A": (0, 3), "B": (0, 0), "C": (3, 0), "D": (7, 3), "E": (6, 0), "F": (9, 0)},
         "segments": ["BA", "BC", "ED", "EF"]},
    ),
    (
        r"Given $m\angle ABC = 45°$.",
        {"points": {"A": (3, 3), "B": (0, 0), "C": (3, 0)}, "segments": ["BA", "BC"]},
        {"points": {"A": (2, 3), "B": (0, 0), "C": (3, 0)}, "segments": ["BA", "BC"]},
    ),
    (
        r"$M$ is the midpoint of $\overline{AB}$.",
        {"points": {"A": (0, 0), "M": (2, 0), "B": (4, 0)}, "segments": ["AB"]},
        {"points": {"A": (0, 0), "M": (1.5, 0), "B": (4, 0)}, "segments": ["AB"]},
    ),
    (
        r"$\overline{BE}$ bisects $\overline{AC}$ at point $M$.",
        {"points": {"A": (0, 2), "C": (4, -2), "B": (0, 0), "E": (4, 0), "M": (2, 0)}, "segments": ["AC", "BE"]},
        {"points": {"A": (0, 2), "C": (4, -1), "B": (0, 0), "E": (4, 0), "M": (2, 0)}, "segments": ["AC", "BE"]},
    ),
    (
        r"$\overline{BD}$ bisects $\angle ABC$.",
        {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (2, 2)}, "segments": ["BA", "BC", "BD"]},
        {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (2, 3)}, "segments": ["BA", "BC", "BD"]},
    ),
    (
        r"$D$ lies on $\overline{AB}$.",
        {"points": {"A": (0, 0), "B": (4, 0), "D": (1, 0)}, "segments": ["AB"]},
        {"points": {"A": (0, 0), "B": (4, 0), "D": (1, 0.5)}, "segments": ["AB", "AD"]},
    ),
    (
        r"$\overrightarrow{OA}$ and $\overrightarrow{OB}$ are opposite rays.",
        {"points": {"O": (0, 0), "A": (-3, 0), "B": (3, 0)}, "rays": ["OA", "OB"]},
        {"points": {"O": (0, 0), "A": (-3, 0), "B": (3, 1)}, "rays": ["OA", "OB"]},
    ),
    (
        r"$\angle 1$ and $\angle 3$ are vertical angles.",
        {"points": {"A": (-2, -1), "O": (0, 0), "B": (2, 1), "C": (-2, 1), "D": (2, -1)},
         "lines": [{"through": ["A", "B"]}, {"through": ["C", "D"]}], "angle_labels": {"AOC": "1", "BOD": "3"}},
        {"points": {"A": (-2, -1), "O": (0, 0), "B": (2, 1), "C": (-2, 1), "D": (2, -1)},
         "lines": [{"through": ["A", "B"]}, {"through": ["C", "D"]}], "angle_labels": {"AOC": "1", "BOC": "3"}},
    ),
    (
        r"$\triangle ABC$ and $\triangle DBC$. Right angles at $A$ and $D$.",
        {"points": {"A": (0, 3), "B": (0, 0), "C": (4, 3), "D": (4, 0)}, "segments": ["BA", "AC", "CD", "DB"]},
        {"points": {"A": (0, 3), "B": (0, 0), "C": (4, 3), "D": (5, 0)}, "segments": ["BA", "AC", "CD", "DB"]},
    ),
    (
        "Lines $m$ and $n$ are parallel.",
        {"points": {"_a": (0, 0), "_b": (5, 0), "_c": (0, 2), "_d": (5, 2)},
         "lines": [{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}]},
        {"points": {"_a": (0, 0), "_b": (5, 0), "_c": (0, 2), "_d": (5, 3)},
         "lines": [{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}]},
    ),
    (
        r"$\triangle ABC$ is inscribed in a circle with center $O$.",
        {"points": {"O": (0, 0), "A": (5, 0), "B": (0, 5), "C": (-3, -4)}, "segments": ["AB", "BC", "CA"],
         "circles": [{"center": "O", "radius": 5}]},
        {"points": {"O": (0, 0), "A": (5, 0), "B": (0, 5), "C": (-3, -3)}, "segments": ["AB", "BC", "CA"],
         "circles": [{"center": "O", "radius": 5}]},
    ),
    (
        r"Given $\triangle ABC \cong \triangle DEF$. Find $x$.",
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (5, 0), "E": (8, 0), "F": (5, 2)},
         "segments": ["AB", "BC", "CA", "DE", "EF", "FD"]},
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (5, 0), "E": (8, 0), "F": (5, 3)},
         "segments": ["AB", "BC", "CA", "DE", "EF", "FD"]},
    ),
]


@pytest.mark.parametrize(("problem", "good", "bad"), GIVENS, ids=[g[0][:40] for g in GIVENS])
def test_given_true_in_drawing(problem: str, good: dict[str, Any], bad: dict[str, Any]) -> None:
    assert "false_given" not in kinds(problem, fig(**good)), messages(problem, fig(**good))
    assert "false_given" in kinds(problem, fig(**bad)), messages(problem, fig(**bad))


def test_unknown_angle_is_undecided_not_failed() -> None:
    """∠B with three strokes at B is ambiguous: the checker can't measure
    it, so it doesn't fail the figure on it (it fails only what it can show)."""
    problem = r"Given $\angle B = 50°$."
    f = fig(points={"A": (0, 3), "B": (0, 0), "C": (4, 0), "D": (3, 3)}, segments=["BA", "BC", "BD"])
    assert "false_given" not in kinds(problem, f)


# ── The statement to prove: true, and not marked ───────────────────────


PROVE = r"Given: $\overline{AB} \parallel \overline{CD}$. Prove: $\overline{AD} \cong \overline{BC}$."
PARALLELOGRAM = {"A": (0, 0), "B": (5, 0), "C": (6, 3), "D": (1, 3)}


def test_statement_to_prove_true() -> None:
    good = fig(points=PARALLELOGRAM, segments=["AB", "BC", "CD", "DA"], parallel_groups=[["AB", "CD"]])
    assert "false_prove" not in kinds(PROVE, good)
    trapezoid = {**PARALLELOGRAM, "C": (7, 3)}
    bad = fig(points=trapezoid, segments=["AB", "BC", "CD", "DA"], parallel_groups=[["AB", "CD"]])
    assert "false_prove" in kinds(PROVE, bad)


def test_statement_to_prove_not_marked() -> None:
    plain = fig(points=PARALLELOGRAM, segments=["AB", "BC", "CD", "DA"], parallel_groups=[["AB", "CD"]])
    assert "prove_marked" not in kinds(PROVE, plain)
    marked = fig(
        points=PARALLELOGRAM, segments=["AB", "BC", "CD", "DA"],
        parallel_groups=[["AB", "CD"]], tick_groups=[["AD", "BC"]],
    )
    assert "prove_marked" in kinds(PROVE, marked)


def test_hint_after_prove_is_not_the_statement() -> None:
    problem = PROVE + r" (Hint: first prove $\overline{AB} \cong \overline{CD}$.)"
    parts = parse_problem(problem)
    assert [r.kind for r in parts.prove] == ["eqlen"]


def test_step_figure_may_mark_what_the_step_derives() -> None:
    marked = fig(
        points=PARALLELOGRAM, segments=["AB", "BC", "CD", "DA"],
        parallel_groups=[["AB", "CD"]], tick_groups=[["AD", "BC"]],
    )
    assert "prove_marked" not in kinds(PROVE, marked, step_text="AD ≅ BC")


# ── Every mark is true ─────────────────────────────────────────────────


def test_tick_marks_true() -> None:
    assert "false_mark" not in kinds("", fig(points=SQUARE, segments=["AB", "CD"], tick_groups=[["AB", "CD"]]))
    bad = fig(points={**SQUARE, "D": (0, 5)}, segments=["AB", "CD"], tick_groups=[["AB", "CD"]])
    assert "false_mark" in kinds("", bad)


def test_angle_arcs_true() -> None:
    assert "false_mark" not in kinds("", fig(points=KITE, segments=["PQ", "PS", "PR"], arc_groups=[["QPR", "RPS"]]))
    bad = fig(points={**KITE, "S": (4, -2)}, segments=["PQ", "PS", "PR"], arc_groups=[["QPR", "RPS"]])
    assert "false_mark" in kinds("", bad)


def test_right_angle_box_true() -> None:
    assert "false_mark" not in kinds("", fig(points=SQUARE, segments=["AB", "AD"], right_angles=["BAD"]))
    bad = fig(points={**SQUARE, "D": (1, 4)}, segments=["AB", "AD"], right_angles=["BAD"])
    out = messages("", bad)
    assert any("right-angle mark on ∠BAD is on an angle drawn as 76°" in m for m in out), out


def test_parallel_arrows_true() -> None:
    assert "false_mark" not in kinds("", fig(points=SQUARE, segments=["AB", "DC"], parallel_groups=[["AB", "DC"]]))
    bad = fig(points={**SQUARE, "C": (4, 5)}, segments=["AB", "DC"], parallel_groups=[["AB", "DC"]])
    assert "false_mark" in kinds("", bad)


def test_parallel_arrows_on_named_lines() -> None:
    pts = {"_a": (0, 0), "_b": (5, 0), "_c": (0, 2), "_d": (5, 2)}
    lines = [{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}]
    assert "false_mark" not in kinds("", fig(points=pts, lines=lines, parallel_groups=[["m", "n"]]))
    bad = fig(points={**pts, "_d": (5, 3)}, lines=lines, parallel_groups=[["m", "n"]])
    assert "false_mark" in kinds("", bad)


# ── Nothing extra ──────────────────────────────────────────────────────


def test_extra_segment() -> None:
    problem = r"Given $\triangle ABC$."
    pts = {"A": (0, 0), "B": (4, 0), "C": (1, 3)}
    assert "extra" not in kinds(problem, fig(points=pts, segments=["AB", "BC", "CA"]))
    out = messages(problem, fig(points={**pts, "D": (3, 3)}, segments=["AB", "BC", "CA", "CD"]))
    assert "extra segment not in the problem: CD" in out


def test_extra_circle_arc_and_shading() -> None:
    problem = r"Given $\triangle ABC$."
    pts = {"A": (0, 0), "B": (4, 0), "C": (1, 3)}
    base: dict[str, Any] = {"points": pts, "segments": ["AB", "BC", "CA"]}
    assert "extra circle not in the problem" in messages(problem, fig(**base, circles=[{"center": "A", "radius": 1}]))
    arc = {"center": "A", "endpoints": ["B", "C"]}
    assert "extra arc not in the problem" in messages(problem, fig(**base, arcs=[arc]))
    assert "extra shading not in the problem" in messages(problem, fig(**base, shaded=[{"polygon": ["A", "B", "C"]}]))
    ok = (r"Given $\triangle ABC$. A circle with center $A$ passes through $B$ and $C$; "
          r"sector $BAC$ is shaded and arc $BC$ marked.")
    on = {"points": {"A": (0, 0), "B": (4, 0), "C": (0, 4)}, "segments": ["AB", "BC", "CA"],
          "circles": [{"center": "A", "through": "B"}]}
    assert "extra" not in kinds(
        ok, fig(**on, arcs=[{"center": "A", "endpoints": ["B", "C"]}],
                shaded=[{"sector": {"center": "A", "endpoints": ["B", "C"]}}]),
    )
    # "circle" alone allows no arc; shading only the region the problem shades.
    assert "extra arc not in the problem" in messages(
        r"A circle with center $A$ passes through $B$ and $C$.",
        fig(**on, arcs=[{"center": "A", "endpoints": ["B", "C"]}]))
    assert "the shading is not on the region the problem says is shaded" in messages(
        ok, fig(**on, shaded=[{"polygon": ["A", "B", "C"]}]))


def test_unnamed_problem_allows_any_piece() -> None:
    """"A diagonal is drawn" names no points: nothing to hold the pieces to."""
    problem = "A rectangle 24 by 7 has a diagonal drawn."
    f = fig(points={"A": (0, 0), "B": (24, 0), "C": (24, 7), "D": (0, 7)}, segments=["AB", "BC", "CD", "DA", "AC"])
    assert "extra" not in kinds(problem, f)


def test_radius_allowed_when_the_problem_is_about_a_radius() -> None:
    pts = {"A": (0, 10), "B": (0, 0), "C": (6, 0), "O": (3, 5)}
    f = fig(points=pts, segments=["AB", "BC", "CA", "OB"], circles=[{"center": "O", "through": "A"}])
    about_radius = r"Triangle $ABC$ is inscribed in a circle with center $O$. Find the circumradius."
    assert "extra" not in kinds(about_radius, f)
    not_about = r"Triangle $ABC$ is inscribed in a circle with center $O$. Find $AC$."
    assert "extra segment not in the problem: OB" in messages(not_about, f)


# ── Labels ─────────────────────────────────────────────────────────────


def test_angle_label_matches_drawing() -> None:
    problem = r"Given $m\angle ABC = 45°$."
    pts = {"A": (3, 3), "B": (0, 0), "C": (3, 0)}
    assert "label" not in kinds(problem, fig(points=pts, segments=["BA", "BC"], angle_labels={"ABC": "45°"}))
    out = messages(problem, fig(points={**pts, "A": (2, 3)}, segments=["BA", "BC"], angle_labels={"ABC": "45°"}))
    assert any("the label '45°' on ∠ABC does not match the drawing" in m for m in out), out


def test_label_number_must_come_from_the_problem() -> None:
    problem = r"Find $m\angle ABC$."
    pts = {"A": (3, 3), "B": (0, 0), "C": (3, 0)}
    out = messages(problem, fig(points=pts, segments=["BA", "BC"], angle_labels={"ABC": "45°"}))
    assert "the label '45°' on ∠ABC shows 45, which the problem doesn't give for ∠ABC" in out


def test_label_giving_away_the_answer() -> None:
    problem = r"Find $m\angle ABC$."
    pts = {"A": (3, 3), "B": (0, 0), "C": (3, 0)}
    f = fig(points=pts, segments=["BA", "BC"], angle_labels={"ABC": "45°"})
    out = messages(problem, f, final_answer="$45°$")
    assert "the label '45°' on ∠ABC gives away the answer" in out


def test_ninety_allowed_on_a_right_angle() -> None:
    problem = r"$\overline{AB} \perp \overline{BC}$."
    f = fig(points={"A": (0, 3), "B": (0, 0), "C": (3, 0)}, segments=["BA", "BC"], angle_labels={"ABC": "90°"})
    assert "label" not in kinds(problem, f)


def test_variable_label_allowed() -> None:
    problem = r"$m\angle ABC = 2x + 5$. Find $x$."
    f = fig(points={"A": (3, 3), "B": (0, 0), "C": (3, 0)}, segments=["BA", "BC"], angle_labels={"ABC": "2x + 5"})
    assert "label" not in kinds(problem, f)


def test_lengths_in_proportion() -> None:
    problem = r"$AB = 6$ and $BC = 8$."
    pts = {"A": (0, 3), "B": (0, 0), "C": (4, 0)}
    good = fig(points=pts, segments=["AB", "BC"], side_labels={"AB": "6", "BC": "8"})
    assert "label" not in kinds(problem, good)
    bad = fig(points={**pts, "C": (5, 0)}, segments=["AB", "BC"], side_labels={"AB": "6", "BC": "8"})
    assert "the lengths AB = 6, BC = 8 are not in proportion in the drawing" in messages(problem, bad)


def test_lengths_given_in_text_count_without_labels() -> None:
    problem = r"$AB = 6$ and $BC = 8$."
    bad = fig(points={"A": (0, 3), "B": (0, 0), "C": (5, 0)}, segments=["AB", "BC"])
    assert "label" in kinds(problem, bad)


def test_named_length_label() -> None:
    """'c = 13' is the length 13, on a side the problem calls c without
    naming its points (the reading's length of an unnamed side)."""
    from api.core.geometry.facts import Fact, FigureFacts

    problem = "The hypotenuse has length $c = 13$ and a leg $a = 5$."
    facts = FigureFacts(givens=[
        Fact(kind="equal_length", value=13, quote="c = 13"), Fact(kind="equal_length", value=5, quote="a = 5"),
    ])
    pts = {"A": (0, 0), "B": (5, 0), "C": (5, 12)}
    good = fig(points=pts, segments=["AB", "BC", "CA"], side_labels={"CA": "c = 13", "AB": "a = 5"})
    assert "label" not in kinds(problem, good, facts=facts)
    bad = fig(points=pts, segments=["AB", "BC", "CA"], side_labels={"AB": "c = 13", "BC": "a = 5"})
    assert "label" in kinds(problem, bad, facts=facts)
    # A letter the problem doesn't use is no name for a side.
    other = fig(points=pts, segments=["AB", "BC", "CA"], side_labels={"CA": "q = 13", "AB": "a = 5"})
    assert "the label 'q = 13' on CA names q, which the problem doesn't call that side" in messages(
        problem, other, facts=facts)


def test_bare_integer_label_names_a_numbered_angle() -> None:
    """A bare "1" names ∠1 only when the problem numbers that angle; any
    other bare integer is a number (review round 1: "or the problem numbers
    any angle" let '115', the answer, through as a name)."""
    problem = r"$\angle 1$ and $\angle 3$ are vertical angles."
    pts = {"A": (-2, -1), "O": (0, 0), "B": (2, 1), "C": (-2, 1), "D": (2, -1)}
    lines = [{"through": ["A", "B"]}, {"through": ["C", "D"]}]
    assert "label" not in kinds(problem, fig(points=pts, lines=lines, angle_labels={"AOC": "1", "BOD": "3"}))
    out = messages(problem, fig(points=pts, lines=lines, angle_labels={"AOC": "1", "BOD": "3", "COB": "2"}))
    assert "the label '2' on ∠COB shows 2, which the problem doesn't give for ∠COB" in out


# ── Step figures ───────────────────────────────────────────────────────


def test_step_figure_keeps_the_questions_points() -> None:
    problem = r"Given $\overline{AB} \parallel \overline{CD}$."
    base = fig(points=SQUARE, segments=["AB", "CD"])
    same = fig(points=SQUARE, segments=["AB", "CD", "AC"])
    assert "moved" not in kinds(problem, same, step_text="Draw AC.", base=base)
    moved = fig(points={**SQUARE, "C": (4.5, 4)}, segments=["AB", "CD", "AC"])
    out = messages(problem, moved, step_text="Draw AC.", base=base)
    assert "point C is not where the question's figure puts it" in out


def test_step_figure_keeps_what_the_question_draws() -> None:
    problem = r"Given $\overline{AB} \parallel \overline{CD}$."
    base = fig(points=SQUARE, segments=["AB", "CD", "BC"])
    dropped = fig(points=SQUARE, segments=["AB", "CD"])
    out = messages(problem, dropped, step_text="Use the parallel sides.", base=base)
    assert "the step's figure leaves out BC, which the question's figure draws" in out


def test_step_text_parts_must_be_drawn() -> None:
    problem = r"Given $\overline{AB} \parallel \overline{CD}$."
    f = fig(points=SQUARE, segments=["AB", "CD"])
    out = messages(problem, f, step_text=r"Draw $\overline{AC}$.", base=f)
    assert "not drawn: AC" in out


# ── Marks no given backs (removed, not rejected) ───────────────────────


def test_derived_marks_are_unbacked() -> None:
    """Alternate interior angles marked on a proof's figure hand over a step."""
    problem = (
        r"Given $\overline{BC} \cong \overline{DA}$, $\overline{BC} \parallel \overline{AD}$. "
        r"Prove $\triangle ABC \cong \triangle CDA$."
    )
    pts = {"A": (0, 0), "B": (2, 3), "C": (7, 3), "D": (5, 0)}
    f = fig(
        points=pts, segments=["AB", "BC", "CD", "DA", "AC"],
        tick_groups=[["BC", "DA"]], parallel_groups=[["BC", "DA"]], arc_groups=[["BCA", "DAC"]],
    )
    assert unbacked_marks(f, problem) == {"arc_groups": [0]}


def test_marks_backed_by_givens_are_kept() -> None:
    problem = (
        r"$M$ is the midpoint of $\overline{XY}$, $\overline{PR}$ bisects $\angle QPS$, "
        r"$\triangle ABC \cong \triangle DEF$."
    )
    pts = {
        "X": (0, 0), "M": (2, 0), "Y": (4, 0),
        "P": (0, 5), "Q": (4, 8), "R": (8, 5), "S": (4, 2),
        "A": (10, 0), "B": (13, 0), "C": (10, 2), "D": (15, 0), "E": (18, 0), "F": (15, 2),
    }
    f = fig(
        points=pts,
        segments=["XY", "PQ", "PR", "PS", "AB", "BC", "CA", "DE", "EF", "FD"],
        tick_groups=[["XM", "MY"], ["AB", "DE"]],
        arc_groups=[["QPR", "RPS"], ["BAC", "EDF"]],
    )
    assert unbacked_marks(f, problem) == {}


def test_mark_groups_tie_at_least_two_parts() -> None:
    """An empty or one-part group claims nothing; it is malformed (review
    round 1: an empty group crashed the step checks with max([]))."""
    base: dict[str, Any] = {
        "points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (2, 2)}, "segments": ["BA", "BC", "BD"],
    }
    for name in ("tick_groups", "arc_groups", "parallel_groups"):
        for group in ([], ["BD"]):
            with pytest.raises(ValidationError):
                fig(**base, **{name: [group]})


def test_parallel_arrows_backed_by_named_lines() -> None:
    problem = "Lines $m \\parallel n$ are cut by transversal $t$."
    pts = {"_a": (0, 0), "_b": (5, 0), "_c": (0, 2), "_d": (5, 2), "_e": (1, -1), "_f": (3, 3)}
    lines = [
        {"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]},
        {"name": "t", "through": ["_e", "_f"]},
    ]
    assert unbacked_marks(fig(points=pts, lines=lines, parallel_groups=[["m", "n"]]), problem) == {}
    assert unbacked_marks(fig(points=pts, lines=lines, parallel_groups=[["m", "t"]]), "Line $m$, $n$, $t$.") == {
        "parallel_groups": [0],
    }

# ── Review round 1 ─────────────────────────────────────────────────────
#
# Each test below failed (the figure passed, the claim was wrong, or the
# checker crashed) before the round-1 fix it names; each was checked to
# fail again with that fix reverted.


def test_round1_bare_integer_answer_label_is_caught() -> None:
    """Finding 2: '115' (the answer) passed as an angle's name because the
    problem numbers ∠1."""
    problem = r"$\angle 1$ and $\angle AOC$ form a linear pair. $m\angle 1 = 65^\circ$. Find $m\angle AOC$."
    c = (3 + 3 * 0.42261826, 3 * 0.90630779)  # 65° from OB
    f = fig(points={"A": (0, 0), "B": (6, 0), "O": (3, 0), "C": c}, segments=["AB", "OC"],
            angle_labels={"COB": "1", "AOC": "115"})
    out = messages(problem, f, final_answer=r"115^\circ")
    assert any("'115'" in m and "gives away the answer" in m for m in out), out


RHOMBUS_DIAGONALS = {"A": (0, 0), "B": (3, -2), "C": (6, 0), "D": (3, 2), "E": (3, 0)}


def test_round1_box_on_a_perpendicular_to_prove() -> None:
    """Finding 5: a box where the diagonals cross marks "AC ⊥ BD"."""
    base: dict[str, Any] = {"points": RHOMBUS_DIAGONALS, "segments": ["AB", "BC", "CD", "DA", "AC", "BD"]}
    for problem in (
        r"Given $\overline{AB} \cong \overline{BC} \cong \overline{CD} \cong \overline{DA}$. "
        r"Prove: $\overline{AC} \perp \overline{BD}$.",
        r"Given $\overline{AB} \cong \overline{BC} \cong \overline{CD} \cong \overline{DA}$, $E$ lies on "
        r"$\overline{AC}$ and $\overline{BD}$. Prove: $m\angle AEB = 90^\circ$.",
    ):
        assert "prove_marked" not in kinds(problem, fig(**base)), messages(problem, fig(**base))
        assert "prove_marked" in kinds(problem, fig(**base, right_angles=["AEB"])), problem


def test_round1_unbacked_right_angle_box_is_removed() -> None:
    """Finding 5: a box no given states is removed like other unbacked marks."""
    pts = {"A": (0, 3), "B": (0, 0), "C": (4, 0)}
    boxed = fig(points=pts, segments=["AB", "BC", "CA"], right_angles=["ABC"])
    assert unbacked_marks(boxed, r"Given $\triangle ABC$. Find $AC$.") == {"right_angles": [0]}
    for backed in (r"In $\triangle ABC$, $m\angle B = 90°$.", r"$\overline{AB} \perp \overline{BC}$.",
                   r"$\triangle ABC$ has a right angle at $B$."):
        assert unbacked_marks(boxed, backed) == {}, backed


def test_round1_givens_marked_only_when_all_are() -> None:
    """Finding 7 (the checker side): every markable given is marked."""
    problem = (r"Given $\overline{AB} \parallel \overline{CD}$ and $\overline{AB} \cong \overline{CD}$. "
               r"Prove $\overline{AD} \cong \overline{BC}$.")
    base: dict[str, Any] = {"points": PARALLELOGRAM, "segments": ["AB", "BC", "CD", "DA"]}
    assert givens_marked(fig(**base, parallel_groups=[["AB", "CD"]], tick_groups=[["AB", "CD"]]), problem)
    assert not givens_marked(fig(**base, parallel_groups=[["AB", "CD"]]), problem)
    assert not givens_marked(fig(**base), "Find AB.")


def test_round1_ray_direction_and_kind_matter() -> None:
    """Finding 10: a reversed ray, a segment or a line is not a named ray; a
    segment is not a named line."""
    problem = r"Draw $\overrightarrow{AB}$ and $\overleftrightarrow{AC}$."
    pts = {"A": (0, 0), "B": (4, 0), "C": (2, 3)}
    good = fig(points=pts, rays=["AB"], lines=[{"through": ["A", "C"]}])
    assert messages(problem, good) == []
    for bad in (
        fig(points=pts, rays=["BA"], lines=[{"through": ["A", "C"]}]),
        # From A, but pointing away from B.
        fig(points={**pts, "_w": (-4, 0)}, rays=["A_w"], lines=[{"through": ["A", "C"]}]),
        fig(points=pts, segments=["AB"], lines=[{"through": ["A", "C"]}]),
        fig(points=pts, lines=[{"through": ["A", "B"]}, {"through": ["A", "C"]}]),
    ):
        assert "not drawn: ray AB" in messages(problem, bad)
    assert "not drawn: line AC" in messages(problem, fig(points=pts, rays=["AB"], segments=["AC"]))
    # An angle's arm is still drawn by a segment.
    assert messages(r"Find $m\angle BAC$.", fig(points=pts, segments=["AB", "AC"])) == []


def test_round1_marks_sit_on_drawn_angles() -> None:
    """Found by eye (29be9c15): a label on ∠CEF, whose side EC isn't drawn."""
    problem = "Lines $p$ and $q$ are parallel. A transversal forms alternate interior angles."
    pts = {"A": (1, 6), "B": (9, 6), "C": (1, 2), "D": (9, 2), "E": (3, 6), "F": (7, 2)}
    lines = [{"name": "p", "through": ["A", "B"]}, {"name": "q", "through": ["C", "D"]}, {"through": ["E", "F"]}]
    on_drawn = fig(points=pts, lines=lines, angle_labels={"BEF": "1", "EFC": "2"})
    assert not any("isn't drawn" in m for m in messages(problem, on_drawn))
    off = fig(points=pts, lines=lines, angle_labels={"CEF": "1"}, arc_groups=[["CEF", "EFD"]], right_angles=["CEF"])
    out = messages(problem, off)
    for kind in ("label", "arc", "right-angle mark"):
        assert f"the {kind} on ∠CEF sits on an angle whose side EC isn't drawn" in out, out


def test_round1_mark_group_cant_repeat_a_part() -> None:
    """Found by eye (d9f94a62): tick_groups [["BD", "BD"]] drew one lone tick."""
    base: dict[str, Any] = {"points": {"A": (0, 0), "B": (4, 5), "C": (8, 0), "D": (4, 0)},
                            "segments": ["AB", "BC", "AC", "BD"]}
    for marks in ({"tick_groups": [["BD", "DB"]]}, {"arc_groups": [["ABD", "DBA"]]},
                  {"parallel_groups": [["AC", "CA"]]}):
        with pytest.raises(ValidationError):
            fig(**base, **marks)
