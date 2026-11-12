"""Check a construction figure against its problem text. No AI.

A construction figure gives every point exact coordinates, so plain code
can confirm the picture matches the problem before anyone sees it:

  - every point the problem names is there;
  - every segment, ray, line, triangle side and angle arm it names is drawn
    (a segment counts as drawn when collinear drawn pieces cover it);
  - numbered angles (∠1) are labelled;
  - every given (∥, ⊥, ≅, =, midpoint, bisects, lies on, opposite rays,
    vertical angles, right angles, stated measures) is true in the drawing;
  - the statement to prove is true in the drawing, and is NOT marked
    (ticks or arcs on it would hand the student the conclusion);
  - nothing is drawn that the problem doesn't mention;
  - every number on the figure agrees with the drawn measure and comes from
    the problem — a number that isn't in the problem but is in the answer
    is the answer printed on the figure.

Conservative by design: what the parser can't read it doesn't fail on, but a
figure that contradicts anything it did read never passes.

A step figure (a diagram on one solution step) is checked against the
problem plus the step's own text, must keep the question figure's points
where they were, and must keep what the question figure drew (it may only
add). Steps may mark what they prove and may show results, so the
prove-marking and answer checks don't apply to them.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from api.core.geometry.dsl import ConstructionFigure, is_hidden, split_points

Point = tuple[float, float]

# Tolerances: relative for lengths, absolute for angles.
_TOL_LEN = 0.02
_TOL_ANG = 1.0
_TOL_LABEL_ANG = 1.5
# Collinearity: distance from the line, as a fraction of the figure's span.
_TOL_COLLINEAR = 0.004
# Step figures: a shared point may move at most this fraction of the span.
_TOL_MOVE = 0.01


def _two(ref: str) -> tuple[str, str]:
    a, b = split_points(ref, 2)
    return a, b


def _three(ref: str) -> tuple[str, str, str]:
    a, v, b = split_points(ref, 3)
    return a, v, b


@dataclass(frozen=True)
class FigureIssue:
    """One reason a figure is wrong, in words a teacher (and the model,
    on its one retry) can act on."""

    kind: str
    message: str


# ── Problem text → what the figure must show ───────────────────────────

_PT = r"[A-Z][0-9]*'*"
_SEG = rf"\\overline\s*\{{\s*({_PT})\s*({_PT})\s*\}}"
_RAY = rf"\\overrightarrow\s*\{{\s*({_PT})\s*({_PT})\s*\}}"
_LINE2 = rf"\\overleftrightarrow\s*\{{\s*({_PT})\s*({_PT})\s*\}}"
_ANG3 = rf"\\angle\s*\{{?\s*({_PT})\s*({_PT})\s*({_PT})\s*\}}?(?![A-Za-z0-9'])"
_ANG1 = rf"\\angle\s*\{{?\s*({_PT})\s*\}}?(?![A-Za-z0-9'])"
_ANGN = r"\\angle\s*\{?\s*(\d+)\s*\}?"
_TRI = rf"\\triangle\s*\{{?\s*({_PT})\s*({_PT})\s*({_PT})\s*\}}?(?![A-Za-z0-9'])"
# "Triangle ABC" in words.
_TRI_WORD = rf"\b[Tt]riangles?\s+({_PT})({_PT})({_PT})(?![A-Za-z0-9'])"
# A bare two-point name standing for a length: "AB = DE", "AB = 12".
_BARE2 = rf"(?<![A-Za-z\\{{'])({_PT})({_PT})(?![A-Za-z0-9'])"
# A named line: one lowercase letter, or ℓ with an index.
_LNAME = r"(?:\\ell\s*_?\s*\{?\d*\}?|ell_?\{?\d*\}?|ℓ\s*_?\{?\d*\}?|(?<![A-Za-z\\])[a-z](?:_\{?\d+\}?)?(?![A-Za-z]))"
_NUM = r"\d+(?:\.\d+)?"
# An angle reference in either form (three points, one vertex, a number).
_ANGREF = rf"\\angle\s*\{{?\s*(?:{_PT}\s*{_PT}\s*{_PT}|{_PT}|\d+)\s*\}}?"

# After a number: not part of an expression ("2x + 5", "3(x+1)").
_NOT_ALGEBRA = r"(?![\d.])(?!\s*°?\s*(?:[a-z](?![a-z])|[(+\-*/^]))"

_FIGURE_WORDS = ("circle", "arc", "sector", "shade", "radius", "radii")


def _clean(text: str) -> str:
    t = text.replace("$", " ")
    for a, b in (
        ("∠", r"\angle "), ("△", r"\triangle "), ("≅", r"\cong "), ("∥", r"\parallel "),
        ("⊥", r"\perp "), ("°", r"^\circ "), ("′", "'"), ("’", "'"), ("ℓ", r"\ell "),
        (r"\|", r"\parallel "), (r"\measuredangle", r"\angle "), (r"\degree", r"^\circ "),
        (r"\left", ""), (r"\right", ""), (r"\,", " "), (r"\;", " "), (r"\!", ""),
        (r"\cdot", "*"), (r"\times", "*"),
    ):
        t = t.replace(a, b)
    t = re.sub(r"\\(?:text|mathrm|textbf|mathbf|operatorname)\s*\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\*\*", " ", t)
    # "m\angle" (the measure of) reads as the angle itself.
    t = re.sub(r"\bm\s*(?=\\angle)", "", t)
    t = re.sub(r"\^\s*\{\s*\\circ\s*\}|\^\s*\\circ|\\circ", "°", t)
    return t


def _line_key(raw: str) -> str:
    """One spelling per line name: '\\ell_1', 'ell_{1}', 'ℓ1', 'l_1' → 'ell1'."""
    n = re.sub(r"[\\{}_\s]", "", raw)
    if n.startswith("ℓ"):
        n = "ell" + n[1:]
    if re.fullmatch(r"l\d+", n):
        n = "ell" + n[1:]
    return n


@dataclass
class _Relation:
    kind: str
    args: tuple[Any, ...]
    text: str  # how the problem says it, for messages


@dataclass
class ProblemParts:
    points: set[str] = field(default_factory=set)
    segments: set[frozenset[str]] = field(default_factory=set)
    rays: set[tuple[str, str]] = field(default_factory=set)
    point_lines: set[frozenset[str]] = field(default_factory=set)
    angles: set[tuple[str, str, str]] = field(default_factory=set)
    numbered: set[str] = field(default_factory=set)
    line_names: set[str] = field(default_factory=set)
    transversal: bool = False
    words: set[str] = field(default_factory=set)
    numbers: set[float] = field(default_factory=set)
    givens: list[_Relation] = field(default_factory=list)
    prove: list[_Relation] = field(default_factory=list)


def _split_prove(t: str) -> tuple[str, str]:
    """(givens, statement to prove). The statement starts at the first
    'Prove'; a hint after it ('Hint: first prove ...') is not part of it."""
    m = re.search(r"\bprove\b\s*(?:that\b)?\s*:?", t, re.IGNORECASE)
    if not m:
        return t, ""
    rest = t[m.end():]
    stop = re.search(r"\(\s*\*?\s*hint|\bhint\s*:|\bwrite a\b|\bcomplete the\b|\busing\b|\bby\b", rest, re.IGNORECASE)
    return t[: m.start()], rest[: stop.start()] if stop else rest


def _numbers(text: str) -> set[float]:
    return {float(n) for n in re.findall(_NUM, text)}


def parse_problem(text: str, *, extra: str = "") -> ProblemParts:
    """What `text` says the figure must show. `extra` (a teacher's request,
    or a solution step's text) adds parts to draw, never givens."""
    out = ProblemParts()
    t = _clean(text)
    given, prove = _split_prove(t)
    out.numbers = _numbers(t)
    lower = t.lower()
    out.words = {w for w in _FIGURE_WORDS if w in lower}
    out.transversal = "transversal" in lower
    for source in (t, _clean(extra)):
        _collect_parts(source, out)
    _bare_request_parts(_clean(extra), out)
    out.givens = _relations(given, out)
    out.prove = _relations(prove, out) if prove else []
    return out


def _collect_parts(t: str, out: ProblemParts) -> None:
    for a, b in re.findall(_SEG, t):
        out.segments.add(frozenset((a, b)))
    for a, b in re.findall(_RAY, t):
        out.rays.add((a, b))
    for a, b in re.findall(_LINE2, t):
        out.point_lines.add(frozenset((a, b)))
    for a, b, c in re.findall(_TRI, t) + re.findall(_TRI_WORD, t):
        for p, q in ((a, b), (b, c), (c, a)):
            out.segments.add(frozenset((p, q)))
    for a, v, b in re.findall(_ANG3, t):
        out.angles.add((a, v, b))
    out.numbered |= set(re.findall(_ANGN, t))
    for groups in (re.findall(_SEG, t), re.findall(_RAY, t), re.findall(_LINE2, t)):
        for g in groups:
            out.points.update(g)
    for g in re.findall(_TRI, t) + re.findall(_TRI_WORD, t) + re.findall(_ANG3, t):
        out.points.update(g)
    out.points.update(re.findall(_ANG1, t))
    for m in re.finditer(
        rf"\b[Pp]oints?\s+({_PT}(?:\s*(?:,|and|,\s*and)\s*{_PT})*)(?![A-Za-z0-9'])", t,
    ):
        out.points.update(re.findall(_PT, m.group(1)))
    out.points.update(re.findall(rf"(?<![A-Za-z\\])({_PT})\s+(?:is|lies)\s+(?:the\s+midpoint|on|between)\b", t))
    out.points.update(re.findall(rf"\b(?:at|center|centre)\s+(?:point\s+)?({_PT})(?![A-Za-z0-9'])", t))
    out.points.update(re.findall(rf"\bendpoint\s+({_PT})(?![A-Za-z0-9'])", t))
    # Named lines: "line p", "lines p and q", "Lines m ∥ n", "transversal t".
    joiner = r"\s*(?:,|and|\\parallel|\\perp)\s*"
    for m in re.finditer(rf"\b(?:[Ll]ines?|transversal)\s+((?:{_LNAME})(?:{joiner}(?:{_LNAME}))*)", t):
        for name in re.findall(_LNAME, m.group(1)):
            key = _line_key(name)
            if key and key not in {"a", "an", "and", "the"}:
                out.line_names.add(key)


def _bare_request_parts(t: str, out: ProblemParts) -> None:
    """A teacher's request names parts plainly: "draw in segments WM and
    ZM", "label angle 1 and angle 2", "with diagonal AC", "connect B and D",
    "a segment from B to D"."""
    sep = r"\s*(?:,\s*and|,|and)\s*"
    pairs: list[tuple[str, str]] = []
    for m in re.finditer(
        rf"\b(?:[Ss]egments?|[Dd]iagonals?|[Ss]ides?|[Dd]raw(?:\s+in)?)\s+((?:{_PT}{_PT})(?:{sep}{_PT}{_PT})*)"
        r"(?![A-Za-z0-9'])", t,
    ):
        pairs += re.findall(rf"({_PT})({_PT})", m.group(1))
    pairs += re.findall(
        rf"\b(?:[Cc]onnect(?:s|ed|ing)?|[Jj]oin(?:s|ed|ing)?)\s+(?:points?\s+)?({_PT})\s+(?:and|to|with)\s+"
        rf"(?:point\s+)?({_PT})(?![A-Za-z0-9'])", t,
    )
    pairs += re.findall(rf"\b[Ff]rom\s+(?:point\s+)?({_PT})\s+to\s+(?:point\s+)?({_PT})(?![A-Za-z0-9'])", t)
    for pair in pairs:
        if pair[0] != pair[1]:
            out.segments.add(frozenset(pair))
            out.points.update(pair)
    for m in re.finditer(r"\bangles?\s+(\d+(?:\s*(?:,|and|,\s*and)\s*(?:angle\s+)?\d+)*)", t):
        out.numbered |= set(re.findall(r"\d+", m.group(1)))


def _relations(t: str, parts: ProblemParts) -> list[_Relation]:
    rels: list[_Relation] = []

    def add(kind: str, *args: object, text: str) -> None:
        rels.append(_Relation(kind, args, text))

    # Chains of segments joined by ∥ / ⊥ / ≅ / = ("AB ≅ CD ≅ EF").
    seg_or_bare = rf"(?:{_SEG}|{_BARE2})"
    for sym, kind in ((r"\\parallel", "par"), (r"\\perp", "perp"), (r"(?:\\cong|=)", "eqlen")):
        for m in re.finditer(rf"{seg_or_bare}(?:\s*{sym}\s*{seg_or_bare})+", t):
            pairs = _pairs_in(m.group(0))
            if kind != "eqlen" and not re.search(_SEG, m.group(0)) and not _all_bare_pairs_are_points(pairs, parts):
                continue
            for p1, p2 in zip(pairs, pairs[1:]):
                sym_txt = {"par": "∥", "perp": "⊥", "eqlen": "≅"}[kind]
                add(kind, p1, p2, text=f"{''.join(p1)} {sym_txt} {''.join(p2)}")
    # A length given as a number: "AB = 12".
    for m in re.finditer(rf"{seg_or_bare}\s*=\s*({_NUM}){_NOT_ALGEBRA}", t):
        pairs = _pairs_in(m.group(0))
        if pairs:
            value = m.group(m.lastindex or 1)
            add("length", pairs[0], float(value), text=f"{''.join(pairs[0])} = {value}")
    # Angles equal / congruent, in chains.
    for m in re.finditer(rf"{_ANGREF}(?:\s*(?:\\cong|=)\s*{_ANGREF})+", t):
        refs = re.findall(_ANGREF, m.group(0))
        angs = [_angle_ref(r) for r in refs]
        for a1, a2 in zip(angs, angs[1:]):
            add("eqang", a1, a2, text=f"{_ang_txt(a1)} ≅ {_ang_txt(a2)}")
    # An angle measure given as a plain number: "m∠ABC = 50°", "∠B = 90°".
    for m in re.finditer(rf"({_ANGREF})\s*=\s*({_NUM}){_NOT_ALGEBRA}", t):
        ang = _angle_ref(m.group(1))
        add("measure", ang, float(m.group(2)), text=f"{_ang_txt(ang)} = {m.group(2)}°")
    # Triangle congruence: checked as three pairs of equal sides.
    for m in re.finditer(rf"{_TRI}\s*\\cong\s*{_TRI}", t):
        a, b, c, d, e, f = m.groups()
        add("congtri", (a, b, c), (d, e, f), text=f"△{a}{b}{c} ≅ △{d}{e}{f}")
    for m in re.finditer(rf"({_PT})\s+is\s+(?:the|a)\s+midpoint\s+of\s+{seg_or_bare}", t):
        pairs = _pairs_in(m.group(0)[m.end(1) - m.start(0):])
        if pairs:
            add("mid", m.group(1), pairs[0], text=f"{m.group(1)} is the midpoint of {''.join(pairs[0])}")
    for m in re.finditer(rf"{_SEG}\s*bisects\s*{_SEG}\s*at\s*(?:point\s*)?({_PT})", t):
        a, b, c, d, mid = m.groups()
        add("mid", mid, (c, d), text=f"{mid} is the midpoint of {c}{d}")
        add("on", mid, (a, b), text=f"{mid} lies on {a}{b}")
    for m in re.finditer(rf"(?:{_SEG}|{_RAY})\s*bisects\s*{_ANG3}", t):
        g = [x for x in m.groups() if x]
        a, b, x, v, z = g
        ray_end = b if a == v else a
        add("bisang", ray_end, (x, v, z), text=f"{v}{ray_end} bisects ∠{x}{v}{z}")
    for m in re.finditer(rf"(?<![A-Za-z\\])({_PT})\s+(?:lies|is)\s+on\s+{seg_or_bare}", t):
        pairs = _pairs_in(m.group(0)[m.end(1) - m.start(0):])
        if pairs:
            add("on", m.group(1), pairs[0], text=f"{m.group(1)} lies on {''.join(pairs[0])}")
    for m in re.finditer(rf"{_RAY}\s*and\s*{_RAY}\s*are\s*opposite", t):
        a, b, c, d = m.groups()
        if a == c:
            add("opp", a, b, d, text=f"{a}{b} and {a}{d} are opposite rays")
    for m in re.finditer(r"\\angle\s*\{?(\d+)\}?\s*and\s*\\angle\s*\{?(\d+)\}?\s*are\s*vertical", t):
        add("vertical", m.group(1), m.group(2), text=f"∠{m.group(1)} and ∠{m.group(2)} are vertical angles")
    for m in re.finditer(rf"[Rr]ight\s+angles?\s+at\s+({_PT}(?:\s*(?:,|and|,\s*and)\s*{_PT})*)", t):
        for v in re.findall(_PT, m.group(1)):
            add("measure", ("", v, ""), 90.0, text=f"right angle at {v}")
    tail = r"\s*(?:are\s+parallel|are\s+cut|,|\.|$)"
    for m in re.finditer(rf"[Ll]ines\s+({_LNAME})\s*(?:and|\\parallel)\s*({_LNAME}){tail}", t):
        if "\\parallel" in m.group(0) or "parallel" in m.group(0):
            add("linepar", _line_key(m.group(1)), _line_key(m.group(2)), text=f"line {m.group(1)} ∥ line {m.group(2)}")
    for m in re.finditer(rf"(?<![A-Za-z\\])({_LNAME})\s*\\parallel\s*({_LNAME})(?![A-Za-z])", t):
        k1, k2 = _line_key(m.group(1)), _line_key(m.group(2))
        if k1 in parts.line_names and k2 in parts.line_names and not any(
            r.kind == "linepar" and set(r.args) == {k1, k2} for r in rels
        ):
            add("linepar", k1, k2, text=f"line {m.group(1)} ∥ line {m.group(2)}")
    inscribed = rf"\s*is\s+inscribed\s+in\s+(?:a\s+)?circle(?:\s+with\s+cent(?:er|re)\s+({_PT}))?"
    for m in re.finditer(rf"\\triangle\s*\{{?\s*({_PT})({_PT})({_PT})\s*\}}?{inscribed}", t):
        add("oncircle", m.groups()[:3], m.group(4), text=f"△{''.join(m.groups()[:3])} is inscribed in the circle")
    return rels


def _pairs_in(s: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for m in re.finditer(rf"{_SEG}|{_BARE2}", s):
        g = [x for x in m.groups() if x]
        if len(g) == 2:
            out.append((g[0], g[1]))
    return out


def _all_bare_pairs_are_points(pairs: list[tuple[str, str]], parts: ProblemParts) -> bool:
    return all(set(p) <= parts.points for p in pairs)


def _angle_ref(ref: str) -> tuple[str, str, str] | str:
    """'\\angle ABC' → ('A','B','C'); '\\angle B' → ('', 'B', ''); '\\angle 1' → '1'."""
    body = re.sub(r"\\angle|[{}\s]", "", ref)
    if body.isdigit():
        return body
    names = re.findall(_PT, body)
    if len(names) == 3:
        return (names[0], names[1], names[2])
    return ("", names[0], "") if names else ""


def _ang_txt(a: tuple[str, str, str] | str) -> str:
    return f"∠{a}" if isinstance(a, str) else f"∠{''.join(a)}"


# ── Geometry on the drawn coordinates ──────────────────────────────────


def _dist(p: Point, q: Point) -> float:
    return math.hypot(p[0] - q[0], p[1] - q[1])


def _angle(a: Point, v: Point, b: Point) -> float:
    ax, ay, bx, by = a[0] - v[0], a[1] - v[1], b[0] - v[0], b[1] - v[1]
    na, nb = math.hypot(ax, ay), math.hypot(bx, by)
    if na < 1e-12 or nb < 1e-12:
        return math.nan
    c = max(-1.0, min(1.0, (ax * bx + ay * by) / (na * nb)))
    return math.degrees(math.acos(c))


def _direction(p: Point, q: Point) -> float:
    return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0])) % 180


def _dir_diff(d1: float, d2: float) -> float:
    d = abs(d1 - d2) % 180
    return min(d, 180 - d)


class _Drawing:
    """The figure as geometry: points plus the straight pieces drawn."""

    def __init__(self, fig: ConstructionFigure) -> None:
        self.fig = fig
        self.p: dict[str, Point] = {k: (float(x), float(y)) for k, (x, y) in fig.points.items()}
        xs = [q[0] for q in self.p.values()]
        ys = [q[1] for q in self.p.values()]
        self.scale = max(max(xs) - min(xs), max(ys) - min(ys), 1e-9)
        # (kind, a, b): seg a→b, ray from a through b, or line through a, b.
        self.pieces: list[tuple[str, str, str]] = (
            [("seg", *_two(s)) for s in fig.segments]
            + [("ray", *_two(r)) for r in fig.rays]
            + [("line", ln.through[0], ln.through[1]) for ln in fig.lines]
        )
        self.lines = {_line_key(ln.name): ln for ln in fig.lines if ln.name}
        self.labels: dict[tuple[str, str, str], str] = {
            _three(k): v for k, v in fig.angle_labels.items()
        }

    def collinear(self, a: Point, b: Point, q: Point) -> bool:
        d = _dist(a, b)
        if d < 1e-12:
            return False
        cross = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
        return abs(cross) / d <= _TOL_COLLINEAR * self.scale

    @staticmethod
    def param(a: Point, b: Point, q: Point) -> float:
        dx, dy = b[0] - a[0], b[1] - a[1]
        return ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy)

    def piece_covers(self, piece: tuple[str, str, str], u: Point, v: Point) -> bool:
        kind, a, b = piece
        pa, pb = self.p[a], self.p[b]
        if not (self.collinear(pa, pb, u) and self.collinear(pa, pb, v)):
            return False
        lo = {"seg": 0.0, "ray": 0.0, "line": -math.inf}[kind]
        hi = 1.0 if kind == "seg" else math.inf
        eps = 1e-3
        return all(lo - eps <= self.param(pa, pb, q) <= hi + eps for q in (u, v))

    def covered(self, u: Point, v: Point) -> bool:
        """The stretch u→v is drawn: every gap between the named points
        lying on it is covered by some drawn piece."""
        if _dist(u, v) < 1e-12:
            return False
        on = sorted(
            (self.param(u, v, q), q) for q in self.p.values()
            if self.collinear(u, v, q) and -1e-3 <= self.param(u, v, q) <= 1 + 1e-3
        )
        stops = [u, *(q for t, q in on if 1e-3 < t < 1 - 1e-3), v]
        return all(
            _dist(s, e) < 1e-12 or any(self.piece_covers(pc, s, e) for pc in self.pieces)
            for s, e in zip(stops, stops[1:])
        )

    def seg_drawn(self, a: str, b: str) -> bool:
        return a in self.p and b in self.p and self.covered(self.p[a], self.p[b])

    def arm_drawn(self, v: str, x: str) -> bool:
        """An angle's arm from v through x: a ray or line along it, or at
        least the segment v→x (a triangle's angle is drawn by its sides)."""
        if v not in self.p or x not in self.p:
            return False
        return any(
            k in ("ray", "line") and self.piece_covers((k, c, d), self.p[v], self.p[x])
            for k, c, d in self.pieces
        ) or self.seg_drawn(v, x)

    def ray_drawn(self, a: str, b: str) -> bool:
        """The ray from a through b: a drawn ray that starts at a and points
        at b. A reversed ray, a segment or a line is not it."""
        if a not in self.p or b not in self.p:
            return False
        pa, pb = self.p[a], self.p[b]
        tol = _TOL_COLLINEAR * self.scale
        for k, c, e in self.pieces:
            if k != "ray":
                continue
            pc, pe = self.p[c], self.p[e]
            if _dist(pc, pa) <= tol and self.collinear(pc, pe, pb) and self.param(pc, pe, pb) > 1e-3:
                return True
        return False

    def line_through(self, a: str, b: str) -> bool:
        """A drawn line through a and b (a segment or ray is not a line)."""
        return a in self.p and b in self.p and any(
            k == "line" and self.piece_covers((k, c, d), self.p[a], self.p[b]) for k, c, d in self.pieces
        )

    def single_vertex_angle(self, v: str) -> tuple[str, str, str] | None:
        """∠B with no other letters: the angle between the two drawn
        pieces at B, when exactly two leave it (else unknown)."""
        if v not in self.p:
            return None
        ends: list[str] = []
        for _kind, a, b in self.pieces:
            if v == a:
                ends.append(b)
            elif v == b and _kind == "seg":
                ends.append(a)
        dirs: dict[float, str] = {}
        for e in ends:
            dx, dy = self.p[e][0] - self.p[v][0], self.p[e][1] - self.p[v][1]
            dirs.setdefault(round(math.degrees(math.atan2(dy, dx)), 1), e)
        if len(dirs) != 2:
            return None
        e1, e2 = dirs.values()
        return (e1, v, e2)

    def resolve(self, a: tuple[str, str, str] | str) -> tuple[str, str, str] | None:
        if isinstance(a, str):
            for key, text in self.labels.items():
                if text.strip() == a:
                    return key
            return None
        if a[0] == "":
            return self.single_vertex_angle(a[1])
        return a if all(n in self.p for n in a) else None

    def measure(self, a: tuple[str, str, str]) -> float:
        return _angle(self.p[a[0]], self.p[a[1]], self.p[a[2]])


# ── The check ──────────────────────────────────────────────────────────


def check_construction(
    fig: ConstructionFigure,
    problem_text: str,
    *,
    final_answer: str = "",
    request_text: str = "",
    step_text: str | None = None,
    base: ConstructionFigure | None = None,
) -> list[FigureIssue]:
    """Every way `fig` disagrees with `problem_text`; empty means it passes.

    `request_text` is the teacher's message (parts she asks for must be
    drawn). For a step figure pass `step_text` (its title + description)
    and `base`, the question's own figure when it has one."""
    is_step = step_text is not None
    parts = parse_problem(problem_text, extra=f"{request_text}\n{step_text or ''}")
    d = _Drawing(fig)
    issues: list[FigureIssue] = []

    def say(kind: str, message: str) -> None:
        if all(i.message != message for i in issues):
            issues.append(FigureIssue(kind, message))

    visible = {n for n in d.p if not is_hidden(n)}
    for n in sorted(parts.points - visible):
        say("missing_point", f"missing point: {n}")

    # Parts the problem names must be drawn.
    for s in sorted(parts.segments, key=sorted):
        a, b = sorted(s)
        if a in d.p and b in d.p and not d.seg_drawn(a, b):
            say("not_drawn", f"not drawn: {a}{b}")
    for a, b in sorted(parts.rays):
        if a in d.p and b in d.p and not d.ray_drawn(a, b):
            say("not_drawn", f"not drawn: ray {a}{b}")
    for s in sorted(parts.point_lines, key=sorted):
        a, b = sorted(s)
        if a in d.p and b in d.p and not d.line_through(a, b):
            say("not_drawn", f"not drawn: line {a}{b}")
    for a, v, b in sorted(parts.angles):
        for x in (a, b):
            if v in d.p and x in d.p and not d.arm_drawn(v, x):
                say("not_drawn", f"not drawn: {v}{x} (a side of ∠{a}{v}{b})")
    for name in sorted(parts.line_names - set(d.lines)):
        say("not_drawn", f"not drawn: line {name.replace('ell', 'ℓ')}")
    labels = {re.sub(r"[^\w]", "", v) for v in fig.angle_labels.values()}
    for n in sorted(parts.numbered - labels):
        say("unlabelled", f"∠{n} is not labelled")
    if parts.transversal and not parts.line_names - {
        k for r in parts.givens if r.kind == "linepar" for k in r.args
    } and not _has_transversal(d):
        say("not_drawn", "not drawn: the transversal")

    # Givens true; the statement to prove true and unmarked.
    for rel in parts.givens:
        if _holds(rel, d) is False:
            say("false_given", f"the given {rel.text} is not true in the drawing")
    for rel in parts.prove:
        if _holds(rel, d) is False:
            say("false_prove", f"the statement to prove ({rel.text}) is not true in the drawing")
    if not is_step:
        given_texts = {r.text for r in parts.givens}
        for rel in parts.prove:
            if rel.text not in given_texts and _marked(rel, d):
                say(
                    "prove_marked",
                    f"the statement to prove ({rel.text}) is marked on the figure; mark only the givens",
                )

    # Every mark on the figure is true in the drawing.
    for message in _mark_issues(d):
        say("false_mark", message)

    # Nothing drawn that the problem doesn't mention.
    for message in _extras(d, parts, base):
        say("extra", message)

    # Numbers on the figure: agree with the drawing, come from the problem.
    for message in _label_issues(d, parts, final_answer if not is_step else "", problem_text):
        say("label", message)

    if base is not None:
        for message in _step_consistency(d, _Drawing(base)):
            say("moved", message)
    return issues


def _has_transversal(d: _Drawing) -> bool:
    """Some drawn piece crosses two parallel lines (or there are three
    pieces with two parallel ones: the third must cut them)."""
    dirs = [_direction(d.p[a], d.p[b]) for _k, a, b in d.pieces]
    for i, di in enumerate(dirs):
        for j in range(i + 1, len(dirs)):
            if _dir_diff(di, dirs[j]) < _TOL_ANG:
                if any(_dir_diff(dk, di) > 5 for k, dk in enumerate(dirs) if k not in (i, j)):
                    return True
    return False


def _holds(rel: _Relation, d: _Drawing) -> bool | None:
    """True / False when the relation can be measured on the drawing; None
    when it can't be decided (unknown point, ambiguous ∠B)."""
    p = d.p
    try:
        k, args = rel.kind, rel.args
        if k in ("par", "perp", "eqlen"):
            (a, b), (c, e) = args
            if not all(n in p for n in (a, b, c, e)):
                return None
            if k == "eqlen":
                l1, l2 = _dist(p[a], p[b]), _dist(p[c], p[e])
                return abs(l1 - l2) <= _TOL_LEN * max(l1, l2)
            diff = _dir_diff(_direction(p[a], p[b]), _direction(p[c], p[e]))
            return diff < _TOL_ANG if k == "par" else abs(diff - 90) < _TOL_ANG
        if k == "eqang":
            a1, a2 = (d.resolve(x) for x in args)
            if a1 is None or a2 is None:
                return None
            return abs(d.measure(a1) - d.measure(a2)) < _TOL_ANG
        if k == "measure":
            ang = d.resolve(args[0])
            if ang is None:
                return None
            return abs(d.measure(ang) - float(args[1])) < _TOL_ANG
        if k == "length":
            return None  # lengths are scaled; checked with the labels
        if k == "congtri":
            (a, b, c), (e, f, g) = args
            if not all(n in p for n in (a, b, c, e, f, g)):
                return None
            return all(
                abs(_dist(p[x], p[y]) - _dist(p[u], p[w])) <= _TOL_LEN * max(_dist(p[x], p[y]), 1e-12)
                for (x, y), (u, w) in (((a, b), (e, f)), ((b, c), (f, g)), ((c, a), (g, e)))
            )
        if k == "mid":
            m, (a, b) = args
            if not all(n in p for n in (m, a, b)):
                return None
            halves = abs(_dist(p[a], p[m]) - _dist(p[m], p[b]))
            return d.collinear(p[a], p[b], p[m]) and halves <= _TOL_LEN * _dist(p[a], p[b])
        if k == "on":
            m, (a, b) = args
            if not all(n in p for n in (m, a, b)):
                return None
            return d.collinear(p[a], p[b], p[m]) and -0.01 <= d.param(p[a], p[b], p[m]) <= 1.01
        if k == "bisang":
            e, (x, v, z) = args
            if not all(n in p for n in (e, x, v, z)):
                return None
            half1, half2 = _angle(p[x], p[v], p[e]), _angle(p[e], p[v], p[z])
            return abs(half1 - half2) < _TOL_ANG and abs(half1 + half2 - _angle(p[x], p[v], p[z])) < _TOL_ANG
        if k == "opp":
            o, a, b = args
            if not all(n in p for n in (o, a, b)):
                return None
            return abs(_angle(p[a], p[o], p[b]) - 180) < _TOL_ANG
        if k == "vertical":
            a1, a2 = d.resolve(args[0]), d.resolve(args[1])
            if a1 is None or a2 is None:
                return None
            if a1[1] != a2[1]:
                return False
            v = p[a1[1]]
            arms1 = [p[a1[0]], p[a1[2]]]
            arms2 = [p[a2[0]], p[a2[2]]]
            # Each arm of one is opposite an arm of the other.
            return all(any(abs(_angle(x, v, y) - 180) < _TOL_ANG for y in arms2) for x in arms1)
        if k == "linepar":
            n1, n2 = args
            if n1 not in d.lines or n2 not in d.lines:
                return None
            th1, th2 = d.lines[n1].through, d.lines[n2].through
            return _dir_diff(_direction(p[th1[0]], p[th1[1]]), _direction(p[th2[0]], p[th2[1]])) < _TOL_ANG
        if k == "oncircle":
            tri, center = args
            for c in d.fig.circles:
                if center and c.center != center:
                    continue
                r = c.radius if c.radius is not None else _dist(p[c.center], p[c.through or c.center])
                # Radius in spec units; a circle given by radius is in the same units.
                if all(n in p and abs(_dist(p[c.center], p[n]) - r) <= _TOL_LEN * r for n in tri):
                    return True
            return False
    except (KeyError, ValueError, TypeError, ZeroDivisionError):
        return None
    return None


def _marked(rel: _Relation, d: _Drawing) -> bool:
    """The figure marks this relation (ticks / arcs / arrows / box)."""
    f = d.fig

    def same_group(groups: list[list[str]], a: Iterable[str], b: Iterable[str], size: int) -> bool:
        def key(ref: str) -> frozenset[str] | tuple[str, ...]:
            names = split_points(ref, size)
            return frozenset(names) if size == 2 else (names[1], *sorted((names[0], names[2])))

        ka = frozenset(a) if size == 2 else (tuple(a)[1], *sorted((tuple(a)[0], tuple(a)[2])))
        kb = frozenset(b) if size == 2 else (tuple(b)[1], *sorted((tuple(b)[0], tuple(b)[2])))
        return any(ka in {key(r) for r in g} and kb in {key(r) for r in g} for g in groups)

    k, args = rel.kind, rel.args
    p = d.p
    try:
        if k == "eqlen":
            return same_group(f.tick_groups, args[0], args[1], 2)
        if k == "mid":
            m, (a, b) = args
            return same_group(f.tick_groups, (a, m), (m, b), 2)
        if k == "par":
            line_names = {ln.name for ln in f.lines if ln.name}
            segs = [[r for r in g if r not in line_names] for g in f.parallel_groups]
            return same_group(segs, args[0], args[1], 2)
        if k == "linepar":
            return any({args[0], args[1]} <= {_line_key(r) for r in g} for g in f.parallel_groups)
        if k == "eqang":
            a1, a2 = (d.resolve(x) for x in args)
            return a1 is not None and a2 is not None and same_group(f.arc_groups, a1, a2, 3)
        if k == "perp":
            (a, b), (c, e) = args
            return any(_box_on_lines(d, _three(r), (p[a], p[b]), (p[c], p[e])) for r in f.right_angles)
        if k == "measure":
            ang = d.resolve(args[0])
            if ang is None:
                return False
            value = float(args[1])
            if value == 90 and any(_same_angle(d, _three(r), ang, mod=180) for r in f.right_angles):
                return True
            return any(
                _plain_number(text) == value and _same_angle(d, key, ang) for key, text in d.labels.items()
            )
    except (KeyError, ValueError, TypeError, ZeroDivisionError):
        return False
    return False


def _arm_dirs(d: _Drawing, ang: tuple[str, str, str]) -> tuple[Point, float, float]:
    v = d.p[ang[1]]
    dirs = [
        math.degrees(math.atan2(d.p[x][1] - v[1], d.p[x][0] - v[0])) % 360 for x in (ang[0], ang[2])
    ]
    return v, dirs[0], dirs[1]


def _same_angle(d: _Drawing, a1: tuple[str, str, str], a2: tuple[str, str, str], *, mod: float = 360) -> bool:
    """The same angle in the drawing, whatever its points are called: same
    vertex, same two arm directions (mod 180: a box on any of the four
    angles two perpendicular lines make)."""
    v1, x1, y1 = _arm_dirs(d, a1)
    v2, x2, y2 = _arm_dirs(d, a2)
    if _dist(v1, v2) > _TOL_COLLINEAR * d.scale:
        return False

    def close(u: float, w: float) -> bool:
        diff = abs(u - w) % mod
        return min(diff, mod - diff) < _TOL_ANG

    return (close(x1, x2) and close(y1, y2)) or (close(x1, y2) and close(y1, x2))


def _box_on_lines(d: _Drawing, box: tuple[str, str, str], l1: tuple[Point, Point], l2: tuple[Point, Point]) -> bool:
    """A right-angle box where two lines cross, with its arms along them."""
    (p1, p2), (p3, p4) = l1, l2
    den = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
    if abs(den) < 1e-12:
        return False
    t_ = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / den
    x = (p1[0] + t_ * (p2[0] - p1[0]), p1[1] + t_ * (p2[1] - p1[1]))
    v, a, b = _arm_dirs(d, box)
    if _dist(v, x) > _TOL_COLLINEAR * d.scale:
        return False
    want = sorted((_direction(p1, p2), _direction(p3, p4)))
    got = sorted((a % 180, b % 180))
    return all(_dir_diff(g, w) < _TOL_ANG for g, w in zip(got, want)) or all(
        _dir_diff(g, w) < _TOL_ANG for g, w in zip(got, want[::-1])
    )


# Givens with a textbook mark: ≅ sides, ≅ angles, ⊥, ∥, a midpoint (and a
# 90° angle: a box).
_MARKABLE = ("eqlen", "eqang", "perp", "par", "linepar", "mid")


def givens_marked(fig: ConstructionFigure, problem_text: str) -> bool:
    """Every given that has a textbook mark (≅ sides, ≅ angles, ⊥, ∥, a
    right angle, a midpoint) is marked on `fig`, and there is at least one."""
    parts = parse_problem(problem_text)
    d = _Drawing(fig)
    markable = [
        r for r in parts.givens
        if r.kind in _MARKABLE or (r.kind == "measure" and float(r.args[1]) == 90)
    ]
    try:
        return bool(markable) and all(_marked(r, d) for r in markable)
    except (KeyError, ValueError, TypeError, ZeroDivisionError):
        return False


def _is_radius(d: _Drawing, a: str, b: str) -> bool:
    """Segment ab runs from a drawn circle's center to a point on it."""
    for c in d.fig.circles:
        r = c.radius if c.radius is not None else _dist(d.p[c.center], d.p[c.through or c.center])
        for center, end in ((a, b), (b, a)):
            if center == c.center and abs(_dist(d.p[center], d.p[end]) - r) <= _TOL_LEN * r:
                return True
    return False


def _mark_issues(d: _Drawing) -> list[str]:
    """Marks that claim something the drawing contradicts: ticks on unequal
    segments, arcs on unequal angles, a right-angle box on an angle that
    isn't 90°, parallel arrows on pieces that aren't parallel."""
    f, p = d.fig, d.p
    out: list[str] = []
    for group in f.tick_groups:
        lengths = [_dist(p[a], p[b]) for a, b in (_two(r) for r in group)]
        if max(lengths) - min(lengths) > _TOL_LEN * max(lengths):
            out.append(f"the tick marks on {', '.join(group)} claim equal lengths, but they differ in the drawing")
    for group in f.arc_groups:
        sizes = [d.measure(_three(r)) for r in group]
        if max(sizes) - min(sizes) > _TOL_ANG:
            names = ", ".join("∠" + r for r in group)
            out.append(f"the arcs on {names} claim equal angles, but they differ in the drawing")
    for kind, refs in (
        ("label", list(f.angle_labels)), ("arc", [r for g in f.arc_groups for r in g]),
        ("right-angle mark", list(f.right_angles)),
    ):
        for ref in refs:
            x, v, y = _three(ref)
            for arm in (x, y):
                if not d.arm_drawn(v, arm):
                    out.append(
                        f"the {kind} on ∠{ref} sits on an angle whose side {v}{arm} isn't drawn".replace("_", "")
                    )
    for ref in f.right_angles:
        drawn = d.measure(_three(ref))
        if abs(drawn - 90) > _TOL_ANG:
            out.append(f"the right-angle mark on ∠{ref} is on an angle drawn as {drawn:.0f}°")
    lines = {ln.name: ln for ln in f.lines if ln.name}
    for group in f.parallel_groups:
        dirs = []
        for ref in group:
            a, b = tuple(lines[ref].through) if ref in lines else _two(ref)
            dirs.append(_direction(p[a], p[b]))
        if any(_dir_diff(dirs[0], x) > _TOL_ANG for x in dirs[1:]):
            out.append(f"the parallel arrows on {', '.join(group)} are on pieces that aren't parallel in the drawing")
    return out


def _extras(d: _Drawing, parts: ProblemParts, base: ConstructionFigure | None) -> list[str]:
    """Drawn pieces nothing in the problem accounts for."""
    p = d.p
    named: list[tuple[str, str, str]] = []
    for kind, pairs in (("seg", parts.segments), ("line", parts.point_lines)):
        for s in pairs:
            first, second = sorted(s)
            named.append((kind, first, second))
    named += [("ray", a, b) for a, b in parts.rays]
    for a, v, b in parts.angles:
        named += [("ray", v, a), ("ray", v, b)]
    # Arms of labelled or marked angles (∠1 placed by the figure) and the
    # sides of right-angle boxes are accounted for by the angle itself.
    marked_angles = [*d.labels, *(_three(r) for g in d.fig.arc_groups for r in g),
                     *(_three(r) for r in d.fig.right_angles)]
    for x, v, y in marked_angles:
        named += [("ray", v, x), ("ray", v, y)]
    if base is not None:
        bd = _Drawing(base)
        named += [(k, a, b) for k, a, b in bd.pieces if a in p and b in p]
    named = [n for n in named if n[1] in p and n[2] in p and _dist(p[n[1]], p[n[2]]) > 1e-12]

    def accounted(piece: tuple[str, str, str]) -> bool:
        kind, a, b = piece
        if kind == "line":
            name = next((k for k, ln in d.lines.items() if tuple(ln.through) == (a, b)), None)
            if name and name in parts.line_names:
                return True
        if parts.transversal:
            return True  # a transversal may be drawn as any straight piece
        if not parts.points:
            return True  # the problem names no points ("the right triangle below"): nothing to compare to
        if kind == "seg" and {"radius", "radii"} & parts.words and _is_radius(d, a, b):
            return True  # the problem is about a radius: center to circle
        for nk, x, y in named:
            px, py = p[x], p[y]
            if not (d.collinear(px, py, p[a]) and d.collinear(px, py, p[b])):
                continue
            if nk in ("ray", "line") or kind != "seg":
                return True
            ta, tb = d.param(px, py, p[a]), d.param(px, py, p[b])
            if min(ta, tb) >= -1e-3 and max(ta, tb) <= 1 + 1e-3:
                return True
        return False

    out = [
        f"extra {kind if kind != 'seg' else 'segment'} not in the problem: {a}{b}".replace("_", "")
        for kind, a, b in d.pieces
        if not accounted((kind, a, b))
    ]
    words = parts.words
    if d.fig.circles and "circle" not in words:
        out.append("extra circle not in the problem")
    if (d.fig.arcs or d.fig.sectors) and not ({"arc", "sector", "circle"} & words):
        out.append("extra arc not in the problem")
    if d.fig.shaded and not ({"shade", "sector"} & words):
        out.append("extra shading not in the problem")
    return out


def _label_numbers(text: str) -> list[float]:
    return [float(n) for n in re.findall(_NUM, _clean(text))]


def _plain_number(text: str) -> float | None:
    """'138°', '138', '12 cm' → the number; None for '2x+5', 'x', '√34'."""
    unit = r"(?:°|\^\s*\\circ|\^\{\\circ\}|\\circ|deg|degrees|[a-z]{1,3})"
    m = re.fullmatch(rf"\s*\$?\s*({_NUM})\s*{unit}?\s*\$?\s*", text)
    return float(m.group(1)) if m else None


def _label_issues(d: _Drawing, parts: ProblemParts, final_answer: str, problem_text: str) -> list[str]:
    out: list[str] = []
    answer_numbers = _numbers(_clean(final_answer))
    has_right = bool(re.search(r"\\perp|right|perpendicular|90", _clean(problem_text), re.IGNORECASE))

    def source_issue(label: str, number: float, measured_90: bool) -> str | None:
        if number in parts.numbers or (number == 90 and (has_right or measured_90)):
            return None
        shown = f"{number:g}"
        if number in answer_numbers:
            return f"the label {label!r} gives away the answer ({shown} is not in the problem)"
        return f"the label {label!r} shows {shown}, which is not a number in the problem"

    for key, text in d.labels.items():
        value = _plain_number(text)
        # A bare whole number with no degree sign names the angle (∠1,
        # ∠2, ...) when the problem numbers its angles, or is that number.
        bare = value is not None and value.is_integer() and re.fullmatch(r"\s*\d+\s*", text) is not None
        is_name = bare and text.strip() in parts.numbered
        if is_name:
            continue
        drawn = d.measure(key)
        if value is not None and not math.isnan(drawn) and abs(drawn - value) > _TOL_LABEL_ANG:
            out.append(
                f"the label {text!r} on ∠{''.join(key)} does not match the drawing (drawn as {drawn:.0f}°)",
            )
        for n in _label_numbers(text):
            issue = source_issue(text, n, not math.isnan(drawn) and abs(drawn - 90) < _TOL_ANG)
            if issue:
                out.append(issue)
    lengths: list[tuple[str, float, float]] = []
    for side, text in d.fig.side_labels.items():
        a, b = _two(side)
        named = re.fullmatch(r"\s*\$?\s*[A-Za-z]\s*=\s*(.+)", text)  # "c = 13"
        value = _plain_number(named.group(1) if named else text)
        if value is not None and value > 0:
            lengths.append((f"{a}{b}", value, _dist(d.p[a], d.p[b])))
        for n in _label_numbers(text):
            issue = source_issue(text, n, False)
            if issue:
                out.append(issue)
    for rel in parts.givens:
        if rel.kind == "length":
            (a, b), value = rel.args
            labelled = any(n in (f"{a}{b}", f"{b}{a}") for n, _v, _l in lengths)
            if a in d.p and b in d.p and float(value) > 0 and not labelled:
                lengths.append((f"{a}{b}", float(value), _dist(d.p[a], d.p[b])))
    if len(lengths) >= 2:
        ratios = [drawn / value for _n, value, drawn in lengths]
        if max(ratios) - min(ratios) > _TOL_LEN * max(ratios):
            shown = ", ".join(f"{n} = {v:g}" for n, v, _l in lengths)
            out.append(f"the lengths {shown} are not in proportion in the drawing")
    return out


def _step_consistency(step: _Drawing, base: _Drawing) -> list[str]:
    out: list[str] = []
    span = max(base.scale, 1e-9)
    for name, q in base.p.items():
        if name in step.p and _dist(q, step.p[name]) > _TOL_MOVE * span:
            out.append(f"point {name} is not where the question's figure puts it")
    for kind, a, b in base.pieces:
        if a not in step.p or b not in step.p:
            out.append(f"the step's figure leaves out {a}{b}, which the question's figure draws")
            continue
        kept = {"seg": step.seg_drawn, "ray": step.ray_drawn, "line": step.line_through}[kind](a, b)
        if not kept:
            name = f"{a}{b}" if kind == "seg" else f"{kind} {a}{b}"
            out.append(f"the step's figure leaves out {name}, which the question's figure draws")
    return out


def issue_lines(issues: list[FigureIssue]) -> list[str]:
    return [i.message for i in issues]


# ── Marks the problem doesn't give ─────────────────────────────────────


class _Classes:
    """Union-find over hashable keys: which parts the givens make equal."""

    def __init__(self) -> None:
        self.parent: dict[Any, Any] = {}

    def find(self, x: Any) -> Any:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: Any, b: Any) -> None:
        self.parent[self.find(a)] = self.find(b)

    def same(self, keys: list[Any]) -> bool:
        return len({self.find(k) for k in keys}) == 1


def unbacked_marks(fig: ConstructionFigure, problem_text: str) -> dict[str, list[int]]:
    """Mark groups on a question's figure that no given backs: ticks, arcs
    or arrows tying together parts the problem never says are equal or
    parallel (a derived fact such as alternate interior angles would hand
    the student a step), and one-member groups, which pair a part with
    nothing. Returns {field: [group indexes]}. Removing a mark never makes a
    figure false, so callers drop these rather than reject the figure."""
    parts = parse_problem(problem_text)
    d = _Drawing(fig)
    p = d.p

    def seg_key(pair: Iterable[str]) -> frozenset[str]:
        return frozenset(pair)

    def ang_key(a: tuple[str, str, str] | str | None) -> tuple[str, float, float] | None:
        r = d.resolve(a) if a is not None else None
        if r is None or not all(n in p for n in r):
            return None
        x, v, y = r
        d1 = round(math.degrees(math.atan2(p[x][1] - p[v][1], p[x][0] - p[v][0])) % 360, 0)
        d2 = round(math.degrees(math.atan2(p[y][1] - p[v][1], p[y][0] - p[v][0])) % 360, 0)
        lo, hi = sorted((d1, d2))
        return (v, lo, hi)

    lens, angs, pars = _Classes(), _Classes(), _Classes()
    by_len: dict[float, list[frozenset[str]]] = {}
    by_measure: dict[float, list[Any]] = {}
    for rel in parts.givens:
        k, args = rel.kind, rel.args
        if k == "eqlen":
            lens.union(seg_key(args[0]), seg_key(args[1]))
        elif k == "mid":
            m, (a, b) = args
            lens.union(seg_key((a, m)), seg_key((m, b)))
        elif k == "length":
            by_len.setdefault(float(args[1]), []).append(seg_key(args[0]))
        elif k == "eqang":
            k1, k2 = ang_key(args[0]), ang_key(args[1])
            if k1 and k2:
                angs.union(k1, k2)
        elif k == "bisang":
            e, (x, v, z) = args
            k1, k2 = ang_key((x, v, e)), ang_key((e, v, z))
            if k1 and k2:
                angs.union(k1, k2)
        elif k == "measure":
            key = ang_key(args[0])
            if key:
                by_measure.setdefault(float(args[1]), []).append(key)
        elif k == "congtri":
            t1, t2 = args
            for i in range(3):
                j = (i + 1) % 3
                lens.union(seg_key((t1[i], t1[j])), seg_key((t2[i], t2[j])))
                a1 = ang_key((t1[i - 1], t1[i], t1[j]))
                a2 = ang_key((t2[i - 1], t2[i], t2[j]))
                if a1 and a2:
                    angs.union(a1, a2)
        elif k == "par":
            pars.union(seg_key(args[0]), seg_key(args[1]))
        elif k == "linepar":
            pars.union(args[0], args[1])
    for same in (*by_len.values(),):
        for s in same[1:]:
            lens.union(same[0], s)
    for same_a in by_measure.values():
        for a in same_a[1:]:
            angs.union(same_a[0], a)

    out: dict[str, list[int]] = {}
    for i, group in enumerate(fig.tick_groups):
        keys = [seg_key(_two(r)) for r in group]
        if len(keys) < 2 or not lens.same(keys):
            out.setdefault("tick_groups", []).append(i)
    for i, group in enumerate(fig.arc_groups):
        akeys = [ang_key(_three(r)) for r in group]
        if len(akeys) < 2 or None in akeys or not angs.same(akeys):
            out.setdefault("arc_groups", []).append(i)
    line_names = {ln.name for ln in fig.lines if ln.name}
    for i, group in enumerate(fig.parallel_groups):
        pkeys = [_line_key(r) if r in line_names else seg_key(_two(r)) for r in group]
        if len(pkeys) < 2 or not pars.same(pkeys):
            out.setdefault("parallel_groups", []).append(i)
    for i, ref in enumerate(fig.right_angles):
        if not _box_backed(d, _three(ref), parts.givens):
            out.setdefault("right_angles", []).append(i)
    return out


def _box_backed(d: _Drawing, box: tuple[str, str, str], givens: list[_Relation]) -> bool:
    """A right-angle box some given states: a ⊥ where the two lines cross,
    or a 90° angle / right angle at that corner."""
    p = d.p
    for rel in givens:
        k, args = rel.kind, rel.args
        try:
            if k == "perp":
                (a, b), (c, e) = args
                if _box_on_lines(d, box, (p[a], p[b]), (p[c], p[e])):
                    return True
            elif k == "measure" and float(args[1]) == 90:
                ang = d.resolve(args[0])
                if ang is not None and _same_angle(d, ang, box, mod=180):
                    return True
        except (KeyError, ValueError, TypeError, ZeroDivisionError):
            continue
    return False
