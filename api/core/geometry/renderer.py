"""SVG renderer for solved triangle coordinates.

Output is plain SVG (no external library). The deliberate constraint:
the SVG must be safe to embed via dangerouslySetInnerHTML after
sanitization on the frontend. Therefore: no <script>, no event
handlers, no external refs — just <svg>, <line>, <polygon>, <text>,
<path>, <circle>.

The renderer is opinionated about visual style (single accent color,
sans font, modest stroke weights) — geometry diagrams should look
calm and textbook-like, not decorative.
"""

from __future__ import annotations

import math
from typing import Any

from api.core.geometry.dsl import FigureSpec, FigureSpecError, TriangleFigure
from api.core.geometry.solver import Point, _canonical_edge, solve_triangle

# Visual constants — single source of truth so tweaks land in one
# place. Sizes are in SVG user units; the viewBox is computed to fit
# the figure with PADDING units of margin on each side.
_STROKE = "#14130f"
_STROKE_WIDTH = 0.04
_FONT_FAMILY = "system-ui, sans-serif"
_LABEL_FONT_SIZE = 0.22
_VERTEX_FONT_SIZE = 0.28
_PADDING = 0.6
_RIGHT_ANGLE_SIZE = 0.25
_LABEL_OFFSET = 0.22


def render_figure(spec_dict: dict[str, Any]) -> str:
    """Validate a spec dict, solve it, and return an SVG string.

    Raises FigureSpecError on any structural, semantic, or geometric
    problem. The caller (question_bank_generation in PR 2) catches
    and decides whether to fall back to no-figure or retry.
    """
    try:
        spec = FigureSpec.model_validate(spec_dict)
    except Exception as e:
        # Pydantic raises ValidationError, but we collapse to our
        # error type so callers don't need to import pydantic just
        # to handle bad specs.
        raise FigureSpecError(f"invalid figure spec: {e}") from e

    coords = solve_triangle(spec)
    return _render_triangle(spec, coords)


def _render_triangle(
    spec: TriangleFigure, coords: dict[str, Point],
) -> str:
    """Compose the SVG for a solved triangle. Layout sequence:
    viewBox first (so user-unit constants stay readable), then sides,
    then markings (right angle, labels) in z-order — text on top.
    """
    a, b, c = spec.vertices
    xs = [coords[v][0] for v in spec.vertices]
    ys = [coords[v][1] for v in spec.vertices]
    min_x, max_x = min(xs) - _PADDING, max(xs) + _PADDING
    min_y, max_y = min(ys) - _PADDING, max(ys) + _PADDING
    width = max_x - min_x
    height = max_y - min_y

    # SVG y-axis points DOWN; cartesian y-axis points UP. To draw the
    # triangle the "right way up" we flip the viewBox's y origin. The
    # cleanest way is a single <g transform="scale(1,-1)"> wrapping
    # every coordinate-using element — that way coords stay in
    # cartesian throughout the file and there's exactly one place
    # where the flip happens.
    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{min_x:.4f} {-max_y:.4f} {width:.4f} {height:.4f}" '
        f'role="img" aria-label="Geometry figure">',
    )
    parts.append('<g transform="scale(1,-1)">')

    # 1. Triangle outline (a single polygon — cheaper than three lines
    # and produces a clean miter at the vertices automatically).
    points_attr = " ".join(f"{coords[v][0]:.4f},{coords[v][1]:.4f}" for v in spec.vertices)
    parts.append(
        f'<polygon points="{points_attr}" fill="none" '
        f'stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}" '
        'stroke-linejoin="round"/>',
    )

    # 2. Right-angle markers (little squares at the vertex). These go
    # under the labels so a tight diagram still reads cleanly.
    for vertex in spec.right_angle_at:
        parts.append(_right_angle_marker(vertex, coords, spec.vertices))

    parts.append("</g>")  # close the flipped group — text below uses upright coords

    # 3. Labels. SVG <text> renders LTR even inside a flipped group,
    # but the baseline flips with it — confusing to read. Instead,
    # we close the flip and compute text positions in upright SVG
    # coords (i.e. negate y when reading from `coords`).
    for vertex in spec.vertices:
        x, y = coords[vertex]
        parts.append(_vertex_label(spec, vertex, x, -y, coords))

    for edge_key, text in spec.side_labels.items():
        parts.append(_side_label(coords, edge_key, text))

    for vertex, text in spec.angle_labels.items():
        x, y = coords[vertex]
        parts.append(_angle_label_text(spec, vertex, x, -y, coords, text))

    parts.append("</svg>")
    return "".join(parts)


def _right_angle_marker(
    vertex: str, coords: dict[str, Point], all_vertices: list[str],
) -> str:
    """Draw the conventional small square at a vertex. Sized off the
    visual constant so it looks consistent across triangles of
    different scale (we don't auto-scale it from edge length — that
    causes huge markers on tiny triangles)."""
    # Find the two edges meeting at this vertex.
    others = [v for v in all_vertices if v != vertex]
    p0 = coords[vertex]
    p1 = coords[others[0]]
    p2 = coords[others[1]]
    # Unit vectors along each edge from `vertex`.
    u1 = _unit(p0, p1)
    u2 = _unit(p0, p2)
    # Square corners (inside the angle).
    s = _RIGHT_ANGLE_SIZE
    c1 = (p0[0] + u1[0] * s, p0[1] + u1[1] * s)
    c2 = (p0[0] + u1[0] * s + u2[0] * s, p0[1] + u1[1] * s + u2[1] * s)
    c3 = (p0[0] + u2[0] * s, p0[1] + u2[1] * s)
    pts = f"{c1[0]:.4f},{c1[1]:.4f} {c2[0]:.4f},{c2[1]:.4f} {c3[0]:.4f},{c3[1]:.4f}"
    return (
        f'<polyline points="{pts}" fill="none" '
        f'stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}" '
        'stroke-linejoin="round"/>'
    )


def _unit(p_from: Point, p_to: Point) -> Point:
    dx, dy = p_to[0] - p_from[0], p_to[1] - p_from[1]
    norm = math.hypot(dx, dy)
    if norm == 0:
        # Degenerate edge — solver should have rejected this earlier.
        # Guard anyway so a div-by-zero doesn't leak into the SVG.
        raise FigureSpecError("degenerate edge: two vertices coincide")
    return (dx / norm, dy / norm)


def _vertex_label(
    spec: TriangleFigure,
    vertex: str,
    x: float,
    y_svg: float,
    coords: dict[str, Point],
) -> str:
    """Vertex labels sit outside the triangle, opposite the centroid.
    Pushing them outward keeps them clear of the sides regardless of
    the triangle's shape — no per-vertex heuristics required.
    """
    text = spec.vertex_labels.get(vertex, vertex)
    cx = sum(coords[v][0] for v in spec.vertices) / 3
    cy = -sum(coords[v][1] for v in spec.vertices) / 3  # already in svg coords
    # Direction from centroid to vertex.
    dx, dy = x - cx, y_svg - cy
    norm = math.hypot(dx, dy)
    if norm == 0:
        ox, oy = 0.0, -_LABEL_OFFSET
    else:
        ox = (dx / norm) * _LABEL_OFFSET
        oy = (dy / norm) * _LABEL_OFFSET
    return (
        f'<text x="{x + ox:.4f}" y="{y_svg + oy:.4f}" '
        f'font-family="{_FONT_FAMILY}" font-size="{_VERTEX_FONT_SIZE}" '
        'text-anchor="middle" dominant-baseline="middle" '
        f'fill="{_STROKE}">{_escape(text)}</text>'
    )


def _side_label(
    coords: dict[str, Point], edge_key: str, text: str,
) -> str:
    """Side labels go at the midpoint of the edge, offset
    perpendicular to the edge on the OUTSIDE of the triangle. The
    outside direction is computed by checking which side of the edge
    the third vertex sits on, then choosing the opposite normal.
    """
    v1, v2 = edge_key[0], edge_key[1]
    p1 = coords[v1]
    p2 = coords[v2]
    mid_x = (p1[0] + p2[0]) / 2
    mid_y = (p1[1] + p2[1]) / 2

    # The third vertex — only one is left after removing the two on the edge.
    third = next(v for v in coords if v not in edge_key)
    p3 = coords[third]

    # Perpendicular to edge (rotate edge vector 90°).
    edge_x = p2[0] - p1[0]
    edge_y = p2[1] - p1[1]
    norm = math.hypot(edge_x, edge_y)
    if norm == 0:
        raise FigureSpecError(f"degenerate side {edge_key}")
    # Two unit perpendiculars; pick the one pointing AWAY from p3.
    nx, ny = -edge_y / norm, edge_x / norm
    # Sign check: dot product of (mid → p3) with (nx, ny). Same sign
    # means the perpendicular points TOWARD p3 → flip it.
    if (p3[0] - mid_x) * nx + (p3[1] - mid_y) * ny > 0:
        nx, ny = -nx, -ny

    label_x = mid_x + nx * _LABEL_OFFSET
    label_y_cart = mid_y + ny * _LABEL_OFFSET
    label_y_svg = -label_y_cart
    return (
        f'<text x="{label_x:.4f}" y="{label_y_svg:.4f}" '
        f'font-family="{_FONT_FAMILY}" font-size="{_LABEL_FONT_SIZE}" '
        'text-anchor="middle" dominant-baseline="middle" '
        f'fill="{_STROKE}">{_escape(text)}</text>'
    )


def _angle_label_text(
    spec: TriangleFigure,
    vertex: str,
    x: float,
    y_svg: float,
    coords: dict[str, Point],
    text: str,
) -> str:
    """Angle labels sit just INSIDE the vertex (between the two arms)
    so they read as belonging to the angle, not the vertex point.
    Direction-toward-centroid as a heuristic — works for non-obtuse
    triangles; obtuse triangles slightly clip but stay legible.
    """
    cx = sum(coords[v][0] for v in spec.vertices) / 3
    cy = -sum(coords[v][1] for v in spec.vertices) / 3
    dx, dy = cx - x, cy - y_svg
    norm = math.hypot(dx, dy)
    if norm == 0:
        ox, oy = 0.0, 0.0
    else:
        ox = (dx / norm) * _LABEL_OFFSET * 1.4
        oy = (dy / norm) * _LABEL_OFFSET * 1.4
    return (
        f'<text x="{x + ox:.4f}" y="{y_svg + oy:.4f}" '
        f'font-family="{_FONT_FAMILY}" font-size="{_LABEL_FONT_SIZE}" '
        'text-anchor="middle" dominant-baseline="middle" '
        f'fill="{_STROKE}">{_escape(text)}</text>'
    )


def _escape(text: str) -> str:
    """Minimal XML escape for text node content. Attributes get the
    same treatment via the format strings; we don't accept untrusted
    attribute values here so the surface is small.
    """
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# Re-export for callers that want to skip render and just solve.
__all__ = ["render_figure", "_canonical_edge"]
