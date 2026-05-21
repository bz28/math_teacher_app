"""Tests for the geometry DSL + renderer.

Focus: every solver branch (SSS, SAS, ASA), each validation rule,
and a few real-world specs end-to-end via render_figure. SVG output
is checked structurally (contains the polygon, contains the labels)
rather than by exact-string match — kerning + float precision make
exact-match tests brittle, structural checks catch regressions
without breaking on cosmetic tweaks.
"""

import math

import pytest

from api.core.geometry import FigureSpecError, render_figure
from api.core.geometry.dsl import CircleFigure, TriangleFigure
from api.core.geometry.solver import solve_circle, solve_triangle

# ── Solver: SSS ──────────────────────────────────────────────────────


def test_sss_3_4_5_right_triangle() -> None:
    """Classic 3-4-5 — verify angle at B is 90° to floating-point tolerance."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0, "CA": 5.0},
    )
    coords = solve_triangle(spec)
    a, b, c = coords["A"], coords["B"], coords["C"]
    # |AB|, |BC|, |CA| should match the spec.
    assert math.isclose(math.hypot(*[a[i] - b[i] for i in range(2)]), 3.0, abs_tol=1e-9)
    assert math.isclose(math.hypot(*[b[i] - c[i] for i in range(2)]), 4.0, abs_tol=1e-9)
    assert math.isclose(math.hypot(*[c[i] - a[i] for i in range(2)]), 5.0, abs_tol=1e-9)
    # The right angle should be at B (where the legs meet).
    ba = (a[0] - b[0], a[1] - b[1])
    bc = (c[0] - b[0], c[1] - b[1])
    dot = ba[0] * bc[0] + ba[1] * bc[1]
    assert math.isclose(dot, 0.0, abs_tol=1e-9)


def test_sss_triangle_inequality_rejected() -> None:
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 1.0, "BC": 1.0, "CA": 5.0},
    )
    with pytest.raises(FigureSpecError, match="triangle inequality"):
        solve_triangle(spec)


# ── Solver: SAS ──────────────────────────────────────────────────────


def test_sas_with_included_angle() -> None:
    """Two sides + the angle between them — classic SAS."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "AC": 4.0},
        angles={"A": 90.0},  # right angle between the two sides
    )
    coords = solve_triangle(spec)
    # |AB| = 3, |AC| = 4, and angle at A = 90° → |BC| = 5.
    b, c = coords["B"], coords["C"]
    assert math.isclose(math.hypot(b[0] - c[0], b[1] - c[1]), 5.0, abs_tol=1e-9)


def test_sas_right_angle_flag_equivalent_to_angles_dict() -> None:
    """`right_angle_at` and `angles[v]=90` should produce the same triangle."""
    via_flag = solve_triangle(
        TriangleFigure(
            vertices=["A", "B", "C"],
            side_lengths={"AB": 3.0, "AC": 4.0},
            right_angle_at=["A"],
        ),
    )
    via_angles = solve_triangle(
        TriangleFigure(
            vertices=["A", "B", "C"],
            side_lengths={"AB": 3.0, "AC": 4.0},
            angles={"A": 90.0},
        ),
    )
    for v in ("A", "B", "C"):
        assert math.isclose(via_flag[v][0], via_angles[v][0], abs_tol=1e-9)
        assert math.isclose(via_flag[v][1], via_angles[v][1], abs_tol=1e-9)


def test_sas_wrong_angle_vertex_rejected() -> None:
    """Two sides AB + BC given but angle specified at C — not SAS-included."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0},
        angles={"C": 60.0},
    )
    with pytest.raises(FigureSpecError, match="included angle"):
        solve_triangle(spec)


# ── Solver: ASA / AAS ────────────────────────────────────────────────


def test_asa_60_60_equilateral() -> None:
    """Two 60° angles + one side → equilateral triangle."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 1.0},
        angles={"A": 60.0, "B": 60.0},
    )
    coords = solve_triangle(spec)
    bc = math.hypot(coords["B"][0] - coords["C"][0], coords["B"][1] - coords["C"][1])
    ca = math.hypot(coords["C"][0] - coords["A"][0], coords["C"][1] - coords["A"][1])
    assert math.isclose(bc, 1.0, abs_tol=1e-9)
    assert math.isclose(ca, 1.0, abs_tol=1e-9)


def test_asa_third_angle_inferred() -> None:
    """A right triangle expressed as 30-60-90 with one side."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 1.0},
        angles={"A": 90.0, "B": 30.0},
    )
    coords = solve_triangle(spec)
    # The leg AB = 1; the leg AC opposite B (30°) has length tan(30°).
    ac = math.hypot(coords["A"][0] - coords["C"][0], coords["A"][1] - coords["C"][1])
    assert math.isclose(ac, math.tan(math.radians(30)), abs_tol=1e-9)


def test_asa_angles_summing_too_high_rejected() -> None:
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 1.0},
        angles={"A": 120.0, "B": 70.0},
    )
    with pytest.raises(FigureSpecError, match="≤ 0|sum to"):
        solve_triangle(spec)


def test_aas_with_two_sides_and_two_angles() -> None:
    """LLM commonly emits over-constrained AAS: 2 sides + 2 angles.
    Router prefers ASA when 2+ angles are present so this resolves
    correctly instead of being rejected as 'angle not at the
    included vertex' by SAS.
    """
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 1.0, "BC": 1.0},
        # Non-included angles (60° at A, 60° at C) → equilateral.
        angles={"A": 60.0, "C": 60.0},
    )
    coords = solve_triangle(spec)
    ca = math.hypot(coords["C"][0] - coords["A"][0], coords["C"][1] - coords["A"][1])
    assert math.isclose(ca, 1.0, abs_tol=1e-9)


# ── Solver: underdetermined ──────────────────────────────────────────


def test_underdetermined_rejected() -> None:
    """Two sides, no angle → not enough info to determine the triangle."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0},
    )
    with pytest.raises(FigureSpecError, match="underdetermined"):
        solve_triangle(spec)


# ── DSL validation ───────────────────────────────────────────────────


def test_negative_side_length_rejected() -> None:
    with pytest.raises(ValueError, match="must be positive"):
        TriangleFigure(
            vertices=["A", "B", "C"],
            side_lengths={"AB": -3.0},
        )


def test_unknown_vertex_in_constraint_rejected() -> None:
    with pytest.raises(ValueError, match="unknown vertex"):
        TriangleFigure(
            vertices=["A", "B", "C"],
            right_angle_at=["Z"],
        )


def test_contradictory_edge_keys_rejected() -> None:
    """`{AB: 3, BA: 5}` references the same edge twice with different
    values. Silently picking one is a hidden-bug factory; surface it
    at validation time.
    """
    with pytest.raises(ValueError, match="same edge"):
        TriangleFigure(
            vertices=["A", "B", "C"],
            side_lengths={"AB": 3.0, "BA": 5.0},
        )


def test_multiple_right_angles_rejected() -> None:
    with pytest.raises(ValueError, match="at most one right angle"):
        TriangleFigure(
            vertices=["A", "B", "C"],
            right_angle_at=["A", "B"],
        )


def test_inconsistent_right_angle_and_angles_rejected() -> None:
    """right_angle_at + angles disagreeing on the same vertex — clear error."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "AC": 4.0},
        right_angle_at=["A"],
        angles={"A": 45.0},
    )
    with pytest.raises(FigureSpecError, match="right angle"):
        solve_triangle(spec)


# ── End-to-end via render_figure ─────────────────────────────────────


def test_render_returns_valid_svg_with_labels() -> None:
    """Smoke test: real-world spec → SVG containing the expected pieces."""
    svg = render_figure(
        {
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
            "right_angle_at": ["B"],
            "side_labels": {"AB": "3", "BC": "4", "CA": "5"},
            "vertex_labels": {"A": "A", "B": "B", "C": "C"},
        },
    )
    assert svg.startswith("<svg")
    assert svg.endswith("</svg>")
    assert "<polygon" in svg  # the triangle outline
    assert "<polyline" in svg  # the right-angle marker
    # Each label should appear in the SVG. ">A<" guards against
    # incidentally matching the "A" inside attributes.
    assert ">A<" in svg and ">B<" in svg and ">C<" in svg
    assert ">3<" in svg and ">4<" in svg and ">5<" in svg


def test_render_omits_right_angle_when_not_specified() -> None:
    """A non-right triangle has no <polyline> (the right-angle marker)."""
    svg = render_figure(
        {
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 5.0, "BC": 6.0, "CA": 7.0},
        },
    )
    assert "<polyline" not in svg


def test_render_raises_on_bad_spec() -> None:
    with pytest.raises(FigureSpecError):
        render_figure({"vertices": ["A", "B"], "side_lengths": {"AB": 1.0}})


# ── Circles: solver ─────────────────────────────────────────────────


def test_circle_solver_places_center_and_points() -> None:
    spec = CircleFigure(
        radius=5.0,
        points={"A": 0.0, "B": 90.0},
    )
    coords = solve_circle(spec)
    assert coords["__center__"] == (0.0, 0.0)
    # Point at 0° = (5, 0), point at 90° = (0, 5).
    assert math.isclose(coords["A"][0], 5.0, abs_tol=1e-9)
    assert math.isclose(coords["A"][1], 0.0, abs_tol=1e-9)
    assert math.isclose(coords["B"][0], 0.0, abs_tol=1e-9)
    assert math.isclose(coords["B"][1], 5.0, abs_tol=1e-9)


def test_circle_solver_negative_radius_rejected() -> None:
    """Validator catches it at DSL level; defense-in-depth at solver."""
    with pytest.raises(ValueError, match="must be positive"):
        CircleFigure(radius=-1.0)


def test_circle_contradictory_chord_keys_rejected() -> None:
    with pytest.raises(ValueError, match="same chord"):
        CircleFigure(
            radius=1.0,
            points={"A": 0.0, "B": 90.0},
            chords=["AB", "BA"],
        )


def test_circle_chord_references_unknown_point_rejected() -> None:
    with pytest.raises(ValueError, match="named points"):
        CircleFigure(
            radius=1.0,
            points={"A": 0.0, "B": 90.0},
            chords=["AC"],
        )


# ── Circles: end-to-end render ──────────────────────────────────────


def test_render_circle_minimal_just_the_outline() -> None:
    """A circle with no points + no chords still renders — just the
    outline. Useful for problems referencing "a circle with radius r"
    where the figure is purely illustrative."""
    svg = render_figure({"shape": "circle", "radius": 1.0})
    assert "<circle" in svg
    assert svg.startswith("<svg")
    # No chord lines, no point dots, no center dot.
    assert "<line" not in svg


def test_render_circle_with_chord_and_labels() -> None:
    svg = render_figure(
        {
            "shape": "circle",
            "radius": 5.0,
            "points": {"A": 0.0, "B": 180.0},
            "chords": ["AB"],
            "chord_labels": {"AB": "diameter"},
            "show_center": True,
            "center_label": "O",
        },
    )
    assert "<circle" in svg  # outline
    assert "<line" in svg  # chord
    assert ">A<" in svg and ">B<" in svg  # point labels
    assert ">O<" in svg  # center label
    assert ">diameter<" in svg


def test_render_circle_with_labeled_radius() -> None:
    svg = render_figure(
        {
            "shape": "circle",
            "radius": 3.0,
            "points": {"P": 60.0},
            "radius_label": "r",
        },
    )
    assert "<line" in svg  # the radius line
    assert ">r<" in svg


# ── Discriminated union dispatch ────────────────────────────────────


def test_render_dispatches_on_shape() -> None:
    """Same render_figure() entry handles both shapes via the
    discriminator. No type checking in the caller required."""
    triangle = render_figure(
        {
            "shape": "triangle",
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
        },
    )
    circle = render_figure({"shape": "circle", "radius": 2.0})
    assert "<polygon" in triangle  # triangle outline
    assert "<polygon" not in circle  # circles use <circle>
    assert "<circle" in circle


def test_render_escapes_text_content() -> None:
    """A label containing '<' or '&' must not break the SVG."""
    svg = render_figure(
        {
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
            "right_angle_at": ["B"],
            "side_labels": {"AB": "a < b & c"},
        },
    )
    assert ">a &lt; b &amp; c<" in svg
    assert "<a " not in svg  # no raw < leaked into the markup
