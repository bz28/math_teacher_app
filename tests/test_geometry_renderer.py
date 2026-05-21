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
from api.core.geometry.dsl import TriangleFigure
from api.core.geometry.solver import solve_triangle

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
