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
    f = fig(points={"A": (0, 0), "M": (2, 0), "B": (4, 0)}, segments=["AM", "MB"])
    assert messages(problem, f) == []


def test_triangle_in_words_needs_its_sides() -> None:
    problem = "Triangle $ABC$ has a right angle at $B$."
    pts = {"A": (0, 3), "B": (0, 0), "C": (4, 0)}
    assert parse_problem(problem).segments == {frozenset("AB"), frozenset("BC"), frozenset("CA")}
    assert messages(problem, fig(points=pts, segments=["AB", "BC", "CA"])) == []
    assert "not drawn: AC" in messages(problem, fig(points=pts, segments=["AB", "BC"]))


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
    assert messages(problem, fig(points=pts, lines=lines)) == []
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


def test_an_angle_the_drawing_cant_decide_fails_closed() -> None:
    """∠B with three strokes at B is ambiguous: the checker can't measure
    it, so it can't confirm the figure (review round 1: fail closed)."""
    problem = r"Given $\angle B = 50°$."
    f = fig(points={"A": (0, 3), "B": (0, 0), "C": (4, 0), "D": (3, 3)}, segments=["BA", "BC", "BD"])
    assert "false_given" not in kinds(problem, f)
    assert "the checker can't measure the given ∠B = 50° in the drawing" in messages(problem, f)
    # In a named triangle, ∠B is the triangle's angle at B.
    named = r"In $\triangle ABC$, $\angle B = 90°$ and $\overline{BD}$ is drawn."
    tri = fig(points={"A": (0, 3), "B": (0, 0), "C": (4, 0), "D": (2, 1.5)}, segments=["BA", "BC", "CA", "BD"])
    assert messages(named, tri) == []


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
    ok = r"Given $\triangle ABC$. A circle with center $A$ passes through $B$; the shaded sector is between arc $BC$."
    assert "extra" not in kinds(
        ok, fig(**base, circles=[{"center": "A", "through": "B"}], arcs=[{"center": "A", "endpoints": ["B", "C"]}],
                shaded=[{"sector": {"center": "A", "endpoints": ["B", "C"]}}]),
    )


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
    assert "the label '45°' shows 45, which is not a number in the problem" in out


def test_label_giving_away_the_answer() -> None:
    problem = r"Find $m\angle ABC$."
    pts = {"A": (3, 3), "B": (0, 0), "C": (3, 0)}
    f = fig(points=pts, segments=["BA", "BC"], angle_labels={"ABC": "45°"})
    out = messages(problem, f, final_answer="$45°$")
    assert "the label '45°' gives away the answer (45 is not in the problem)" in out


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
    """'c = 13' is the length 13."""
    problem = "The hypotenuse has length $c = 13$ and a leg $a = 5$."
    pts = {"A": (0, 0), "B": (5, 0), "C": (5, 12)}
    good = fig(points=pts, segments=["AB", "BC", "CA"], side_labels={"CA": "c = 13", "AB": "a = 5"})
    assert "label" not in kinds(problem, good)
    bad = fig(points=pts, segments=["AB", "BC", "CA"], side_labels={"AB": "c = 13", "BC": "a = 5"})
    assert "label" in kinds(problem, bad)


def test_bare_integer_label_names_a_numbered_angle() -> None:
    """A bare "1" names ∠1 only when the problem numbers that angle; any
    other bare integer is a number (review round 1: "or the problem numbers
    any angle" let '115', the answer, through as a name)."""
    problem = r"$\angle 1$ and $\angle 3$ are vertical angles."
    pts = {"A": (-2, -1), "O": (0, 0), "B": (2, 1), "C": (-2, 1), "D": (2, -1)}
    lines = [{"through": ["A", "B"]}, {"through": ["C", "D"]}]
    assert "label" not in kinds(problem, fig(points=pts, lines=lines, angle_labels={"AOC": "1", "BOD": "3"}))
    out = messages(problem, fig(points=pts, lines=lines, angle_labels={"AOC": "1", "BOD": "3", "COB": "2"}))
    assert "the label '2' shows 2, which is not a number in the problem" in out


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
    base: dict[str, Any] = {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (2, 2)}, "segments": ["BA", "BC", "BD"]}
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


# ── Review round 1: the checker fails closed ───────────────────────────
#
# Each test below failed (the figure passed, or the checker crashed) before
# the round-1 fix it names; each was checked to fail again with that fix
# reverted.

EQUILATERAL_C = (3, 5.196152)
GIVENS_R1 = [
    # Similar triangles (∼, ~, in words): corresponding angles equal.
    *(
        (
            text,
            {"points": {"A": (0, 0), "B": (4, 0), "C": (1, 3), "D": (6, 0), "E": (14, 0), "F": (8, 6)},
             "segments": ["AB", "BC", "CA", "DE", "EF", "FD"]},
            {"points": {"A": (0, 0), "B": (4, 0), "C": (1, 3), "D": (6, 0), "E": (14, 0), "F": (9, 2)},
             "segments": ["AB", "BC", "CA", "DE", "EF", "FD"]},
        )
        for text in (
            r"Given $\triangle ABC \sim \triangle DEF$.",
            r"Given $\triangle ABC$ ~ $\triangle DEF$.",
            "Triangles ABC and DEF are similar.",
        )
    ),
    (
        r"Equilateral $\triangle ABC$ has side length 6.",
        {"points": {"A": (0, 0), "B": (6, 0), "C": EQUILATERAL_C}, "segments": ["AB", "BC", "CA"]},
        {"points": {"A": (0, 0), "B": (6, 0), "C": (3, 4)}, "segments": ["AB", "BC", "CA"]},
    ),
    *(
        (
            text,
            {"points": {"A": (2, 4), "B": (0, 0), "C": (4, 0)}, "segments": ["AB", "BC", "CA"]},
            # Isosceles, but with apex B: the stated base / legs / apex is wrong.
            {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0)}, "segments": ["AB", "BC", "CA"]},
        )
        for text in (
            r"$\triangle ABC$ is isosceles with base $\overline{BC}$.",
            r"Isosceles triangle ABC has legs $\overline{AB}$ and $\overline{AC}$.",
            r"Isosceles $\triangle ABC$ with base angles $\angle B$ and $\angle C$.",
            r"Isosceles $\triangle ABC$ with vertex angle $A$.",
        )
    ),
    (
        "Isosceles triangle ABC.",
        {"points": {"A": (2, 4), "B": (0, 0), "C": (4, 0)}, "segments": ["AB", "BC", "CA"]},
        {"points": {"A": (1, 4), "B": (0, 0), "C": (4, 0)}, "segments": ["AB", "BC", "CA"]},
    ),
    (
        "ABCD is a parallelogram.",
        {"points": {"A": (0, 0), "B": (5, 0), "C": (6, 3), "D": (1, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
        {"points": {"A": (0, 0), "B": (5, 0), "C": (7, 3), "D": (1, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
    ),
    (
        "Rectangle $ABCD$ has $AB = 6$.",
        {"points": {"A": (0, 0), "B": (6, 0), "C": (6, 3), "D": (0, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
        {"points": {"A": (0, 0), "B": (6, 0), "C": (6, 3), "D": (0.5, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
    ),
    (
        "Square ABCD.",
        {"points": SQUARE, "segments": ["AB", "BC", "CD", "DA"]},
        {"points": {**SQUARE, "C": (4, 3), "D": (0, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
    ),
    (
        "ABCD is a rhombus.",
        {"points": {"A": (0, 0), "B": (5, 0), "C": (8, 4), "D": (3, 4)}, "segments": ["AB", "BC", "CD", "DA"]},
        {"points": {"A": (0, 0), "B": (5, 0), "C": (6, 3), "D": (1, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
    ),
    (
        "Trapezoid ABCD.",
        {"points": {"A": (0, 0), "B": (6, 0), "C": (4, 3), "D": (1, 3)}, "segments": ["AB", "BC", "CD", "DA"]},
        {"points": {"A": (0, 0), "B": (6, 0), "C": (4, 3), "D": (0, 4)}, "segments": ["AB", "BC", "CD", "DA"]},
    ),
    (
        "PQRS is a kite.",
        {"points": KITE, "segments": ["PQ", "QR", "RS", "SP"]},
        {"points": {**KITE, "S": (5, -2)}, "segments": ["PQ", "QR", "RS", "SP"]},
    ),
    (
        r"In $\triangle ABC$, $\overline{AD}$ is perpendicular to $\overline{BC}$ at $D$.",
        {"points": {"A": (3, 4), "B": (0, 0), "C": (6, 0), "D": (3, 0)}, "segments": ["AB", "AC", "BC", "AD"]},
        {"points": {"A": (2, 4), "B": (0, 0), "C": (6, 0), "D": (3, 0)}, "segments": ["AB", "AC", "BC", "AD"]},
    ),
    *(
        (
            text,
            {"points": {"A": (0, 3), "B": (4, 0), "C": (0, 0)}, "segments": ["AB", "BC", "CA"]},
            {"points": {"A": (0, 3), "B": (4, 0), "C": (1, 0)}, "segments": ["AB", "BC", "CA"]},
        )
        for text in (
            r"In $\triangle ABC$, $\angle C$ is a right angle.",
            r"$\triangle ABC$ is a right triangle with right angle $C$.",
            "In triangle ABC there is a RIGHT ANGLE AT C.",
            r"$\triangle ABC$ is a right triangle.",
        )
    ),
    (
        r"$\overline{PA}$ is tangent to circle $O$ at $A$.",
        {"points": {"O": (0, 0), "A": (3, 0), "P": (3, 4)}, "segments": ["PA"], "circles": [{"center": "O", "through": "A"}]},
        {"points": {"O": (0, 0), "A": (3, 0), "P": (4, 3)}, "segments": ["PA"], "circles": [{"center": "O", "through": "A"}]},
    ),
    (
        "Points $A$, $B$, and $C$ lie on circle $O$.",
        {"points": {"O": (0, 0), "A": (3, 0), "B": (0, 3), "C": (-3, 0)}, "circles": [{"center": "O", "through": "A"}]},
        {"points": {"O": (0, 0), "A": (3, 0), "B": (0, 2), "C": (-3, 0)}, "circles": [{"center": "O", "through": "A"}]},
    ),
    (
        r"In $\triangle ABC$, BD bisects $\angle ABC$ and D lies on AC.",
        {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (2, 2)}, "segments": ["AB", "BC", "CA", "BD"]},
        {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (3, 1)}, "segments": ["AB", "BC", "CA", "BD"]},
    ),
    (
        r"Given: segment AB $\cong$ segment CD.",
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (3, 2)}, "segments": ["AB", "CD"]},
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "D": (4, 2)}, "segments": ["AB", "CD"]},
    ),
    (
        r"Given $\triangle ABC \cong \triangle A^{\prime}B^{\prime}C^{\prime}$.",
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "A'": (5, 0), "B'": (8, 0), "C'": (5, 2)},
         "segments": ["AB", "BC", "CA", "A'B'", "B'C'", "C'A'"]},
        {"points": {"A": (0, 0), "B": (3, 0), "C": (0, 2), "A'": (5, 0), "B'": (8, 0), "C'": (5, 3)},
         "segments": ["AB", "BC", "CA", "A'B'", "B'C'", "C'A'"]},
    ),
    (
        r"Given $\overline{AB} \cong \overline{A^\prime B^\prime}$.",
        {"points": {"A": (0, 0), "B": (3, 0), "A'": (0, 2), "B'": (3, 2)}, "segments": ["AB", "A'B'"]},
        {"points": {"A": (0, 0), "B": (3, 0), "A'": (0, 2), "B'": (4, 2)}, "segments": ["AB", "A'B'"]},
    ),
    (
        # Measures given as algebra, tied by a linear pair: x = 36.
        r"$\angle 1$ and $\angle 2$ are a linear pair, $m\angle 1 = 3x$ and $m\angle 2 = 2x$.",
        {"points": {"A": (-3, 0), "O": (0, 0), "B": (3, 0), "C": (-0.927051, 2.853170)},
         "segments": ["AB", "OC"], "angle_labels": {"COB": "1", "AOC": "2"}},
        {"points": {"A": (-3, 0), "O": (0, 0), "B": (3, 0), "C": (2, 3)},
         "segments": ["AB", "OC"], "angle_labels": {"COB": "1", "AOC": "2"}},
    ),
    (
        r"$M$ and $N$ are the midpoints of $\overline{AB}$ and $\overline{AC}$.",
        {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "M": (0, 2), "N": (2, 2)}, "segments": ["AB", "AC"]},
        {"points": {"A": (0, 4), "B": (0, 0), "C": (4, 0), "M": (0, 2), "N": (2.5, 1.5)}, "segments": ["AB", "AC"]},
    ),
    (
        r"$\overline{AC}$ and $\overline{BD}$ intersect at $E$.",
        {"points": {**SQUARE, "E": (2, 2)}, "segments": ["AC", "BD"]},
        {"points": {**SQUARE, "E": (2, 2.5)}, "segments": ["AC", "BD"]},
    ),
    (
        r"$\angle ABC$ and $\angle DEF$ are supplementary.",
        {"points": {"A": (1, 1.732051), "B": (0, 0), "C": (2, 0), "D": (5, 1.732051), "E": (6, 0), "F": (8, 0)},
         "segments": ["BA", "BC", "ED", "EF"]},
        {"points": {"A": (1, 1.732051), "B": (0, 0), "C": (2, 0), "D": (5.5, 1.732051), "E": (6, 0), "F": (8, 0)},
         "segments": ["BA", "BC", "ED", "EF"]},
    ),
    (
        "Lines $p$ and $q$ are perpendicular.",
        {"points": {"_a": (0, 0), "_b": (5, 0), "_c": (2, -2), "_d": (2, 3)},
         "lines": [{"name": "p", "through": ["_a", "_b"]}, {"name": "q", "through": ["_c", "_d"]}]},
        {"points": {"_a": (0, 0), "_b": (5, 0), "_c": (2, -2), "_d": (3, 3)},
         "lines": [{"name": "p", "through": ["_a", "_b"]}, {"name": "q", "through": ["_c", "_d"]}]},
    ),
]


@pytest.mark.parametrize(("problem", "good", "bad"), GIVENS_R1, ids=[g[0][:48] for g in GIVENS_R1])
def test_round1_given_read_and_true_in_drawing(problem: str, good: dict[str, Any], bad: dict[str, Any]) -> None:
    """Finding 1: each of these givens passed a wrong figure silently."""
    assert messages(problem, fig(**good)) == []
    assert "false_given" in kinds(problem, fig(**bad)), messages(problem, fig(**bad))


@pytest.mark.parametrize("problem", [
    r"Circle $O$ is inscribed in $\triangle ABC$.",  # an incircle: no parser for it yet
    "The two lines are parallel.",
    r"$\overline{AB}$ is the altitude, so $\overline{AB}$ is perpendicular to the base.",
])
def test_round1_unread_relation_fails_closed(problem: str) -> None:
    """Finding 1: a relation word no parser read is an issue, never a pass."""
    f = fig(points={"A": (0, 0), "B": (4, 0), "C": (1, 3), "O": (1.5, 1)}, segments=["AB", "BC", "CA"],
            circles=[{"center": "O", "radius": 1}])
    assert "unread" in kinds(problem, f), messages(problem, f)


def test_round1_back_references_and_units_are_not_unread() -> None:
    """"the rectangle" after "Rectangle ABCD" is read; "square units" is a unit."""
    problem = "Rectangle ABCD has AB = 6 and BC = 3. Find the area of the rectangle in square units."
    f = fig(points={"A": (0, 0), "B": (6, 0), "C": (6, 3), "D": (0, 3)}, segments=["AB", "BC", "CD", "DA"])
    assert parse_problem(problem).unread == []
    assert messages(problem, f) == []
    # A back-reference to a relation that isn't a shape ("the tangent").
    tangent = r"$\overline{PA}$ is tangent to circle $O$ at $A$. Find the length of the tangent."
    assert parse_problem(tangent).unread == []


def test_round1_unnamed_shape_is_checked_on_the_drawing() -> None:
    """"the right triangle below" with no names: some drawn triangle must be one."""
    problem = "Find the hypotenuse of the right triangle below."
    right = fig(points={"A": (0, 3), "B": (0, 0), "C": (4, 0)}, segments=["AB", "BC", "CA"])
    assert messages(problem, right) == []
    oblique = fig(points={"A": (1, 3), "B": (0, 0), "C": (4, 0)}, segments=["AB", "BC", "CA"])
    assert "false_given" in kinds(problem, oblique)


def test_round1_points_a_relation_names_must_be_drawn() -> None:
    """Bare "AB ∥ CD" names C and D: a figure without them can't pass."""
    problem = "Given AB ∥ CD."
    out = messages(problem, fig(points={"A": (0, 0), "B": (4, 0), "C": (0, 2)}, segments=["AB"]))
    assert "missing point: D" in out


def test_round1_bare_integer_answer_label_is_caught() -> None:
    """Finding 2: '115' (the answer) passed as an angle's name because the
    problem numbers ∠1."""
    problem = r"$\angle 1$ and $\angle AOC$ form a linear pair. $m\angle 1 = 65^\circ$. Find $m\angle AOC$."
    c = (3 + 3 * 0.42261826, 3 * 0.90630779)  # 65° from OB
    f = fig(points={"A": (0, 0), "B": (6, 0), "O": (3, 0), "C": c}, segments=["AB", "OC"],
            angle_labels={"COB": "1", "AOC": "115"})
    out = messages(problem, f, final_answer=r"115^\circ")
    assert any("'115'" in m and "gives away the answer" in m for m in out), out


def test_round1_answer_label_on_the_asked_for_angle() -> None:
    """Finding 3: the answer is also a number in the problem (65 = 65)."""
    import math

    problem = r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$ and $m\angle B = 65^\circ$. Find $m\angle C$."
    a = (3, 3 * math.tan(math.radians(65)))
    pts = {"A": a, "B": (0, 0), "C": (6, 0)}
    leak = fig(points=pts, segments=["AB", "BC", "CA"], angle_labels={"ABC": "65°", "BCA": "65°"})
    assert "the label '65°' on ∠BCA gives away the answer (the problem asks for it)" in messages(problem, leak)
    ok = fig(points=pts, segments=["AB", "BC", "CA"], angle_labels={"ABC": "65°", "BCA": "x"})
    assert messages(problem, ok) == []
    side = r"In $\triangle ABC$, $\overline{AB} \cong \overline{BC}$ and $AB = 5$. Find $BC$."
    tri = fig(points={"A": (0, 0), "B": (3, 4), "C": (6, 0)}, segments=["AB", "BC", "CA"], side_labels={"AB": "5", "BC": "5"})
    assert "the label '5' on BC gives away the answer (the problem asks for it)" in messages(side, tri)


@pytest.mark.parametrize("lead", ["Show that", "Explain why", "Justify that", "Verify that", "Demonstrate that",
                                  "SHOW THAT", "prove that", "Prove:"])
def test_round1_statement_to_prove_in_other_words(lead: str) -> None:
    """Finding 4: "Show that ..." was read as a given, so marking it passed."""
    problem = rf"Given: $\overline{{AB}} \parallel \overline{{CD}}$. {lead} $\overline{{AD}} \cong \overline{{BC}}$."
    parts = parse_problem(problem)
    assert [r.kind for r in parts.prove] == ["eqlen"] and [r.kind for r in parts.givens] == ["par"]
    marked = fig(points=PARALLELOGRAM, segments=["AB", "BC", "CD", "DA"], parallel_groups=[["AB", "CD"]],
                 tick_groups=[["AD", "BC"]])
    assert "prove_marked" in kinds(problem, marked)


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
                   r"Right $\triangle ABC$.", "Find the hypotenuse of the right triangle below."):
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


def test_round1_only_the_implied_transversal_is_allowed() -> None:
    """Finding 11: "a transversal" allowed any extra piece at all."""
    problem = r"$\overline{AB} \parallel \overline{CD}$ are cut by a transversal."
    pts = {"A": (0, 0), "B": (6, 0), "C": (0, 3), "D": (6, 3), "E": (1, -1), "F": (4, 4), "G": (5, -1), "H": (2, 4)}
    one = fig(points=pts, segments=["AB", "CD", "EF"])
    assert messages(problem, one) == []
    two = fig(points=pts, segments=["AB", "CD", "EF", "GH"])
    assert "extra segment not in the problem: GH" in messages(problem, two)
    assert "extra" not in kinds(problem.replace("a transversal", "two transversals"), two)
    # The one allowed piece must actually cut the parallels.
    aside = fig(points={**pts, "I": (8, 0.5), "J": (9, 2.5)}, segments=["AB", "CD", "IJ"])
    assert "extra segment not in the problem: IJ" in messages(problem, aside)
    assert "not drawn: the transversal" in messages(problem, aside)  # IJ runs aslant but cuts nothing


def test_round1_unnamed_problem_flags_a_loose_piece() -> None:
    """Finding 11: a problem naming no points allowed any piece; a piece
    apart from the figure is extra."""
    problem = "A rectangle 24 by 7 has a diagonal drawn."
    pts = {"A": (0, 0), "B": (24, 0), "C": (24, 7), "D": (0, 7), "_p": (30, 2), "_q": (34, 6)}
    f = fig(points=pts, segments=["AB", "BC", "CD", "DA", "AC", "_p_q"])
    assert "extra segment not in the problem: pq" in messages(problem, f)


def _polar(r: float, deg: float, at: tuple[float, float] = (0, 0)) -> tuple[float, float]:
    import math

    return (at[0] + r * math.cos(math.radians(deg)), at[1] + r * math.sin(math.radians(deg)))


def test_round1_angle_algebra_through_opposite_rays_and_bisectors() -> None:
    """Found by eye in the round-1 eval (985bff41, 05b4947e): measures given
    as algebra were never solved, so any spread of the rays passed."""
    rays = ["OA", "OD", "OB", "OC"]
    labels = {"AOB": "2x + 5", "BOC": "x + 8", "COD": "3x − 1"}
    problem = (r"$\overrightarrow{OA}$ and $\overrightarrow{OD}$ are opposite rays, $m\angle AOB = 2x + 5$, "
               r"$m\angle BOC = x + 8$, and $m\angle COD = 3x - 1$.")  # x = 28: 61°, 36°, 83°
    good = fig(points={"O": (0, 0), "A": (-6, 0), "D": (6, 0), "B": _polar(6, 119), "C": _polar(6, 83)},
               rays=rays, angle_labels=labels)
    assert messages(problem, good) == []
    drawn = fig(points={"O": (0, 0), "A": (-6, 0), "D": (6, 0), "B": (1.788, 5.878), "C": (4.772, 4.254)},
                rays=rays, angle_labels=labels)
    assert "the given ∠AOB = 2x + 5 = 61° is not true in the drawing" in messages(problem, drawn)
    # KM bisects ∠JKL and KN bisects ∠MKL: ∠JKL = 4·∠NKL, so x = 28 and
    # ∠JKL = 276° — no drawing can show it.
    broken = (r"$\overrightarrow{KM}$ bisects $\angle JKL$, and $\overrightarrow{KN}$ bisects $\angle MKL$. "
              r"If $m\angle JKL = 10x - 4$ and $m\angle NKL = 2x + 13$, find $m\angle JKM$.")
    k = fig(points={"K": (0, 0), "L": (5, 0), "N": _polar(5, 20), "M": _polar(5, 40), "J": _polar(5, 80)},
            rays=["KJ", "KM", "KN", "KL"])
    assert "the given ∠JKL = 10x - 4 = 276° is not true in the drawing" in messages(broken, k)


def test_round1_angle_algebra_from_the_statement_to_prove() -> None:
    """Found by eye (2f44f46d): "Explain why ∠ADE ≅ ∠ABC" is the equation
    that fixes x = 10 (∠ADE = ∠ABC = 48°)."""
    problem = (r"$\overline{DE} \parallel \overline{BC}$, where $D$ lies on $\overline{AB}$ and $E$ lies on "
               r"$\overline{AC}$. $\angle ADE = 4x + 8$, $\angle ABC = 6x - 12$, and $\angle DAE = 38$ degrees. "
               r"Explain why $\angle ADE$ and $\angle ABC$ are congruent.")
    labels = {"DAE": "38°", "ADE": "4x + 8", "ABC": "6x − 12"}
    segs = ["AB", "AC", "BC", "DE"]
    import math

    a = _polar(4 * math.sin(math.radians(94)) / math.sin(math.radians(38)), 48)  # law of sines, BC = 4
    good = fig(points={"A": a, "B": (0, 0), "C": (4, 0), "D": (a[0] / 2, a[1] / 2), "E": ((a[0] + 4) / 2, a[1] / 2)},
               segments=segs, angle_labels=labels)
    assert messages(problem, good) == []
    symmetric = fig(points={"A": (2.0, 5.808), "B": (0, 0), "C": (4, 0), "D": (1.0, 2.904), "E": (3.0, 2.904)},
                    segments=segs, angle_labels=labels)
    assert "the given ∠ADE = 4x + 8 = 48° is not true in the drawing" in messages(problem, symmetric)


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
