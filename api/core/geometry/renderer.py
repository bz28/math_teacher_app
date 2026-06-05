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

import logging
import math
from typing import Any

from pydantic import TypeAdapter

from api.core.geometry.dsl import (
    CircleFigure,
    FigureSpec,
    FigureSpecError,
    PolygonFigure,
    TriangleCircleAnnotation,
    TriangleFigure,
)
from api.core.geometry.solver import (
    Point,
    circumcircle_of_triangle,
    incircle_of_triangle,
    solve_circle,
    solve_polygon,
    solve_triangle,
)

# Visual constants — single source of truth so tweaks land in one
# place. Sizes are in SVG user units; the viewBox is computed to fit
# the figure with PADDING units of margin on each side.
# `currentColor` lets the SVG inherit the surrounding CSS `color`
# property, so figures pick up the theme's text color (light text in
# dark mode, dark text in light mode). Without this, a hardcoded
# near-black stroke is invisible against the dark-mode bg #14130F.
# The frontend container (FigureDisplay) sets `color: var(--color-text)`
# so every line, label, and dot adapts to the active theme.
_STROKE = "currentColor"
_STROKE_WIDTH = 0.04
_FONT_FAMILY = "system-ui, sans-serif"
_LABEL_FONT_SIZE = 0.22
_VERTEX_FONT_SIZE = 0.28
_PADDING = 0.6
_RIGHT_ANGLE_SIZE = 0.25
_LABEL_OFFSET = 0.22

# Every visual constant above (stroke width, font sizes, marker sizes,
# label offsets) is an ABSOLUTE user-space length. They're tuned to look
# right when the figure spans roughly this many units. But the solver
# places vertices at the spec's literal magnitudes — a "3-4-5 triangle"
# spans ~5 units while a "130-140-150 field" spans ~150 and a fractional
# figure spans <1. Without normalization the text/stroke would be
# invisible on large figures and dwarf small ones. So every render
# function first rescales the solved coordinates so the figure's longest
# dimension equals _CANONICAL_SPAN, making the constants always correct.
_CANONICAL_SPAN = 5.0


logger = logging.getLogger(__name__)

# FigureSpec is a discriminated union; use TypeAdapter so Pydantic
# dispatches to the right shape variant from `spec.shape`.
_FIGURE_SPEC_ADAPTER: TypeAdapter[FigureSpec] = TypeAdapter(FigureSpec)


def render_figure(spec_dict: dict[str, Any]) -> str:
    """Validate a spec dict, solve it, and return an SVG string.

    Raises FigureSpecError on any structural, semantic, or geometric
    problem. The caller (question_bank_generation in PR 2) catches
    and decides whether to fall back to no-figure or retry.

    A spec without an explicit `shape` defaults to "triangle" — a
    convenience for the common case and for terse hand-written specs;
    the generation schema always emits `shape`, so this only affects
    callers that build specs by hand.
    """
    if "shape" not in spec_dict:
        spec_dict = {**spec_dict, "shape": "triangle"}
    try:
        spec = _FIGURE_SPEC_ADAPTER.validate_python(spec_dict)
    except Exception as e:
        # Pydantic raises ValidationError, but we collapse to our
        # error type so callers don't need to import pydantic just
        # to handle bad specs.
        raise FigureSpecError(f"invalid figure spec: {e}") from e

    if isinstance(spec, TriangleFigure):
        coords = solve_triangle(spec)
        return _render_triangle(spec, coords)
    if isinstance(spec, CircleFigure):
        coords = solve_circle(spec)
        return _render_circle(spec, coords)
    if isinstance(spec, PolygonFigure):
        names, poly_coords = solve_polygon(spec)
        return _render_polygon(spec, names, poly_coords)
    # Unreachable — discriminated union exhausts the shape variants,
    # but mypy doesn't know that without an explicit assert_never.
    raise FigureSpecError(f"unknown figure shape: {type(spec).__name__}")


def render_figure_or_none(raw_spec: Any, *, context: str = "figure_spec") -> str | None:
    """Render a figure spec to SVG, returning None on ANY failure.

    The degrade contract shared by every generation/decomposition call
    site: a bad figure must never tank the surrounding question or step.
    A non-dict (the model emitted no figure) returns None silently. A
    FigureSpecError (malformed spec) logs at warning level. Any other
    exception is a renderer bug — logged with a full traceback so it
    stays visible in monitoring — and still degrades to None rather than
    propagating. `context` tags the log line (e.g. "step figure_spec").
    """
    if not isinstance(raw_spec, dict):
        return None
    try:
        return render_figure(raw_spec)
    except FigureSpecError as e:
        logger.warning("%s rejected by renderer (dropping figure): %s", context, e)
        return None
    except Exception:
        logger.exception(
            "unexpected error rendering %s (dropping figure); spec=%r", context, raw_spec,
        )
        return None


def _scale_to_canonical(coords: dict[str, Point]) -> dict[str, Point]:
    """Rescale coordinates so the figure's longest dimension equals
    _CANONICAL_SPAN, keeping the absolute visual constants correct at
    any input magnitude. Origin-relative scaling preserves shape and
    relative position exactly; the viewBox re-centers afterward."""
    xs = [p[0] for p in coords.values()]
    ys = [p[1] for p in coords.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if span <= 0:
        return coords  # single point / degenerate — nothing to scale
    factor = _CANONICAL_SPAN / span
    return {k: (x * factor, y * factor) for k, (x, y) in coords.items()}


def _label_padding(texts: list[str]) -> float:
    """Extra viewBox margin so the longest label can't clip past the
    edge. A label anchored _LABEL_OFFSET outside the figure can extend up
    to its full text width further (worst case: it sits on the figure's
    extreme edge). Estimate that width from the character count (SVG can't
    measure text server-side) with a generous per-char width, so we
    over-reserve rather than clip. Falls back to _PADDING for short labels."""
    longest = max((len(t) for t in texts), default=0)
    # ~0.6em/char (generous for a proportional font) at the label font
    # size, reserved in full beyond the offset so even a long label on the
    # extreme edge can't clip.
    overhang = _LABEL_OFFSET + longest * _LABEL_FONT_SIZE * 0.6
    return max(_PADDING, overhang)


def _text(
    x: float, y: float, content: str, *,
    size: float = _LABEL_FONT_SIZE, dx: float = 0.0, dy: float = 0.0,
) -> str:
    """One centered <text> node in the renderer's standard style (font,
    middle anchors, theme stroke). Coordinates are already in SVG space
    (the caller negates cartesian y); `content` is escaped here. Single
    source of truth for label styling so a font/anchor/theming change is
    a one-line edit instead of ~12."""
    off = (f' dx="{dx:.4f}"' if dx else "") + (f' dy="{dy:.4f}"' if dy else "")
    return (
        f'<text x="{x:.4f}" y="{y:.4f}" '
        f'font-family="{_FONT_FAMILY}" font-size="{size:.4f}" '
        f'text-anchor="middle" dominant-baseline="middle" '
        f'fill="{_STROKE}"{off}>{_escape(content)}</text>'
    )


def _render_triangle(
    spec: TriangleFigure, coords: dict[str, Point],
) -> str:
    """Compose the SVG for a solved triangle. Layout sequence:
    viewBox first (so user-unit constants stay readable), then sides,
    overlay circles (incircle/circumcircle), then markings (right
    angle, labels) in z-order — text on top.
    """
    a, b, c = spec.vertices
    coords = _scale_to_canonical(coords)
    xs = [coords[v][0] for v in spec.vertices]
    ys = [coords[v][1] for v in spec.vertices]

    # Pre-compute overlay circles up front so the viewBox bounds them.
    # The incircle is always inside the triangle so doesn't change
    # bounds, but the circumcircle is bigger and would otherwise
    # clip out of the viewBox.
    incircle: tuple[Point, float, list[Point]] | None = None
    circumcircle: tuple[Point, float] | None = None
    if spec.inscribed_circle is not None:
        incircle = incircle_of_triangle(spec.vertices, coords)
    if spec.circumscribed_circle is not None:
        circumcircle = circumcircle_of_triangle(spec.vertices, coords)
        cc, cr = circumcircle
        xs.extend([cc[0] - cr, cc[0] + cr])
        ys.extend([cc[1] - cr, cc[1] + cr])

    pad = _label_padding([
        *spec.side_labels.values(),
        *spec.angle_labels.values(),
        *spec.vertex_labels.values(),
        *spec.vertices,
    ])
    min_x, max_x = min(xs) - pad, max(xs) + pad
    min_y, max_y = min(ys) - pad, max(ys) + pad
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
        f'preserveAspectRatio="xMidYMid meet" '
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

    # 2. Overlay circles (incircle / circumcircle). Drawn UNDER the
    # right-angle marker and labels so text remains readable on top.
    if incircle is not None and spec.inscribed_circle is not None:
        parts.extend(_overlay_circle_geometry(incircle[0], incircle[1]))
        if spec.inscribed_circle.show_tangent_points:
            for tp in incircle[2]:
                parts.append(_dot_at(tp))
        if spec.inscribed_circle.radius_label and incircle[2]:
            # Draw a labeled radius from incenter to first tangent point.
            parts.append(_radius_line(incircle[0], incircle[2][0]))
        if spec.inscribed_circle.show_center:
            parts.append(_dot_at(incircle[0]))
    if circumcircle is not None and spec.circumscribed_circle is not None:
        parts.extend(_overlay_circle_geometry(circumcircle[0], circumcircle[1]))
        if spec.circumscribed_circle.radius_label:
            # Labeled radius from circumcenter to first vertex.
            parts.append(_radius_line(circumcircle[0], coords[spec.vertices[0]]))
        if spec.circumscribed_circle.show_center:
            parts.append(_dot_at(circumcircle[0]))

    # 3. Right-angle markers (little squares at the vertex). These go
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

    # 4. Compound annotation labels — center labels + radius labels for
    # the inscribed/circumscribed circles when those affordances are
    # requested. Positioned in upright SVG coords (negate y from cartesian).
    if incircle is not None and spec.inscribed_circle is not None:
        parts.extend(
            _circle_annotation_labels(
                spec.inscribed_circle, incircle[0], incircle[2][0] if incircle[2] else None,
            ),
        )
    if circumcircle is not None and spec.circumscribed_circle is not None:
        parts.extend(
            _circle_annotation_labels(
                spec.circumscribed_circle,
                circumcircle[0],
                coords[spec.vertices[0]],
            ),
        )

    parts.append("</svg>")
    return "".join(parts)


def _overlay_circle_geometry(center: Point, radius: float) -> list[str]:
    """Geometry-mode SVG fragments for an overlay circle (drawn inside
    the flipped <g>). Just the outline; dots / radius lines / labels
    are added separately so the caller can opt in to each."""
    cx, cy = center
    return [
        f'<circle cx="{cx:.4f}" cy="{cy:.4f}" r="{radius:.4f}" '
        f'fill="none" stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}"/>',
    ]


def _dot_at(p: Point) -> str:
    """Tiny filled marker — used for incircle center, tangent points,
    circumcenter. Sized off the right-angle constant so all markers
    feel proportional across the figure."""
    dot_r = _RIGHT_ANGLE_SIZE * 0.15
    return (
        f'<circle cx="{p[0]:.4f}" cy="{p[1]:.4f}" r="{dot_r:.4f}" fill="{_STROKE}"/>'
    )


def _radius_line(from_pt: Point, to_pt: Point) -> str:
    """Labeled radius — the line itself. The text label is rendered
    later in upright SVG coords by _circle_annotation_labels."""
    return (
        f'<line x1="{from_pt[0]:.4f}" y1="{from_pt[1]:.4f}" '
        f'x2="{to_pt[0]:.4f}" y2="{to_pt[1]:.4f}" '
        f'stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}"/>'
    )


def _circle_annotation_labels(
    annotation: TriangleCircleAnnotation,
    center: Point,
    radius_endpoint: Point | None,
) -> list[str]:
    """Upright-SVG text for an overlay circle's center / radius labels.
    Called AFTER the </g> flip is closed, so y values are negated from
    cartesian. radius_endpoint may be None when the circle has no
    natural radius target (defensive only — current callers always
    pass one when radius_label is set)."""
    out: list[str] = []
    if annotation.show_center:
        cx, cy = center
        out.append(_text(
            cx, -cy, annotation.center_label,
            size=_VERTEX_FONT_SIZE, dx=0.18, dy=0.25,
        ))
    if annotation.radius_label and radius_endpoint is not None:
        # Midpoint of the radius line, with a small perpendicular
        # offset so the label doesn't sit on top of the line.
        mid_x = (center[0] + radius_endpoint[0]) / 2
        mid_y = (center[1] + radius_endpoint[1]) / 2
        dx = radius_endpoint[0] - center[0]
        dy = radius_endpoint[1] - center[1]
        norm = math.hypot(dx, dy) or 1.0
        # Perpendicular = rotate (dx,dy)/norm by 90° = (-dy, dx)/norm.
        ox = (-dy / norm) * _LABEL_OFFSET * 0.6
        oy = (dx / norm) * _LABEL_OFFSET * 0.6
        out.append(_text(mid_x + ox, -(mid_y + oy), annotation.radius_label))
    return out


def _render_polygon(
    spec: PolygonFigure, names: list[str], coords: dict[str, Point],
) -> str:
    """Compose the SVG for a polygon. Layout sequence:
    viewBox → polygon outline → vertex dots + labels → side labels →
    angle labels.
    """
    coords = _scale_to_canonical(coords)
    xs = [coords[v][0] for v in names]
    ys = [coords[v][1] for v in names]
    pad = _label_padding([
        *spec.side_labels.values(),
        *spec.angle_labels.values(),
        *names,
    ])
    min_x, max_x = min(xs) - pad, max(xs) + pad
    min_y, max_y = min(ys) - pad, max(ys) + pad
    width = max_x - min_x
    height = max_y - min_y

    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{min_x:.4f} {-max_y:.4f} {width:.4f} {height:.4f}" '
        f'preserveAspectRatio="xMidYMid meet" '
        f'role="img" aria-label="Geometry figure">',
    )
    parts.append('<g transform="scale(1,-1)">')

    # 1. Polygon outline as one polygon element — clean miters at
    # vertices.
    points_attr = " ".join(f"{coords[v][0]:.4f},{coords[v][1]:.4f}" for v in names)
    parts.append(
        f'<polygon points="{points_attr}" fill="none" '
        f'stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}" '
        'stroke-linejoin="round"/>',
    )

    parts.append("</g>")  # close flip — text uses upright SVG coords

    # 2. Vertex labels — same outward-from-centroid heuristic the
    # triangle path uses, scaled for n vertices.
    cx_avg = sum(coords[v][0] for v in names) / len(names)
    cy_avg = sum(coords[v][1] for v in names) / len(names)
    for v in names:
        x, y = coords[v]
        # Vector from centroid to vertex, normalized.
        dx, dy = x - cx_avg, y - cy_avg
        norm = math.hypot(dx, dy) or 1.0
        ox = (dx / norm) * _LABEL_OFFSET
        oy = (dy / norm) * _LABEL_OFFSET
        parts.append(_text(x + ox, -(y + oy), v, size=_VERTEX_FONT_SIZE))

    # 3. Side labels — perpendicular to the edge, on the outside
    # (away from the centroid).
    for edge_key, text in spec.side_labels.items():
        v1, v2 = edge_key[0], edge_key[1]
        if v1 not in coords or v2 not in coords:
            continue  # defensive — validator already enforces
        x1, y1 = coords[v1]
        x2, y2 = coords[v2]
        mid_x = (x1 + x2) / 2
        mid_y = (y1 + y2) / 2
        # Perpendicular to edge, outward (= away from centroid).
        edge_x = x2 - x1
        edge_y = y2 - y1
        norm = math.hypot(edge_x, edge_y) or 1.0
        # Two perpendiculars; pick the one pointing AWAY from centroid.
        nx, ny = -edge_y / norm, edge_x / norm
        if (mid_x - cx_avg) * nx + (mid_y - cy_avg) * ny < 0:
            nx, ny = -nx, -ny
        label_x = mid_x + nx * _LABEL_OFFSET
        label_y = mid_y + ny * _LABEL_OFFSET
        parts.append(_text(label_x, -label_y, text))

    # 4. Angle labels — sit slightly inside the vertex, toward centroid.
    for v, text in spec.angle_labels.items():
        x, y = coords[v]
        dx, dy = cx_avg - x, cy_avg - y
        norm = math.hypot(dx, dy) or 1.0
        ox = (dx / norm) * _LABEL_OFFSET * 1.2
        oy = (dy / norm) * _LABEL_OFFSET * 1.2
        parts.append(_text(x + ox, -(y + oy), text))

    parts.append("</svg>")
    return "".join(parts)


def _render_circle(
    spec: CircleFigure, coords: dict[str, Point],
) -> str:
    """Compose the SVG for a solved circle. Order:
    viewBox → circle outline → chords (under labels) → radius line if
    labeled → center dot if requested → point dots + labels → label
    text on top.
    """
    # Normalize so the circle's diameter equals _CANONICAL_SPAN, keeping
    # the absolute visual constants legible regardless of the spec's
    # radius (r=0.5 vs r=500 both render the same on-screen size).
    scale = _CANONICAL_SPAN / (2 * spec.radius)
    radius = spec.radius * scale
    coords = {k: (x * scale, y * scale) for k, (x, y) in coords.items()}

    # Bounding box: extend radius units around center, plus padding.
    pad = _label_padding([
        *spec.point_labels.values(),
        *spec.chord_labels.values(),
        *spec.points,
        spec.center_label if spec.show_center else "",
        spec.radius_label or "",
    ])
    bound = radius
    min_x, max_x = -bound - pad, bound + pad
    min_y, max_y = -bound - pad, bound + pad
    width = max_x - min_x
    height = max_y - min_y

    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{min_x:.4f} {-max_y:.4f} {width:.4f} {height:.4f}" '
        f'preserveAspectRatio="xMidYMid meet" '
        f'role="img" aria-label="Geometry figure">',
    )
    parts.append('<g transform="scale(1,-1)">')

    # 1. Circle outline.
    parts.append(
        f'<circle cx="0" cy="0" r="{radius:.4f}" '
        f'fill="none" stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}"/>',
    )

    # 2. Chords.
    for chord in spec.chords:
        a, b = chord[0], chord[1]
        if a not in coords or b not in coords:
            continue  # defensive — validator already enforces
        x1, y1 = coords[a]
        x2, y2 = coords[b]
        parts.append(
            f'<line x1="{x1:.4f}" y1="{y1:.4f}" x2="{x2:.4f}" y2="{y2:.4f}" '
            f'stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}"/>',
        )

    # 3. Optional radius line (from center to first named point) — drawn
    # whenever radius_label is set so the label has something to anchor on.
    radius_target: str | None = None
    if spec.radius_label and spec.points:
        radius_target = next(iter(spec.points))
        rx, ry = coords[radius_target]
        parts.append(
            f'<line x1="0" y1="0" x2="{rx:.4f}" y2="{ry:.4f}" '
            f'stroke="{_STROKE}" stroke-width="{_STROKE_WIDTH}"/>',
        )

    # 4. Center dot when requested.
    if spec.show_center:
        # Tiny filled circle. Size scaled with _RIGHT_ANGLE_SIZE so it
        # reads as proportional across triangles + circles.
        dot_r = _RIGHT_ANGLE_SIZE * 0.15
        parts.append(
            f'<circle cx="0" cy="0" r="{dot_r:.4f}" fill="{_STROKE}"/>',
        )

    # 5. Point dots — small filled dots so the named circumference
    # points read as discrete markers rather than implicit corners.
    dot_r = _RIGHT_ANGLE_SIZE * 0.15
    for name in spec.points:
        x, y = coords[name]
        parts.append(
            f'<circle cx="{x:.4f}" cy="{y:.4f}" r="{dot_r:.4f}" fill="{_STROKE}"/>',
        )

    parts.append("</g>")  # close the flipped group — text uses upright coords

    # 6. Center label.
    if spec.show_center:
        parts.append(_text(
            0.0, 0.0, spec.center_label,
            size=_VERTEX_FONT_SIZE, dx=0.15, dy=0.25,
        ))

    # 7. Point labels — offset radially outward so they don't sit on
    # top of the circle outline.
    for name in spec.points:
        x, y = coords[name]
        display = spec.point_labels.get(name, name)
        # Outward-radial offset of _LABEL_OFFSET units.
        norm = math.hypot(x, y) or 1.0  # 1.0 guard for degenerate radius=0 (impossible: validator)
        ox = (x / norm) * _LABEL_OFFSET
        oy = (y / norm) * _LABEL_OFFSET
        parts.append(_text(x + ox, -(y + oy), display, size=_VERTEX_FONT_SIZE))

    # 8. Chord labels — midpoint of chord, offset perpendicular OUTWARD
    # (away from center).
    for chord in spec.chords:
        label = spec.chord_labels.get(chord) or spec.chord_labels.get(chord[::-1])
        if not label:
            continue
        a, b = chord[0], chord[1]
        x1, y1 = coords[a]
        x2, y2 = coords[b]
        mid_x = (x1 + x2) / 2
        mid_y = (y1 + y2) / 2
        # Outward = away from center (the origin). When the midpoint
        # IS the center (e.g. a diameter — points 180° apart), there's
        # no defined "outward" direction, so fall back to the chord's
        # own perpendicular. Without this fallback, diameter labels
        # land exactly at the origin and overlap the center dot.
        norm = math.hypot(mid_x, mid_y)
        if norm < 1e-9:
            edge_x = x2 - x1
            edge_y = y2 - y1
            edge_norm = math.hypot(edge_x, edge_y) or 1.0
            # Perpendicular: rotate 90° (any side reads fine when the
            # midpoint is the center — there's no inside/outside to
            # disambiguate).
            ox = (-edge_y / edge_norm) * _LABEL_OFFSET
            oy = (edge_x / edge_norm) * _LABEL_OFFSET
        else:
            ox = (mid_x / norm) * _LABEL_OFFSET
            oy = (mid_y / norm) * _LABEL_OFFSET
        parts.append(_text(mid_x + ox, -(mid_y + oy), label))

    # 9. Radius label — midpoint of the radius line, perpendicular
    # offset for readability.
    if spec.radius_label and radius_target:
        rx, ry = coords[radius_target]
        mid_x = rx / 2
        mid_y = ry / 2
        # Perpendicular to the radius vector (rotate 90°). Either side
        # works; the side that's "above" relative to the chord layout
        # is fine for a single radius.
        norm = math.hypot(rx, ry) or 1.0
        # Perpendicular unit vector: rotate (rx,ry)/norm by 90° = (-ry, rx)/norm
        ox = (-ry / norm) * _LABEL_OFFSET * 0.6
        oy = (rx / norm) * _LABEL_OFFSET * 0.6
        parts.append(_text(mid_x + ox, -(mid_y + oy), spec.radius_label))

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
    return _text(x + ox, y_svg + oy, text, size=_VERTEX_FONT_SIZE)


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
    return _text(label_x, label_y_svg, text)


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
    return _text(x + ox, y_svg + oy, text)


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


__all__ = ["render_figure"]
