"""The construction-figure checker (api/core/geometry/figure_check.py).

Each rule has a passing and a failing fixture: the same problem with a
figure that meets the rule and one that breaks it. The checker never calls
an AI; it parses the problem text and measures the drawn coordinates.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.figure_check import check_construction, parse_problem, unbacked_marks


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
        r"$\triangle ABC$ and $\triangle DBC$ have right angles at $A$ and $D$. Right angles at $A$ and $D$.",
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
    problem = r"$\angle 1$ and $\angle 3$ are vertical angles."
    f = fig(
        points={"A": (-2, -1), "O": (0, 0), "B": (2, 1), "C": (-2, 1), "D": (2, -1)},
        lines=[{"through": ["A", "B"]}, {"through": ["C", "D"]}],
        angle_labels={"AOC": "1", "BOD": "3", "COB": "2", "DOA": "4"},
    )
    assert "label" not in kinds(problem, f)


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


def test_one_member_mark_group_is_unbacked() -> None:
    problem = r"Given $\overline{BD}$ bisects $\angle ABC$."
    f = fig(points={"A": (0, 4), "B": (0, 0), "C": (4, 0), "D": (2, 2)}, segments=["BA", "BC", "BD"],
            tick_groups=[["BD"]], arc_groups=[["ABD", "DBC"]])
    assert unbacked_marks(f, problem) == {"tick_groups": [0]}


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
