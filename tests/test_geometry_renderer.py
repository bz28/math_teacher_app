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
from api.core.geometry.dsl import CircleFigure, PolygonFigure, TriangleFigure
from api.core.geometry.solver import (
    circumcircle_of_triangle,
    incircle_of_triangle,
    solve_circle,
    solve_polygon,
    solve_triangle,
)

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


# ── Solver: over-determined / inconsistent constraint rejection ──────


def test_three_sides_with_conflicting_angle_rejected() -> None:
    """3 sides fully fix the triangle (53/90/37 for 3-4-5). An angle
    that grossly disagrees means the spec is self-inconsistent — reject
    rather than draw a figure whose angle label contradicts its shape."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0, "CA": 5.0},
        angles={"A": 10.0},  # real angle at A is 53.13°
    )
    with pytest.raises(FigureSpecError, match="inconsistent"):
        solve_triangle(spec)


def test_three_angles_not_summing_to_180_rejected() -> None:
    """50/50/50 sums to 150°, not 180° — impossible. The law-of-sines
    path would silently 'correct' it to an equilateral; verify catches
    that the drawn angles wouldn't match the stated 50°."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 10.0},
        angles={"A": 50.0, "B": 50.0, "C": 50.0},
    )
    with pytest.raises(FigureSpecError, match="inconsistent"):
        solve_triangle(spec)


def test_two_sides_conflicting_with_two_angles_rejected() -> None:
    """Over-determined: a second side that the angles don't support is
    silently overwritten by the ASA law-of-sines solve — verify catches
    the discarded constraint."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 10.0, "BC": 999.0},
        angles={"A": 30.0, "C": 30.0},
    )
    with pytest.raises(FigureSpecError, match="inconsistent"):
        solve_triangle(spec)


def test_false_right_angle_on_three_sides_rejected() -> None:
    """A right-angle marker on a vertex the side lengths don't make 90°
    would draw a misleading square. The folded 90° fails verification."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0, "CA": 5.0},
        right_angle_at=["A"],  # the right angle is at B, not A
    )
    with pytest.raises(FigureSpecError, match="inconsistent"):
        solve_triangle(spec)


def test_overdetermined_consistent_spec_accepted() -> None:
    """Rounded-but-correct textbook numbers (3-4-5 with angle A≈53°)
    are within tolerance — accepted, not dropped."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0, "CA": 5.0},
        angles={"A": 53.0},  # true value 53.13°
    )
    coords = solve_triangle(spec)  # must not raise
    assert math.isclose(
        math.hypot(coords["A"][0] - coords["B"][0], coords["A"][1] - coords["B"][1]),
        3.0, abs_tol=1e-9,
    )


def test_overdetermined_rounded_derived_side_accepted() -> None:
    """Over-determined spec where a DERIVED side is rounded to a nice
    integer. Two sides of 10 with base angles 55°/65° force the third
    side to ~10.47; an LLM labeling it "10" (4.7% off) is a fine figure
    and must NOT be dropped — the consistency check tolerates rounding
    on derived sides, only rejecting gross contradictions."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 10.0, "CA": 10.0},
        angles={"A": 55.0, "B": 65.0},
    )
    solve_triangle(spec)  # must not raise


def test_grossly_wrong_derived_side_still_rejected() -> None:
    """The loosened tolerance still rejects a side that's off by orders
    of magnitude (999 where the angles force ~10)."""
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 10.0, "BC": 999.0},
        angles={"A": 30.0, "C": 30.0},
    )
    with pytest.raises(FigureSpecError, match="inconsistent"):
        solve_triangle(spec)


# ── Renderer: scale normalization ────────────────────────────────────


def _viewbox(svg: str) -> tuple[float, float, float, float]:
    import re
    m = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"', svg)
    assert m, "svg has no viewBox"
    return tuple(float(g) for g in m.groups())  # type: ignore[return-value]


def test_render_scale_invariant_across_magnitudes() -> None:
    """Same-shape triangles at wildly different magnitudes must render
    at the same on-screen size: font/stroke are absolute, so the
    coordinates are normalized to a canonical span. A 3-4-5 and a
    300-400-500 triangle produce an identical viewBox."""
    small = render_figure({
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
    })
    large = render_figure({
        "vertices": ["A", "B", "C"],
        "side_lengths": {"AB": 300.0, "BC": 400.0, "CA": 500.0},
    })
    sw = _viewbox(small)[2]
    lw = _viewbox(large)[2]
    assert math.isclose(sw, lw, rel_tol=1e-6)
    # And the canonical span is the tuned ~5 units (longest dim) plus
    # padding on both sides — i.e. the figure is neither microscopic nor
    # gigantic relative to the absolute font size.
    assert 4.0 < sw < 8.0


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


def test_render_circle_diameter_label_not_at_origin() -> None:
    """Diameter chord (endpoints 180° apart) has its midpoint AT the
    origin, so the 'outward = away from center' offset is undefined.
    Previously this produced a label drawn at (0, 0), overlapping the
    center dot. Falls back to the chord's perpendicular instead.
    """
    import re

    svg = render_figure(
        {
            "shape": "circle",
            "radius": 5.0,
            "points": {"A": 0.0, "B": 180.0},
            "chords": ["AB"],
            "chord_labels": {"AB": "d"},
            "show_center": True,
        },
    )
    # Find the diameter label's <text> element. It should NOT be at
    # x="0" + y="0" (which would overlap the center dot).
    match = re.search(r'<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>d</text>', svg)
    assert match is not None, "diameter label 'd' missing from SVG"
    x, y = float(match.group(1)), float(match.group(2))
    assert abs(x) > 0.1 or abs(y) > 0.1, (
        f"diameter label landed too close to origin: ({x}, {y})"
    )


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


# ── Compound: triangle + inscribed/circumscribed circle ────────────


def test_incircle_of_9_12_15_right_triangle() -> None:
    """Classic AMC: a 9-12-15 right triangle has inradius exactly 3.
    Verified via the closed-form r = (a + b - c) / 2 for a right
    triangle = (9 + 12 - 15) / 2 = 3.
    """
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 9.0, "BC": 12.0, "CA": 15.0},
        right_angle_at=["B"],
    )
    coords = solve_triangle(spec)
    _center, radius, tangent_points = incircle_of_triangle(spec.vertices, coords)
    assert math.isclose(radius, 3.0, abs_tol=1e-9)
    # Tangent points should be ON the sides — verify by checking
    # that each one's distance to the incenter equals the radius.
    cx, cy = _center
    for tp in tangent_points:
        d = math.hypot(tp[0] - cx, tp[1] - cy)
        assert math.isclose(d, radius, abs_tol=1e-9)


def test_circumcircle_of_3_4_5_right_triangle() -> None:
    """A right triangle's circumradius equals half its hypotenuse.
    3-4-5 → circumradius 2.5. Also: circumcenter is at the midpoint
    of the hypotenuse.
    """
    spec = TriangleFigure(
        vertices=["A", "B", "C"],
        side_lengths={"AB": 3.0, "BC": 4.0, "CA": 5.0},
    )
    coords = solve_triangle(spec)
    center, radius = circumcircle_of_triangle(spec.vertices, coords)
    assert math.isclose(radius, 2.5, abs_tol=1e-9)
    # Distance from circumcenter to EACH vertex must equal the radius.
    for v in spec.vertices:
        d = math.hypot(coords[v][0] - center[0], coords[v][1] - center[1])
        assert math.isclose(d, radius, abs_tol=1e-9)


def test_collinear_triangle_circumcircle_rejected() -> None:
    """Algebraic guard: circumcircle of a degenerate (collinear)
    triangle is undefined — should raise FigureSpecError rather
    than divide by zero.
    """
    coords = {"A": (0.0, 0.0), "B": (1.0, 0.0), "C": (2.0, 0.0)}
    with pytest.raises(FigureSpecError, match="circumcircle"):
        circumcircle_of_triangle(["A", "B", "C"], coords)


def test_render_triangle_with_inscribed_circle() -> None:
    """End-to-end: a triangle with inscribed_circle in the spec
    renders BOTH the polygon outline AND a <circle> for the incircle.
    """
    svg = render_figure(
        {
            "shape": "triangle",
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 9.0, "BC": 12.0, "CA": 15.0},
            "right_angle_at": ["B"],
            "inscribed_circle": {
                "show_center": True,
                "radius_label": "r",
                "show_tangent_points": True,
            },
        },
    )
    assert "<polygon" in svg  # triangle outline
    assert "<circle" in svg  # the incircle
    assert ">r<" in svg  # radius label rendered


def test_render_triangle_with_circumscribed_circle() -> None:
    svg = render_figure(
        {
            "shape": "triangle",
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
            "circumscribed_circle": {"show_center": True, "radius_label": "R"},
        },
    )
    assert "<polygon" in svg
    assert "<circle" in svg
    assert ">R<" in svg


def test_inscribed_circle_omitted_means_no_circle_drawn() -> None:
    """Triangles without inscribed_circle/circumscribed_circle render
    exactly as before — no <circle> element appears."""
    svg = render_figure(
        {
            "shape": "triangle",
            "vertices": ["A", "B", "C"],
            "side_lengths": {"AB": 3.0, "BC": 4.0, "CA": 5.0},
        },
    )
    assert "<circle" not in svg


# ── Polygons ────────────────────────────────────────────────────────


def test_regular_polygon_square_vertices_form_a_square() -> None:
    """Regular polygon with n_sides=4 + side_length=1 → unit square.
    All 4 sides equal length, all 4 interior angles equal (90°).
    """
    spec = PolygonFigure(n_sides=4, side_length=1.0)
    names, coords = solve_polygon(spec)
    assert len(names) == 4
    # Each consecutive pair should be exactly side_length apart.
    for i in range(4):
        v1 = names[i]
        v2 = names[(i + 1) % 4]
        d = math.hypot(coords[v1][0] - coords[v2][0], coords[v1][1] - coords[v2][1])
        assert math.isclose(d, 1.0, abs_tol=1e-9), f"side {v1}{v2} = {d} not 1.0"


def test_regular_polygon_square_is_upright_not_diamond() -> None:
    """A regular n=4 polygon must render as a CONVENTIONAL square
    (sides axis-aligned, like graph paper) not as a diamond (rotated
    45° with vertex at top + bottom + left + right). The orientation
    test the existing side-equality check can't catch — true for any
    rotation of a regular polygon.

    For a unit square, the bottom edge must be horizontal: both
    vertices on the bottom must share the same y coordinate.
    """
    spec = PolygonFigure(n_sides=4, side_length=1.0)
    _names, coords = solve_polygon(spec)
    ys = sorted(c[1] for c in coords.values())
    # Bottom-two y values should match (= the bottom edge is flat).
    assert math.isclose(ys[0], ys[1], abs_tol=1e-9), (
        f"square is rotated as a diamond — bottom vertices at different y: {ys}"
    )
    # And top-two y values should match.
    assert math.isclose(ys[2], ys[3], abs_tol=1e-9)


def test_regular_polygon_hexagon_has_flat_bottom() -> None:
    """Hexagons should sit on a flat side, not balanced on a point —
    the textbook orientation."""
    spec = PolygonFigure(n_sides=6, side_length=1.0)
    _names, coords = solve_polygon(spec)
    ys = sorted(c[1] for c in coords.values())
    # Two bottom vertices share y (the flat bottom edge).
    assert math.isclose(ys[0], ys[1], abs_tol=1e-9)


def test_regular_polygon_hexagon_has_six_vertices() -> None:
    spec = PolygonFigure(n_sides=6, side_length=2.0)
    names, coords = solve_polygon(spec)
    assert len(names) == 6
    assert names == ["A", "B", "C", "D", "E", "F"]


def test_regular_polygon_odd_n_points_up_not_down() -> None:
    """Odd-n regular polygons (pentagon, …) should point UP — a vertex at
    the top and a flat bottom edge (the textbook 'house'), not upside-down
    with a vertex at the bottom."""
    spec = PolygonFigure(n_sides=5, side_length=2.0)
    _names, coords = solve_polygon(spec)
    ys = sorted(c[1] for c in coords.values())
    assert ys[-1] > 0  # a single vertex at the top
    assert math.isclose(ys[0], ys[1], abs_tol=1e-9)  # flat bottom edge


def test_polygon_n_sides_3_rejected() -> None:
    """n_sides=3 forces the LLM to use shape='triangle' (which has
    the actual constraint solver). The polygon path is for shapes
    we render from a vertex list, not a constraint set."""
    with pytest.raises(ValueError, match="n_sides must be"):
        PolygonFigure(n_sides=3)


def test_polygon_both_modes_rejected() -> None:
    """Can't be both regular (n_sides) and irregular (vertex_positions)."""
    with pytest.raises(ValueError, match="EITHER"):
        PolygonFigure(n_sides=4, vertex_positions=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])


def test_polygon_neither_mode_rejected() -> None:
    with pytest.raises(ValueError, match="EITHER"):
        PolygonFigure()


def test_irregular_polygon_uses_explicit_positions() -> None:
    """Irregular polygon with explicit vertex positions — kite shape."""
    spec = PolygonFigure(
        vertex_positions=[(0.0, 0.0), (1.0, 2.0), (0.0, 3.0), (-1.0, 2.0)],
    )
    names, coords = solve_polygon(spec)
    assert names == ["A", "B", "C", "D"]
    assert coords["A"] == (0.0, 0.0)
    assert coords["C"] == (0.0, 3.0)


def test_polygon_custom_vertex_names() -> None:
    spec = PolygonFigure(
        n_sides=4, side_length=1.0, vertex_names=["P", "Q", "R", "S"],
    )
    names, _ = solve_polygon(spec)
    assert names == ["P", "Q", "R", "S"]


def test_polygon_vertex_names_wrong_length_rejected() -> None:
    with pytest.raises(ValueError, match="vertex_names length"):
        PolygonFigure(n_sides=4, vertex_names=["A", "B", "C"])


def test_render_polygon_square_outputs_svg() -> None:
    svg = render_figure(
        {
            "shape": "polygon",
            "n_sides": 4,
            "side_labels": {"AB": "s", "BC": "s"},
        },
    )
    assert "<polygon" in svg
    assert ">A<" in svg and ">B<" in svg
    assert ">s<" in svg


def test_render_polygon_irregular_pentagon() -> None:
    svg = render_figure(
        {
            "shape": "polygon",
            "n_sides": 5,
            "angle_labels": {"A": "108°"},
        },
    )
    assert "<polygon" in svg
    assert ">108°<" in svg


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
