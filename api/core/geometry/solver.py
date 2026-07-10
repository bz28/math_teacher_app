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

from api.core.geometry.dsl import (
    CircleFigure,
    CircleLine,
    FigureSpecError,
    PolygonFigure,
    TriangleFigure,
)

Point = tuple[float, float]

# Tolerances for the post-solve consistency check. Generous on purpose:
# the goal is to catch GROSS inconsistencies that would draw a visibly
# wrong figure (a side off by 25%, an angle off by 20°), while tolerating
# the rounding an LLM applies to "nice" textbook numbers (calling a 3-4-5
# triangle's angles 37°/53° instead of 36.87°/53.13°). A discrepancy
# under these bounds is visually imperceptible anyway. The side bound is
# 5% rather than tighter because an over-determined spec can carry a
# DERIVED side rounded to a nice integer — e.g. two sides of 10 with base
# angles 55°/65° forces the third side to 10.47, which the LLM may label
# "10" (4.7% off). That's a fine figure; only gross contradictions (a
# side off by 2x, the law-of-sines anchor disagreeing wildly) should drop.
_SIDE_REL_TOL = 0.05  # 5%
_ANGLE_ABS_TOL_DEG = 1.5

# How close an interior angle must be to 90° for the triangle to be
# treated as right-angled and re-oriented to the textbook convention
# (legs axis-aligned). Kept tight so ONLY genuine right triangles are
# touched — a non-right triangle whose largest angle is merely nearby
# (e.g. 88°) is left exactly as the solver placed it. Explicitly marked
# right angles (right_angle_at / angles=90) are honored regardless of
# this tolerance, since verification already guarantees they're ~90°.
_RIGHT_ANGLE_DETECT_TOL_DEG = 0.5


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
    # - 3 sides → SSS. Three sides fully fix the triangle, so they take
    #   priority: a spec that ALSO carries angle(s) is over-determined,
    #   and the side lengths (which the figure labels) are the source of
    #   truth. The extra angles are verified, not re-solved from.
    # - 2+ angles + 1+ side → ASA/AAS (the side anchors scale). This
    #   must come before the SAS branch because an over-constrained
    #   2-sides + 2-angles spec (e.g. {AB, BC, ∠A, ∠C}) is a valid AAS —
    #   _solve_sas would wrongly reject it as "angle not at the included
    #   vertex." ASA generalizes cleanly.
    # - 2 sides + 1 angle → SAS (angle must be at the shared vertex).
    if n_sides == 3:
        # Pass the non-None-narrowed dict (n_sides==3 ⇒ all three present),
        # which is typed dict[str, float] — no cast/ignore needed.
        coords = _solve_sss(spec, known_sides)
    elif n_angles >= 2 and n_sides >= 1:
        coords = _solve_asa(spec, sides, angles)
    elif n_sides == 2 and n_angles >= 1:
        coords = _solve_sas(spec, sides, angles)
    else:
        raise FigureSpecError(
            "underdetermined triangle: need 3 sides, or 2 sides + 1 angle, "
            f"or 1 side + 2 angles (got {n_sides} sides, {n_angles} angles)",
        )

    # Each solver family consumes only the constraints it needs and
    # silently ignores the rest — so an over-determined or
    # self-inconsistent spec (e.g. sides that contradict the given
    # angles, three angles that don't sum to 180°, or a right_angle_at
    # that the side lengths don't actually form) would otherwise be
    # drawn WRONG with no error. Verify the solved triangle satisfies
    # every provided side and angle; the caller catches FigureSpecError
    # and drops just the figure, keeping the question intact.
    #
    # Re-orient right triangles to the textbook convention (legs
    # axis-aligned, right angle bottom-left) BEFORE verifying — the
    # orientation pass is a pure rotation, so verification runs on the
    # exact coordinates that will be rendered.
    coords = _orient_right_triangle(coords, spec.vertices, angles)
    _verify_constraints(spec, coords, angles)
    return coords


def _orient_right_triangle(
    coords: dict[str, Point], vertices: list[str], angles: dict[str, float],
) -> dict[str, Point]:
    """Rotate a right triangle so its two LEGS are axis-aligned.

    The per-family solvers place a fixed edge (AB, or the SAS included
    vertex's first arm) on the x-axis regardless of where the right
    angle sits — so a right triangle the model named with its HYPOTENUSE
    as that edge would draw the hypotenuse as a horizontal base, which
    reads as wrong (textbook right triangles rest on a leg). This pass
    fixes that independently of vertex naming: it finds the right-angle
    vertex, then rigidly rotates the whole triangle so the right angle
    sits at the bottom-left with one leg pointing along +x and the other
    along +y.

    A pure rotation preserves every length and angle, so the figure stays
    geometrically identical — only its orientation on the page changes,
    and `_verify_constraints` still passes. Non-right triangles are
    returned untouched.
    """
    right_v = _right_angle_vertex(coords, vertices, angles)
    if right_v is None:
        return coords

    others = [v for v in vertices if v != right_v]
    rx, ry = coords[right_v]
    # The two legs, as vectors from the right-angle vertex.
    d1 = (coords[others[0]][0] - rx, coords[others[0]][1] - ry)
    d2 = (coords[others[1]][0] - rx, coords[others[1]][1] - ry)

    # Choose which leg becomes horizontal so the other lands on +y (not
    # -y) — i.e. the right angle ends up bottom-left. That's the leg whose
    # partner is 90° COUNTER-clockwise from it (positive cross product);
    # picking it means a pure rotation suffices, no reflection (which would
    # mirror the triangle and could flip labels).
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    horiz = d1 if cross > 0 else d2

    # Rotate every vertex by θ = -atan2(hy, hx) so `horiz` maps onto the
    # positive x-axis; its perpendicular partner then maps onto +y.
    theta = -math.atan2(horiz[1], horiz[0])
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    return {
        name: (px * cos_t - py * sin_t, px * sin_t + py * cos_t)
        for name, (px, py) in coords.items()
    }


def _right_angle_vertex(
    coords: dict[str, Point], vertices: list[str], angles: dict[str, float],
) -> str | None:
    """Name of the right-angle vertex, or None if the triangle isn't right.

    Prefers an explicitly-declared right angle (`right_angle_at` folds
    into `angles` as 90°, as does an explicit `angles[v]=90`) so a labeled
    right angle is always honored. Falls back to detecting a ~90° interior
    angle from the solved geometry, which catches right triangles the
    model expressed purely via side lengths (e.g. an unlabeled 3-4-5).
    """
    for v, deg in angles.items():
        if math.isclose(deg, 90.0, abs_tol=1e-6):
            return v
    for v in vertices:
        others = [u for u in vertices if u != v]
        if math.isclose(
            _angle_at_vertex(coords, v, others),
            90.0,
            abs_tol=_RIGHT_ANGLE_DETECT_TOL_DEG,
        ):
            return v
    return None


def _angle_at_vertex(
    coords: dict[str, Point], vertex: str, others: list[str],
) -> float:
    """Interior angle at `vertex` (degrees), measured between the edges
    to the two `others` vertices."""
    px, py = coords[vertex]
    qx, qy = coords[others[0]]
    rx, ry = coords[others[1]]
    v1x, v1y = qx - px, qy - py
    v2x, v2y = rx - px, ry - py
    n1 = math.hypot(v1x, v1y)
    n2 = math.hypot(v2x, v2y)
    if n1 == 0 or n2 == 0:
        raise FigureSpecError("degenerate triangle: coincident vertices")
    cos_a = (v1x * v2x + v1y * v2y) / (n1 * n2)
    cos_a = max(-1.0, min(1.0, cos_a))  # clamp fp drift before acos
    return math.degrees(math.acos(cos_a))


def _verify_constraints(
    spec: TriangleFigure, coords: dict[str, Point], angles: dict[str, float],
) -> None:
    """Reject specs whose stated constraints disagree with the solved
    geometry. `angles` is the folded dict (right_angle_at already merged
    in as 90°), so this also enforces that a marked right angle is real.
    """
    for edge, length in spec.side_lengths.items():
        p1 = coords[edge[0]]
        p2 = coords[edge[1]]
        actual = math.hypot(p1[0] - p2[0], p1[1] - p2[1])
        if not math.isclose(actual, length, rel_tol=_SIDE_REL_TOL, abs_tol=1e-9):
            raise FigureSpecError(
                f"inconsistent triangle: side {edge} given as {length} but "
                f"the other constraints force {actual:.4f}",
            )
    for vertex, want in angles.items():
        others = [v for v in spec.vertices if v != vertex]
        actual = _angle_at_vertex(coords, vertex, others)
        if not math.isclose(actual, want, abs_tol=_ANGLE_ABS_TOL_DEG):
            raise FigureSpecError(
                f"inconsistent triangle: angle at {vertex} given as {want}° "
                f"but the other constraints force {actual:.2f}°",
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


def incircle_of_triangle(
    vertices: list[str], coords: dict[str, Point],
) -> tuple[Point, float, list[Point]]:
    """Compute the incircle of the triangle defined by `vertices`.

    Returns (center, radius, tangent_points). The tangent points are
    the feet of the perpendiculars from the incenter to each side, in
    the same order as the triangle's sides: AB, BC, CA.

    Math:
    - The incenter is the weighted average of the vertices, where
      each vertex is weighted by the length of the side OPPOSITE it.
      I = (a·A + b·B + c·C) / (a + b + c), where a = |BC|, b = |CA|,
      c = |AB|.
    - The inradius is Area / s, where s is the semi-perimeter.
    - Tangent points: for each side, project the incenter onto the
      line through that side's endpoints — that's the foot of the
      perpendicular, which is exactly where the incircle touches.
    """
    a_name, b_name, c_name = vertices
    pa = coords[a_name]
    pb = coords[b_name]
    pc = coords[c_name]

    # Side lengths (named by the vertex they're opposite to).
    side_a = math.hypot(pb[0] - pc[0], pb[1] - pc[1])  # opposite A → |BC|
    side_b = math.hypot(pc[0] - pa[0], pc[1] - pa[1])  # opposite B → |CA|
    side_c = math.hypot(pa[0] - pb[0], pa[1] - pb[1])  # opposite C → |AB|
    perim = side_a + side_b + side_c
    if perim <= 0:
        raise FigureSpecError("degenerate triangle (zero perimeter) — incircle undefined")

    cx = (side_a * pa[0] + side_b * pb[0] + side_c * pc[0]) / perim
    cy = (side_a * pa[1] + side_b * pb[1] + side_c * pc[1]) / perim
    center = (cx, cy)

    # Inradius = Area / s. Area via the cross product of two edge
    # vectors (more numerically stable than Heron's formula at the
    # near-degenerate edge of the valid-triangle space).
    ex1, ey1 = pb[0] - pa[0], pb[1] - pa[1]
    ex2, ey2 = pc[0] - pa[0], pc[1] - pa[1]
    area = abs(ex1 * ey2 - ex2 * ey1) / 2
    if area <= 0:
        raise FigureSpecError("degenerate triangle (zero area) — incircle undefined")
    radius = area / (perim / 2)

    # Tangent points: project incenter onto each side. For a side
    # from P to Q, foot = P + ((I - P) · (Q - P) / |Q - P|²) · (Q - P).
    def _foot(p: Point, q: Point) -> Point:
        dx, dy = q[0] - p[0], q[1] - p[1]
        denom = dx * dx + dy * dy
        if denom == 0:
            raise FigureSpecError("degenerate side — tangent point undefined")
        t = ((cx - p[0]) * dx + (cy - p[1]) * dy) / denom
        return (p[0] + t * dx, p[1] + t * dy)

    tangent_points = [_foot(pa, pb), _foot(pb, pc), _foot(pc, pa)]
    return center, radius, tangent_points


def circumcircle_of_triangle(
    vertices: list[str], coords: dict[str, Point],
) -> tuple[Point, float]:
    """Compute the circumcircle (center, radius).

    Math:
    - Circumcenter is the intersection of the perpendicular bisectors
      of the sides. Closed-form formula via the determinant of a 3×3
      matrix of vertex coordinates; numerically equivalent and faster
      than solving the bisector system algebraically.
    - Circumradius = (a·b·c) / (4·Area).
    """
    a_name, b_name, c_name = vertices
    ax, ay = coords[a_name]
    bx, by = coords[b_name]
    cx_, cy_ = coords[c_name]

    # D = 2 · (ax·(by - cy) + bx·(cy - ay) + cx·(ay - by))
    d = 2 * (ax * (by - cy_) + bx * (cy_ - ay) + cx_ * (ay - by))
    if abs(d) < 1e-12:
        raise FigureSpecError(
            "degenerate triangle (collinear vertices) — circumcircle undefined",
        )

    ux = (
        (ax * ax + ay * ay) * (by - cy_)
        + (bx * bx + by * by) * (cy_ - ay)
        + (cx_ * cx_ + cy_ * cy_) * (ay - by)
    ) / d
    uy = (
        (ax * ax + ay * ay) * (cx_ - bx)
        + (bx * bx + by * by) * (ax - cx_)
        + (cx_ * cx_ + cy_ * cy_) * (bx - ax)
    ) / d
    center = (ux, uy)
    radius = math.hypot(ax - ux, ay - uy)
    return center, radius


def solve_polygon(spec: PolygonFigure) -> tuple[list[str], dict[str, Point]]:
    """Compute polygon vertex positions + the canonical name list.

    Regular mode: vertices sit evenly on a circle whose circumradius
    is derived from the side length via r = s / (2·sin(π/n)). First
    vertex placed at angle -π/2 (top of the polygon) so the figure
    reads upright (a square looks like a square, not diamond-rotated).

    Irregular mode: use vertex_positions verbatim. The caller (the
    LLM) is responsible for picking positions that form a sensible
    polygon — we don't check convexity or self-intersection because
    "concave" and "self-intersecting" are both legitimate teaching
    figures.
    """
    if spec.n_sides is not None:
        n = spec.n_sides
        # Circumradius from side length (chord-length formula).
        r = spec.side_length / (2 * math.sin(math.pi / n))
        # Orientation: read upright (flat bottom edge), not rotated.
        # - EVEN n: offset by π/n so a flat edge sits at the bottom
        #   (square → axis-aligned, hexagon → flat side down) rather than
        #   a vertex at top+bottom+left+right (a 45°-rotated diamond).
        # - ODD n: a regular odd polygon can't have flat edges top AND
        #   bottom, so the textbook orientation is a vertex pointing UP
        #   with a flat bottom (a pentagon "house"). That's start_angle
        #   = π/2 (a vertex at the top); π/2 + π/n would instead put a
        #   vertex at the BOTTOM (point-down, upside-down).
        start_angle = math.pi / 2 + (math.pi / n if n % 2 == 0 else 0.0)
        positions: list[Point] = []
        for i in range(n):
            theta = start_angle + 2 * math.pi * i / n
            positions.append((r * math.cos(theta), r * math.sin(theta)))
    else:
        assert spec.vertex_positions is not None  # validator guarantees
        positions = [(x, y) for x, y in spec.vertex_positions]
        n = len(positions)

    names = spec.vertex_names or [chr(ord("A") + i) for i in range(n)]
    coords = dict(zip(names, positions))
    return list(names), coords


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

    # External points: each is the intersection of two tangent/secant lines
    # defined by on-circle points. Computing it (rather than letting the LLM
    # place it) keeps the figure exact and is what makes tangent–secant /
    # power-of-a-point configurations drawable.
    for ext_name, ext in spec.external_points.items():
        p1, d1 = _circle_line_ray(ext.line1, coords)
        p2, d2 = _circle_line_ray(ext.line2, coords)
        pt = _intersect_lines(p1, d1, p2, d2)
        if pt is None:
            raise FigureSpecError(
                f"external point {ext_name!r}: its two lines are parallel and never meet",
            )
        # The whole point of an external point is that it lies OUTSIDE the
        # circle. If the two lines meet on/inside it, the spec describes an
        # interior intersection (a different configuration) — drop it loudly.
        if math.hypot(pt[0], pt[1]) <= spec.radius * (1.0 + 1e-6):
            raise FigureSpecError(
                f"external point {ext_name!r} lands on or inside the circle; "
                "its two lines must intersect outside the circle",
            )
        coords[ext_name] = pt
    return coords


def _circle_line_ray(line: CircleLine, coords: dict[str, Point]) -> tuple[Point, Point]:
    """A tangent/secant line as (point_on_line, direction_vector) in solved
    coords. A tangent at T is perpendicular to the radius OT; a secant runs
    through its two named on-circle points."""
    if line.tangent_at is not None:
        tx, ty = coords[line.tangent_at]
        # Perpendicular to the radius (tx, ty) — rotate 90°.
        return (tx, ty), (-ty, tx)
    a, b = line.secant_through  # type: ignore[misc]  # validator guarantees 2 names
    ax, ay = coords[a]
    bx, by = coords[b]
    return (ax, ay), (bx - ax, by - ay)


def _intersect_lines(
    p1: Point, d1: Point, p2: Point, d2: Point,
) -> Point | None:
    """Intersection of the infinite lines p1+t·d1 and p2+s·d2. Returns None
    when the lines are parallel (or coincident)."""
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(cross) < 1e-9:
        return None
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    t = (dx * d2[1] - dy * d2[0]) / cross
    return (p1[0] + t * d1[0], p1[1] + t * d1[1])


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
