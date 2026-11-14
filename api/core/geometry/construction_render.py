"""SVG for a construction figure (points at coordinates + what to draw).

Same visual language as the solver-backed shapes in renderer.py: one theme
colour (currentColor), the same stroke and font constants, coordinates
rescaled to the canonical span, and only the tags and attributes the web
sanitizer allows (web/src/lib/sanitize-svg.ts): svg, g, line, polyline,
polygon, path, circle, text. No background rect — the container's theme
shows through, as with every other figure.

Layout: the cartesian drawing sits inside one flipped <g>; text is placed
afterwards in upright SVG coordinates (y negated), as renderer.py does.
"""

from __future__ import annotations

import math
import re

from api.core.geometry.dsl import (
    ConstructionArc,
    ConstructionFigure,
    ConstructionLine,
    is_hidden,
    split_points,
    used_points,
)
from api.core.geometry.renderer import (
    _CANONICAL_SPAN,
    _LABEL_FONT_SIZE,
    _LABEL_OFFSET,
    _RIGHT_ANGLE_SIZE,
    _STROKE,
    _STROKE_WIDTH,
    _VERTEX_FONT_SIZE,
    _label_padding,
    _text,
)
from api.core.geometry.solver import Point

# How far rays and lines run past the outermost point, so they read as
# unbounded (with an arrowhead) rather than as segments.
_LINE_MARGIN = 0.45
_ARROW = 0.13
_TICK_HALF = 0.09
_TICK_GAP = 0.07
_MARK_ARC_R = 0.26
_MARK_ARC_STEP = 0.06
_ANGLE_LABEL_R = 0.52
_DOT_R = _RIGHT_ANGLE_SIZE * 0.15
_SHADE_OPACITY = "0.15"


def _f(v: float) -> str:
    return f"{v:.4f}"


def _unit(a: Point, b: Point) -> Point:
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def _line(a: Point, b: Point, width: float = _STROKE_WIDTH) -> str:
    return (
        f'<line x1="{_f(a[0])}" y1="{_f(a[1])}" x2="{_f(b[0])}" y2="{_f(b[1])}" '
        f'stroke="{_STROKE}" stroke-width="{_f(width)}" stroke-linecap="round"/>'
    )


def _polyline(pts: list[Point], width: float = _STROKE_WIDTH) -> str:
    attr = " ".join(f"{_f(x)},{_f(y)}" for x, y in pts)
    return (
        f'<polyline points="{attr}" fill="none" stroke="{_STROKE}" '
        f'stroke-width="{_f(width)}" stroke-linejoin="round" stroke-linecap="round"/>'
    )


def _chevron(tip: Point, direction: Point, size: float = _ARROW) -> str:
    """An open arrowhead whose point is `tip`, pointing along `direction`."""
    ux, uy = direction
    back = (tip[0] - ux * size, tip[1] - uy * size)
    side = (-uy * size * 0.6, ux * size * 0.6)
    return _polyline([
        (back[0] + side[0], back[1] + side[1]), tip, (back[0] - side[0], back[1] - side[1]),
    ])


def _exit(origin: Point, direction: Point, box: tuple[float, float, float, float]) -> float:
    """Distance along `direction` from `origin` (inside `box`) to the box edge."""
    min_x, min_y, max_x, max_y = box
    best = math.inf
    for comp, lo, hi, o in ((direction[0], min_x, max_x, origin[0]), (direction[1], min_y, max_y, origin[1])):
        if comp > 1e-12:
            best = min(best, (hi - o) / comp)
        elif comp < -1e-12:
            best = min(best, (lo - o) / comp)
    return 0.0 if best is math.inf else max(best, 0.0)


def _angle_dirs(p: dict[str, Point], ref: str) -> tuple[Point, float, float]:
    """Vertex, start direction (radians) and sweep (< π, counter-clockwise)
    of the non-reflex angle `ref` = "XVY"."""
    x, v, y = split_points(ref, 3)
    a1 = math.atan2(p[x][1] - p[v][1], p[x][0] - p[v][0])
    a2 = math.atan2(p[y][1] - p[v][1], p[y][0] - p[v][0])
    sweep = (a2 - a1) % (2 * math.pi)
    if sweep > math.pi:
        a1, sweep = a2, 2 * math.pi - sweep
    return p[v], a1, sweep


def _arc_path(center: Point, r: float, start: float, sweep: float) -> str:
    p1 = (center[0] + r * math.cos(start), center[1] + r * math.sin(start))
    p2 = (center[0] + r * math.cos(start + sweep), center[1] + r * math.sin(start + sweep))
    large = 1 if sweep > math.pi else 0
    # Inside the flipped group the local frame is cartesian, where
    # sweep-flag 1 runs counter-clockwise.
    return f"M{_f(p1[0])},{_f(p1[1])} A{_f(r)},{_f(r)} 0 {large} 1 {_f(p2[0])},{_f(p2[1])}"


def arc_span(p: dict[str, Point], arc: ConstructionArc) -> tuple[Point, float, float, float]:
    """(centre, radius, start angle, counter-clockwise sweep) of the arc as
    drawn: the minor side of its ends, or the major side when `major`."""
    c = p[arc.center]
    e0, e1 = p[arc.endpoints[0]], p[arc.endpoints[1]]
    r = math.dist(c, e0)
    a1 = math.atan2(e0[1] - c[1], e0[0] - c[0])
    a2 = math.atan2(e1[1] - c[1], e1[0] - c[0])
    sweep = (a2 - a1) % (2 * math.pi)
    if sweep > math.pi:
        a1, sweep = a2, 2 * math.pi - sweep
    if arc.major:
        a1, sweep = a1 + sweep, 2 * math.pi - sweep
    return c, r, a1, sweep


def _circle_radius(spec: ConstructionFigure, p: dict[str, Point], i: int, factor: float) -> float:
    circle = spec.circles[i]
    if circle.through:
        return math.dist(p[circle.center], p[circle.through])
    return (circle.radius or 0.0) * factor


def _between(a: Point, b: Point, q: Point, tol: float) -> float | None:
    """Parameter of `q` along a→b when q lies on the line ab, else None."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n2 = dx * dx + dy * dy
    if n2 == 0:
        return None
    cross = (q[0] - a[0]) * dy - (q[1] - a[1]) * dx
    if abs(cross) / math.sqrt(n2) > tol:
        return None
    return ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / n2


# Another point's label is in the way within this many label offsets.
_NEIGHBOUR = 4.0


def _incident_directions(
    spec: ConstructionFigure, p: dict[str, Point], radii: list[float], name: str,
) -> list[float]:
    """Directions (radians) of every drawn stroke leaving point `name`, so
    its label can sit in the widest empty gap between them."""
    q = p[name]
    tol = 1e-6 * _CANONICAL_SPAN
    out: list[float] = []

    def add(d: Point) -> None:
        out.append(math.atan2(d[1], d[0]))

    def along(a: Point, b: Point, lo: float, hi: float) -> None:
        t = _between(a, b, q, tol)
        if t is None or t < lo - 1e-9 or t > hi + 1e-9:
            return
        u = _unit(a, b)
        if t > lo + 1e-9:
            add((-u[0], -u[1]))
        if t < hi - 1e-9:
            add(u)

    for ref in spec.segments:
        a, b = split_points(ref, 2)
        along(p[a], p[b], 0.0, 1.0)
    for ref in spec.rays:
        a, b = split_points(ref, 2)
        along(p[a], p[b], 0.0, math.inf)
    for line in spec.lines:
        along(p[line.through[0]], p[line.through[1]], -math.inf, math.inf)
    for i, circle in enumerate(spec.circles):
        c = p[circle.center]
        if abs(math.dist(c, q) - radii[i]) < 1e-6 * _CANONICAL_SPAN and radii[i] > 0:
            u = _unit(c, q)
            add((-u[1], u[0]))
            add((u[1], -u[0]))
    # A labelled point close by takes that direction too, so two labels
    # never land on each other (B and D 2 units apart: "B" over "D").
    for other, r in p.items():
        if other != name and not is_hidden(other) and 1e-9 < math.dist(q, r) < _NEIGHBOUR * _LABEL_OFFSET:
            add(_unit(q, r))
    return out


def _label_direction(dirs: list[float], fallback: Point) -> Point:
    if not dirs:
        return fallback
    ds = sorted(d % (2 * math.pi) for d in dirs)
    best_gap, best_mid = -1.0, 0.0
    for i, d in enumerate(ds):
        nxt = ds[(i + 1) % len(ds)] + (2 * math.pi if i == len(ds) - 1 else 0.0)
        gap = nxt - d
        if gap > best_gap + 1e-9:
            best_gap, best_mid = gap, d + gap / 2
    return math.cos(best_mid), math.sin(best_mid)


def _labelled(line: ConstructionLine) -> bool:
    """A line's name is written by its end unless the name is only its two
    points ("AB" through A and B reads as line AB already)."""
    return bool(line.name) and line.name not in ("".join(line.through), "".join(reversed(line.through)))


def _line_name(name: str) -> str:
    """'ell_1' / '\\ell_1' / 'l_1' → 'ℓ1'; anything else as written."""
    n = name.replace("\\", "").replace("{", "").replace("}", "")
    for prefix in ("ell_", "ell", "l_"):
        if n.startswith(prefix) and (n[len(prefix):].isdigit() or prefix == "ell"):
            return "ℓ" + n[len(prefix):]
    return n


_SPAN_ARC_R = 0.95
# A label further out than this stops reading as its angle's label.
_ANGLE_LABEL_MAX_R = 1.0


def _is_angle_name(text: str) -> bool:
    """'1', '2' name an angle (∠1); a measure or expression does not."""
    return re.fullmatch(r"\s*\d+\s*", text) is not None


def _span_label_spot(
    v: Point, a1: float, sweep: float, ra: float, text: str, inside: list[float],
) -> tuple[float, float, float]:
    """A whole angle's label, just outside its wide arc, in the part of the
    angle around the bisector that no inner arm runs through (the wider
    neighbour when an arm lies on the bisector, as a bisector ray does)."""
    half = 0.3 * _LABEL_FONT_SIZE * max(len(text), 1)
    cuts = sorted([0.0, *((d - a1) % (2 * math.pi) for d in inside), sweep])
    gaps = list(zip(cuts, cuts[1:]))
    mid = sweep / 2
    near = min(gaps, key=lambda g: 0.0 if g[0] <= mid <= g[1] else min(abs(g[0] - mid), abs(g[1] - mid)))
    i = gaps.index(near)
    if min(mid - near[0], near[1] - mid) < math.radians(8):
        # An arm (nearly) on the bisector: use the wider gap beside it.
        side = [g for g in (gaps[i - 1] if i > 0 else None, near, gaps[i + 1] if i + 1 < len(gaps) else None) if g]
        near = max(side, key=lambda g: g[1] - g[0])
    theta = a1 + (near[0] + near[1]) / 2
    r = ra + 0.1 + half * abs(math.cos(theta)) + 0.12 * abs(math.sin(theta))
    return v[0] + r * math.cos(theta), v[1] + r * math.sin(theta), half


def _angle_label_spot(
    p: dict[str, Point], ref: str, v: Point, bisector: float, sweep: float, text: str,
    placed: list[tuple[float, float, float]],
) -> tuple[float, float, float]:
    """Where an angle's label goes: on its bisector, far enough out that the
    text fits between the two arms (a narrow angle pushes it out), never
    past most of the shorter arm, and clear of labels already placed at the
    same vertex. Returns (x, y, half-width)."""
    half = 0.3 * _LABEL_FONT_SIZE * max(len(text), 1)
    a, _v, b = split_points(ref, 3)
    arm = min(math.dist(v, p[a]), math.dist(v, p[b]))
    fit = (half + 0.06) / max(math.sin(sweep / 2), 1e-3)
    r = min(max(_ANGLE_LABEL_R + (0.12 if sweep < math.radians(35) else 0.0), fit), _ANGLE_LABEL_MAX_R,
            max(0.8 * arm, _ANGLE_LABEL_R))
    for _ in range(6):
        x, y = v[0] + r * math.cos(bisector), v[1] + r * math.sin(bisector)
        clash = any(abs(x - px) < half + ph and abs(y - py) < 0.26 for px, py, ph in placed)
        if not clash:
            break
        r += 0.25
    return x, y, half


def render_construction(spec: ConstructionFigure) -> str:
    raw = {k: (float(x), float(y)) for k, (x, y) in spec.points.items()}

    # Extent in the spec's own units: every point the figure shows or draws
    # with (an unused helper point would only shrink the figure), plus
    # every circle.
    used = used_points(spec)
    xs = [x for k, (x, _) in raw.items() if k in used]
    ys = [y for k, (_, y) in raw.items() if k in used]
    for circle in spec.circles:
        cx, cy = raw[circle.center]
        through = raw[circle.through or circle.center]
        r = circle.radius if circle.radius is not None else math.dist(raw[circle.center], through)
        xs += [cx - r, cx + r]
        ys += [cy - r, cy + r]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    factor = _CANONICAL_SPAN / span if span > 0 else 1.0
    p = {k: (x * factor, y * factor) for k, (x, y) in raw.items()}
    radii = [_circle_radius(spec, p, i, factor) for i in range(len(spec.circles))]

    min_x, max_x = min(xs) * factor, max(xs) * factor
    min_y, max_y = min(ys) * factor, max(ys) * factor
    has_open = bool(spec.rays or spec.lines)
    margin = _LINE_MARGIN if has_open else 0.0
    box = (min_x - margin, min_y - margin, max_x + margin, max_y + margin)

    texts = [
        *(n for n in p if not is_hidden(n)),
        *spec.angle_labels.values(), *spec.side_labels.values(),
        *(_line_name(ln.name or "") for ln in spec.lines if _labelled(ln)),
    ]
    pad = max(0.2, _label_padding(texts) - margin)
    vb = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{_f(vb[0])} {_f(-vb[3])} {_f(vb[2] - vb[0])} {_f(vb[3] - vb[1])}" '
        f'preserveAspectRatio="xMidYMid meet" role="img" aria-label="Geometry figure">',
        '<g transform="scale(1,-1)">',
    ]

    # 1. Light fills under everything.
    fill = f'fill="{_STROKE}" fill-opacity="{_SHADE_OPACITY}" stroke="none"'
    for region in spec.shaded:
        if region.polygon:
            attr = " ".join(f"{_f(p[n][0])},{_f(p[n][1])}" for n in region.polygon)
            parts.append(f'<polygon points="{attr}" {fill}/>')
        elif region.sector:
            c, r, a1, sw = arc_span(p, region.sector)
            parts.append(f'<path d="M{_f(c[0])},{_f(c[1])} L{_arc_path(c, r, a1, sw)[1:]} Z" {fill}/>')
    for sector in spec.sectors:
        c, r, a1, sw = arc_span(p, sector)
        arc = _arc_path(c, r, a1, sw)[1:]
        parts.append(f'<path d="M{_f(c[0])},{_f(c[1])} L{arc} Z" {fill}/>')
        parts.append(
            f'<path d="M{_f(c[0])},{_f(c[1])} L{arc} Z" fill="none" stroke="{_STROKE}" '
            f'stroke-width="{_f(_STROKE_WIDTH)}" stroke-linejoin="round"/>',
        )

    # 2. Circles and arcs.
    for i, circle in enumerate(spec.circles):
        c = p[circle.center]
        parts.append(
            f'<circle cx="{_f(c[0])}" cy="{_f(c[1])}" r="{_f(radii[i])}" fill="none" '
            f'stroke="{_STROKE}" stroke-width="{_f(_STROKE_WIDTH)}"/>',
        )
    for arc_spec in spec.arcs:
        c, r, a1, sw = arc_span(p, arc_spec)
        parts.append(
            f'<path d="{_arc_path(c, r, a1, sw)}" fill="none" stroke="{_STROKE}" '
            f'stroke-width="{_f(_STROKE_WIDTH)}"/>',
        )

    # 3. Segments, rays (one arrowhead) and lines (two).
    for ref in spec.segments:
        n1, n2 = split_points(ref, 2)
        parts.append(_line(p[n1], p[n2]))
    for ref in spec.rays:
        n1, n2 = split_points(ref, 2)
        u = _unit(p[n1], p[n2])
        reach = max(_exit(p[n1], u, box), math.dist(p[n1], p[n2]) + 0.3)
        end = (p[n1][0] + u[0] * reach, p[n1][1] + u[1] * reach)
        parts.append(_line(p[n1], end))
        parts.append(_chevron(end, u))
    line_ends: list[tuple[str, Point, Point]] = []
    for line in spec.lines:
        a, b = p[line.through[0]], p[line.through[1]]
        u = _unit(a, b)
        fwd = (a[0] + u[0] * _exit(a, u, box), a[1] + u[1] * _exit(a, u, box))
        back_u = (-u[0], -u[1])
        back = (a[0] + back_u[0] * _exit(a, back_u, box), a[1] + back_u[1] * _exit(a, back_u, box))
        parts.append(_line(back, fwd))
        parts.append(_chevron(fwd, u))
        parts.append(_chevron(back, back_u))
        if _labelled(line):
            # The name goes by the end further right (or higher, if vertical).
            end, d = (fwd, u) if (u[0], u[1]) > (0.0, 0.0) else (back, back_u)
            line_ends.append((_line_name(line.name or ""), end, d))

    # 4. Marks: ticks, angle arcs, right-angle boxes, parallel arrows.
    thin = _STROKE_WIDTH * 0.9
    for gi, group in enumerate(spec.tick_groups):
        for ref in group:
            a, b = (p[n] for n in split_points(ref, 2))
            u = _unit(a, b)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            for j in range(gi + 1):
                off = (j - gi / 2) * _TICK_GAP
                c = (mid[0] + u[0] * off, mid[1] + u[1] * off)
                parts.append(_line(
                    (c[0] - u[1] * _TICK_HALF, c[1] + u[0] * _TICK_HALF),
                    (c[0] + u[1] * _TICK_HALF, c[1] - u[0] * _TICK_HALF), thin,
                ))
    for gi, group in enumerate(spec.arc_groups):
        for ref in group:
            v, a1, sw = _angle_dirs(p, ref)
            for j in range(gi + 1):
                parts.append(
                    f'<path d="{_arc_path(v, _MARK_ARC_R + j * _MARK_ARC_STEP, a1, sw)}" '
                    f'fill="none" stroke="{_STROKE}" stroke-width="{_f(thin)}"/>',
                )
    box_size = _RIGHT_ANGLE_SIZE * 0.8
    for ref in spec.right_angles:
        nx, nv, ny = split_points(ref, 3)
        u1, u2 = _unit(p[nv], p[nx]), _unit(p[nv], p[ny])
        o = p[nv]
        parts.append(_polyline([
            (o[0] + u1[0] * box_size, o[1] + u1[1] * box_size),
            (o[0] + (u1[0] + u2[0]) * box_size, o[1] + (u1[1] + u2[1]) * box_size),
            (o[0] + u2[0] * box_size, o[1] + u2[1] * box_size),
        ], thin))
    named_lines = {ln.name: ln for ln in spec.lines if ln.name}
    for gi, group in enumerate(spec.parallel_groups):
        for ref in group:
            if ref in named_lines:
                a, b = (p[n] for n in named_lines[ref].through)
            else:
                a, b = (p[n] for n in split_points(ref, 2))
            u = _unit(a, b)
            if (u[0], u[1]) < (0.0, 0.0):
                u = (-u[0], -u[1])
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            for j in range(gi + 1):
                # Past the midpoint, which is where tick marks go.
                off = (j - gi / 2) * 0.09 + _ARROW / 2 + 0.3
                parts.append(_chevron((mid[0] + u[0] * off, mid[1] + u[1] * off), u, _ARROW * 0.9))

    # Angle labels: placed now so a label for a whole angle that other arms
    # split (∠JKL with its bisector KM) gets a wide arc across the whole
    # angle, drawn in this flipped group; the text goes on with the rest.
    angle_texts: list[tuple[float, float, str]] = []
    placed: list[tuple[float, float, float]] = []  # (x, y, half-width)
    spans_at: dict[str, int] = {}
    for ref, text in spec.angle_labels.items():
        v, a1, sw = _angle_dirs(p, ref)
        vname = split_points(ref, 3)[1]
        inside = [
            d for d in _incident_directions(spec, p, radii, vname)
            if 0.05 < (d - a1) % (2 * math.pi) < sw - 0.05
        ]
        if inside:
            k = spans_at.get(vname, 0)
            spans_at[vname] = k + 1
            ra = _SPAN_ARC_R + k * 0.3
            parts.append(
                f'<path d="{_arc_path(v, ra, a1, sw)}" fill="none" stroke="{_STROKE}" '
                f'stroke-width="{_f(_STROKE_WIDTH * 0.6)}"/>',
            )
            x, y, half = _span_label_spot(v, a1, sw, ra, text, inside)
        else:
            if not _is_angle_name(text) and not any(ref in g for g in spec.arc_groups):
                # A measure or expression gets the arc a textbook draws for it.
                parts.append(
                    f'<path d="{_arc_path(v, _MARK_ARC_R, a1, sw)}" fill="none" stroke="{_STROKE}" '
                    f'stroke-width="{_f(_STROKE_WIDTH * 0.6)}"/>',
                )
            x, y, half = _angle_label_spot(p, ref, v, a1 + sw / 2, sw, text, placed)
        placed.append((x, y, half))
        angle_texts.append((x, y, text))

    # 5. Visible points as dots.
    for name, q in p.items():
        if not is_hidden(name):
            parts.append(f'<circle cx="{_f(q[0])}" cy="{_f(q[1])}" r="{_f(_DOT_R)}" fill="{_STROKE}"/>')

    parts.append("</g>")

    # 6. Text, upright (y negated).
    visible = [q for n, q in p.items() if not is_hidden(n)] or list(p.values())
    gx = sum(q[0] for q in visible) / len(visible)
    gy = sum(q[1] for q in visible) / len(visible)
    for name, q in p.items():
        if is_hidden(name):
            continue
        away = _unit((gx, gy), q) if math.dist((gx, gy), q) > 1e-9 else (0.0, 1.0)
        d = _label_direction(_incident_directions(spec, p, radii, name), away)
        off = _LABEL_OFFSET * 1.1
        parts.append(_text(q[0] + d[0] * off, -(q[1] + d[1] * off), name, size=_VERTEX_FONT_SIZE))
    for text, end, d in line_ends:
        nrm = (-d[1], d[0])
        parts.append(_text(end[0] - d[0] * 0.25 + nrm[0] * 0.2, -(end[1] - d[1] * 0.25 + nrm[1] * 0.2), text))
    for x, y, text in angle_texts:
        parts.append(_text(x, -y, text, size=_LABEL_FONT_SIZE))
    for ref, text in spec.side_labels.items():
        a, b = (p[n] for n in split_points(ref, 2))
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        u = _unit(a, b)
        nrm = (-u[1], u[0])
        if (mid[0] - gx) * nrm[0] + (mid[1] - gy) * nrm[1] < 0:
            nrm = (-nrm[0], -nrm[1])
        # Clear the line by the text's own extent in the direction we move it.
        half = 0.3 * _LABEL_FONT_SIZE * max(len(text), 1)
        off = _LABEL_OFFSET * 0.6 + half * abs(nrm[0]) + 0.12 * abs(nrm[1])
        parts.append(_text(mid[0] + nrm[0] * off, -(mid[1] + nrm[1] * off), text))

    parts.append("</svg>")
    return "".join(parts)
