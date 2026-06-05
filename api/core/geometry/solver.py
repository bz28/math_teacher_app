"""Solve a TriangleFigure spec into exact 2D vertex coordinates.

Triangle constraints reduce to three families: SSS (three sides),
SAS (two sides + included angle), ASA/AAS (two angles + one side).
The right-angle flag is sugar — it forces 90° at the named vertex,
then folds into whichever family the rest of the constraints form.

Coordinates use a standard cartesian system (y up); the renderer
flips for SVG. The first vertex anchors at (0, 0) and the second is
placed along positive x so the triangle has a canonical orientation;
the renderer can re-center via the viewBox.
"""

from __future__ import annotations

import math

from api.core.geometry.dsl import CircleFigure, FigureSpecError, TriangleFigure

Point = tuple[float, float]


def _canonical_edge(a: str, b: str) -> str:
    """Edges are unordered — 'AB' and 'BA' resolve to the same key."""
    return a + b if a < b else b + a


def _lookup_side(spec: TriangleFigure, a: str, b: str) -> float | None:
    """Return the length of edge ab if present, normalizing key order."""
    for key in (a + b, b + a):
        if key in spec.side_lengths:
            return spec.side_lengths[key]
    return None


def solve_triangle(spec: TriangleFigure) -> dict[str, Point]:
    """Compute (x, y) for each vertex given the spec's constraints.

    Raises FigureSpecError when the constraints don't determine a
    valid triangle (underdetermined, overdetermined-inconsistent, or
    violating the triangle inequality).
    """
    a, b, c = spec.vertices

    # Fold right-angle into the angles dict so all downstream logic
    # works from one source of truth.
    angles = dict(spec.angles)
    for v in spec.right_angle_at:
        if v in angles and not math.isclose(angles[v], 90.0):
            raise FigureSpecError(
                f"vertex {v} marked as right angle but angles[{v}]={angles[v]}",
            )
        angles[v] = 90.0

    sides = {
        _canonical_edge(a, b): _lookup_side(spec, a, b),
        _canonical_edge(b, c): _lookup_side(spec, b, c),
        _canonical_edge(c, a): _lookup_side(spec, c, a),
    }
    known_sides = {k: v for k, v in sides.items() if v is not None}

    n_sides = len(known_sides)
    n_angles = len(angles)

    # Route by what determines the triangle:
    # - 2+ angles given → ASA/AAS handles it (any 1+ side anchors scale).
    #   This MUST come before the SAS branch because an LLM emitting an
    #   over-constrained 2-sides + 2-angles spec (e.g. {AB, BC, ∠A, ∠C})
    #   is a valid AAS — _solve_sas would wrongly reject it as "angle
    #   not at the included vertex." ASA generalizes cleanly.
    # - 3 sides → SSS.
    # - 2 sides + 1 angle → SAS (angle must be at the shared vertex).
    if n_angles >= 2 and n_sides >= 1:
        return _solve_asa(spec, sides, angles)
    if n_sides == 3:
        return _solve_sss(spec, sides)  # type: ignore[arg-type]
    if n_sides == 2 and n_angles >= 1:
        return _solve_sas(spec, sides, angles)

    raise FigureSpecError(
        "underdetermined triangle: need 3 sides, or 2 sides + 1 angle, "
        f"or 1 side + 2 angles (got {n_sides} sides, {n_angles} angles)",
    )


def _solve_sss(
    spec: TriangleFigure, sides: dict[str, float],
) -> dict[str, Point]:
    """Three sides → coordinates via the triangle inequality + law of cosines."""
    a, b, c = spec.vertices
    ab = sides[_canonical_edge(a, b)]
    bc = sides[_canonical_edge(b, c)]
    ca = sides[_canonical_edge(c, a)]

    # Triangle inequality: each side must be less than the sum of the
    # other two. Equality is degenerate (the triangle collapses to a
    # line) — reject too.
    if ab + bc <= ca or bc + ca <= ab or ca + ab <= bc:
        raise FigureSpecError(
            f"triangle inequality violated: sides ab={ab}, bc={bc}, ca={ca}",
        )

    # Place A at origin, B along positive x-axis. C sits at the
    # intersection of the circles centered on A (radius CA) and B
    # (radius BC) — pick the one with positive y so the triangle
    # opens upward in cartesian coordinates.
    pa = (0.0, 0.0)
    pb = (ab, 0.0)

    # Solve for C from |AC| = ca and |BC| = bc.
    # x² + y² = ca²; (x - ab)² + y² = bc²
    # Subtracting: -2·ab·x + ab² = bc² - ca², so x = (ab² + ca² - bc²) / (2·ab)
    cx = (ab * ab + ca * ca - bc * bc) / (2 * ab)
    cy_sq = ca * ca - cx * cx
    if cy_sq <= 0:
        raise FigureSpecError("triangle is degenerate (zero area)")
    cy = math.sqrt(cy_sq)
    pc = (cx, cy)

    return {a: pa, b: pb, c: pc}


def _solve_sas(
    spec: TriangleFigure,
    sides: dict[str, float | None],
    angles: dict[str, float],
) -> dict[str, Point]:
    """Two sides + one angle. If the angle is the included one between
    the two sides, the third side comes from the law of cosines; if
    it's elsewhere, the law of sines gives us the rest.

    For v1 we only handle the included-angle case (the natural SAS),
    which covers the vast majority of textbook problems. Mixed
    side/angle layouts that aren't SAS-included are rejected with a
    clear error — the LLM is expected to express ASA/AAS using two
    angles instead.
    """
    a, b, c = spec.vertices
    # Find which vertex has the angle and which two sides are present.
    # The "included" angle for sides (X, Y, Z) is the vertex where the
    # two given sides meet.
    known_side_edges = {
        edge for edge, length in sides.items() if length is not None
    }
    if len(known_side_edges) != 2:
        raise FigureSpecError(
            "_solve_sas called with the wrong number of sides",
        )

    edge1, edge2 = known_side_edges
    # The shared vertex between two edges is the intersection of their
    # character sets — guaranteed nonempty for triangle edges.
    shared = set(edge1) & set(edge2)
    if not shared:
        raise FigureSpecError(
            "two given sides don't share a vertex — invalid triangle topology",
        )
    included_vertex = next(iter(shared))

    if included_vertex not in angles:
        raise FigureSpecError(
            f"two sides given ({edge1}, {edge2}) but the included angle "
            f"at vertex {included_vertex} isn't specified — for SAS, "
            "specify the angle at the shared vertex",
        )

    included_angle_deg = angles[included_vertex]
    included_angle_rad = math.radians(included_angle_deg)

    # The two "arms" of the angle — vertices that aren't the included one.
    arm1 = (set(edge1) - {included_vertex}).pop()
    arm2 = (set(edge2) - {included_vertex}).pop()
    len1 = sides[edge1]
    len2 = sides[edge2]
    assert len1 is not None and len2 is not None  # length-filter above

    # Place the included vertex at origin, first arm along positive
    # x-axis, second arm rotated by the included angle. Then map back
    # to (a, b, c) → (pa, pb, pc).
    p_included = (0.0, 0.0)
    p_arm1 = (len1, 0.0)
    p_arm2 = (
        len2 * math.cos(included_angle_rad),
        len2 * math.sin(included_angle_rad),
    )

    placements = {included_vertex: p_included, arm1: p_arm1, arm2: p_arm2}
    return {a: placements[a], b: placements[b], c: placements[c]}


def solve_circle(spec: CircleFigure) -> dict[str, Point]:
    """Compute (x, y) for the center and each named point on the circle.

    Center is placed at the origin. Each named point sits on the
    circumference at the LLM-specified angle (degrees CCW from
    positive x-axis). The single-DOF-per-point design is the
    important contract — the LLM doesn't pick coordinates, just an
    angle, and the geometry is exact by construction.

    The center is stored under the special key "__center__" so it
    can't collide with a user-named point. Renderer + tests both
    treat that key as opaque.
    """
    if spec.radius <= 0:
        # The validator already catches this; the second check is
        # defense-in-depth since solve_circle is called from outside
        # the model validator path during render_figure.
        raise FigureSpecError(f"circle radius must be positive (got {spec.radius})")

    coords: dict[str, Point] = {"__center__": (0.0, 0.0)}
    for name, angle_deg in spec.points.items():
        rad = math.radians(angle_deg)
        coords[name] = (spec.radius * math.cos(rad), spec.radius * math.sin(rad))
    return coords


def _solve_asa(
    spec: TriangleFigure,
    sides: dict[str, float | None],
    angles: dict[str, float],
) -> dict[str, Point]:
    """One side + two angles. Third angle = 180° - first two. Use law
    of sines to get the other two sides, then fall through to SSS.
    """
    a, b, c = spec.vertices

    # Resolve the third angle if missing.
    angles = dict(angles)
    if len(angles) == 2:
        missing = (set(spec.vertices) - set(angles)).pop()
        angles[missing] = 180.0 - sum(angles.values())
        if angles[missing] <= 0:
            raise FigureSpecError(
                f"computed angle at {missing} = {angles[missing]} ≤ 0; "
                "the two given angles sum to ≥ 180°",
            )

    # Find a known side — any of them suffices to anchor the scale,
    # so when the LLM emits an over-constrained spec (2-3 sides + 2
    # angles) we just take the first. The law-of-sines path computes
    # the other sides; if any conflict with what the LLM also
    # provided, that's a consistency issue we let SSS catch (it'll
    # raise triangle-inequality if the lengths don't agree).
    known = [(edge, length) for edge, length in sides.items() if length is not None]
    if not known:
        raise FigureSpecError(
            "_solve_asa called with no sides — need at least one for scale",
        )
    known_edge, known_length = known[0]
    assert known_length is not None

    # Law of sines: side / sin(opposite_angle) = constant. The angle
    # opposite an edge is the vertex NOT on that edge.
    def angle_opposite(edge: str) -> float:
        opp = (set(spec.vertices) - set(edge)).pop()
        return math.radians(angles[opp])

    sine_ratio = known_length / math.sin(angle_opposite(known_edge))

    # Compute all three side lengths.
    full_sides: dict[str, float] = {}
    for edge in (
        _canonical_edge(a, b),
        _canonical_edge(b, c),
        _canonical_edge(c, a),
    ):
        full_sides[edge] = sine_ratio * math.sin(angle_opposite(edge))

    return _solve_sss(spec, full_sides)
