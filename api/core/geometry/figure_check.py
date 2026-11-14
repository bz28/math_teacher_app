"""Check a construction figure against its problem text. No AI.

A construction figure gives every point exact coordinates, so plain code
can confirm the picture matches the problem before anyone sees it:

  - every point the problem names is there;
  - every segment, ray, line, triangle side and angle arm it names is drawn
    (a segment counts as drawn when collinear drawn pieces cover it);
  - numbered angles (∠1) are labelled;
  - every given (∥, ⊥, ≅, ∼, =, midpoint, bisects, lies on, opposite rays,
    vertical angles, linear pairs, right angles, stated measures, isosceles
    and equilateral triangles, named quadrilaterals, tangents, points on a
    circle) is true in the drawing;
  - the statement to prove is true in the drawing, and is NOT marked
    (ticks, arcs, arrows or a right-angle box on it would hand the student
    the conclusion);
  - nothing is drawn that the problem doesn't mention;
  - every number on the figure agrees with the drawn measure and comes from
    the problem; a number on the part the problem asks for ("Find m∠C"),
    or one that is only in the answer, is the answer printed on the figure.

Fail closed: a relation word ("parallel", "tangent", "rhombus", ...) that no
parser read, or a relation the drawing can't decide (∠B with three strokes
at B), is an issue, so a figure never passes on a relation the checker
didn't understand.

A step figure (a diagram on one solution step) is checked against the
problem plus the step's own text, must keep the question figure's points
where they were, and must keep what the question figure drew (it may only
add). Steps may mark what they prove and may show results, so the
prove-marking and answer checks don't apply to them.
"""

from __future__ import annotations

import math
import re
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from typing import Any, cast

from api.core.geometry.dsl import ConstructionFigure, is_hidden, split_points, used_points

Point = tuple[float, float]

# Tolerances: relative for lengths, absolute for angles.
_TOL_LEN = 0.02
_TOL_ANG = 1.0
_TOL_LABEL_ANG = 1.5
# Collinearity: distance from the line, as a fraction of the figure's span.
_TOL_COLLINEAR = 0.004
# Step figures: a shared point may move at most this fraction of the span.
_TOL_MOVE = 0.01
# Two named points closer than this fraction of the span sit on one spot.
_TOL_APART = 0.02
# A polygon corner straighter (or sharper) than this many degrees is no corner.
_TOL_CORNER = 2.0


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
# A bare two-point name standing for a segment: "AB = DE", "AB ∥ CD".
_BARE2 = rf"(?<![A-Za-z0-9.\\{{'])({_PT})({_PT})(?![A-Za-z0-9'])"
# Any straight part named by two points: segment, ray, line or bare "AB".
_LIN = rf"(?:{_SEG}|{_RAY}|{_LINE2}|{_BARE2})"
# A named line: one lowercase letter, or ℓ with an index.
_LNAME = r"(?:\\ell\s*_?\s*\{?\d*\}?|ell_?\{?\d*\}?|ℓ\s*_?\{?\d*\}?|(?<![A-Za-z\\])[a-z](?:_\{?\d+\}?)?(?![A-Za-z]))"
_NUM = r"\d+(?:\.\d+)?"
# An angle reference in either form (three points, one vertex, a number).
_ANGREF = rf"\\angle\s*\{{?\s*(?:{_PT}\s*{_PT}\s*{_PT}|{_PT}|\d+)\s*\}}?(?![A-Za-z0-9'])"
# A list joiner: "A, B, and C".
_SEP = r"\s*(?:,\s*and|,|and)\s*"
_PTLIST = rf"{_PT}(?:{_SEP}{_PT})*"

# After a number: not part of an expression ("2x + 5", "3(x+1)").
_NOT_ALGEBRA = r"(?![\d.])(?!\s*°?\s*(?:[a-z](?![a-z])|[(+\-*/^]))"

# Words that allow curved or shaded pieces, matched as whole words
# ("bisector" is not "sector"; "semicircle" is a circle's arc).
_FIGURE_WORDS: dict[str, str] = {
    "circle": r"\b(?:semi)?circles?\b|\bcircular\b",
    "arc": r"\barcs?\b|\bsemicircles?\b",
    "sector": r"\bsectors?\b",
    "shade": r"\bshad(?:e|es|ed|ing)\b",
    "radius": r"\b(?:circum|in)?radius\b",
    "radii": r"\bradii\b",
}


_REGION_WORD = r"(?:\\triangle\s*|triangles?\s+|sectors?\s+|regions?\s+|quadrilaterals?\s+|polygons?\s+)"


def shaded_regions(text: str) -> list[tuple[Any, ...]]:
    """The regions the (cleaned) text names as shaded: "the shaded triangle
    ABD", "shade sector AOB", "region ABCD is shaded". A sector XYZ is
    centred at Y. Shading the text describes any other way ("the shaded
    region outside the triangle") can't be held to a drawing, so it gives
    nothing here and any shading drawn for it is refused."""
    out: list[tuple[Any, ...]] = []
    for m in _shading_statements(text):
        pts = tuple(re.findall(r"[A-Z][0-9]*'*", m.group("n")))
        if "sector" in (m.group("w") or "").lower() and len(pts) == 3:
            major = (m.group("side") or "").strip().lower() == "major"
            region: tuple[Any, ...] = ("sector", pts[1], frozenset((pts[0], pts[2])), major)
        else:
            region = ("polygon", pts)
        if region not in out:
            out.append(region)
    return out


def _shading_statements(text: str) -> list[re.Match[str]]:
    """Where the (cleaned) text says a named region is shaded: code reads
    these, so they need no fact of a reading's."""
    names = r"\{?\s*(?P<n>(?-i:(?:[A-Z][0-9]*'*){3,}))\s*\}?(?![A-Za-z])"  # capitals, however the words are cased
    return [m for pattern in (
        rf"\bshad(?:e|ed|es|ing)\s+(?:the\s+|a\s+)?(?P<side>(?:major|minor)\s+)?(?P<w>{_REGION_WORD})?{names}",
        rf"(?P<side>\b(?:major|minor)\s+)?(?P<w>{_REGION_WORD}){names}\s+(?:is|are)\s+shaded",
    ) for m in re.finditer(pattern, text, re.IGNORECASE) if not _COMPLEMENT.search(_sentence_before(text, m.start()))]


# "Everything except sector AOB is shaded", "the region outside △ABD is
# shaded": the shading is the rest, not the region named. No drawing is
# held to that, so the words are left for a reading (and can't be checked).
_COMPLEMENT = re.compile(
    r"\b(?:except|but|not|outside|other\s+than|besides|excluding|apart\s+from|without|minus)\b", re.IGNORECASE)


def _sentence_before(text: str, at: int) -> str:
    """The text from the start of `at`'s sentence up to `at`."""
    start = max((text.rfind(ch, 0, at) for ch in ".;?!\n"), default=-1)
    return text[start + 1:at]


def figure_words(text: str) -> set[str]:
    """Which of the words allowing circles, arcs, sectors and shading the
    (cleaned) text uses, each as a whole word."""
    return {w for w, pattern in _FIGURE_WORDS.items() if re.search(pattern, text, re.IGNORECASE)}

_TRIANGLE_SHAPES = ("right", "isosceles", "equilateral")
_QUAD_WORD = r"(?i:parallelogram|rectangle|square|rhombus|trapezoid|kite)"
_POLY_WORD = r"(?i:quadrilateral|parallelogram|rectangle|square|rhombus|trapezoid|kite|pentagon|hexagon|polygon)"


def _clean(text: str) -> str:
    t = text.replace("$", " ")
    for a, b in (
        ("∠", r"\angle "), ("△", r"\triangle "), ("≅", r"\cong "), ("∥", r"\parallel "),
        ("⊥", r"\perp "), ("°", r"^\circ "), ("″", "''"), ("′", "'"), ("’", "'"), ("ℓ", r"\ell "),
        ("∼", r"\sim "), ("⊙", r"\odot "),
        (r"\|", r"\parallel "), (r"\measuredangle", r"\angle "), (r"\degree", r"^\circ "),
        (r"\left", ""), (r"\right", ""), (r"\,", " "), (r"\;", " "), (r"\!", ""),
        (r"\cdot", "*"), (r"\times", "*"), (r"\backsim", r"\sim "),
    ):
        t = t.replace(a, b)
    t = re.sub(r"\\(?:text|mathrm|textbf|mathbf|operatorname)\s*\{([^{}]*)\}", r"\1", t)
    # Primes: A^{\prime}, A^\prime, A^{\prime\prime} → A', A''.
    t = re.sub(r"\^\s*\{\s*((?:\\prime\s*)+)\}", lambda m: "'" * m.group(1).count("prime"), t)
    t = re.sub(r"\^\s*\\prime", "'", t).replace(r"\prime", "'")
    t = re.sub(r"\*\*", " ", t)
    t = re.sub(r"\^\s*\{\s*\\circ\s*\}|\^\s*\\circ|\\circ", "°", t)
    t = _words_to_macros(t)
    # "m\angle" (the measure of) reads as the angle itself.
    t = re.sub(r"\bm\s*(?=\\angle)", "", t)
    # "△ABC ~ △DEF": a tilde between two triangles is similarity.
    t = re.sub(rf"({_TRI})\s*~\s*(?=\\triangle)", r"\1 \\sim ", t)
    return t


def _words_to_macros(t: str) -> str:
    """"segment AB" → \\overline{AB}, "ray AB", "line AB", "triangle ABC",
    "angle ABC" / "angle 1": the plain-words names read like the LaTeX ones,
    lists included ("segments AB and CD")."""
    two, three = rf"{_PT}{_PT}", rf"{_PT}{_PT}{_PT}"
    angle_tok = rf"(?:{three}|{_PT}|\d+(?![\d.])(?!\s*(?:°|degrees?)))"
    for word, macro, tok in (
        (r"[Ss]egment", r"\overline", two),
        (r"[Rr]ay", r"\overrightarrow", two),
        (r"[Ll]ine", r"\overleftrightarrow", two),
        (r"[Tt]riangle", r"\triangle", three),
        (r"[Aa]ngle", r"\angle", angle_tok),
    ):
        # "segments AB and CD" is a list; "segment AB and C ..." is not.
        pattern = rf"(?<![\\A-Za-z])(?:{word}s\s+({tok}(?:{_SEP}{tok})*)|{word}\s+({tok}))(?![A-Za-z0-9'])"

        def repl(m: re.Match[str], macro: str = macro, tok: str = tok) -> str:
            body = re.sub(
                rf"(?<![A-Za-z0-9']){tok}(?![A-Za-z0-9'])",
                lambda n: f"{macro}{{{n.group(0)}}}", m.group(1) or m.group(2),
            )
            return " " + body

        t = re.sub(pattern, repl, t)
    return t


def _line_key(raw: str) -> str:
    """One spelling per line name: '\\ell_1', 'ell_{1}', 'ℓ1', 'l_1' → 'ell1'."""
    n = re.sub(r"[\\{}_\s]", "", raw)
    if n.startswith("ℓ"):
        n = "ell" + n[1:]
    if re.fullmatch(r"l\d+", n):
        n = "ell" + n[1:]
    return n


def _plain(s: str) -> str:
    """Cleaned text back to what a teacher reads: \\overline{AB} → AB."""
    s = re.sub(r"\\(?:overline|overrightarrow|overleftrightarrow)\s*\{([^{}]*)\}", r"\1", s)
    for a, b in (
        (r"\angle", "∠"), (r"\triangle", "△"), (r"\parallel", "∥"), (r"\perp", "⊥"),
        (r"\cong", "≅"), (r"\sim", "∼"), (r"\odot", "⊙"), (r"\ell", "ℓ"),
    ):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", re.sub(r"[{}]", "", s)).strip()


@dataclass
class _Relation:
    kind: str
    args: tuple[Any, ...]
    text: str  # how the problem says it, for messages
    span: tuple[int, int] = (0, 0)  # where in the (cleaned) text it was read
    family: str = ""  # the keyword family it answers ("parallel", "rectangle", ...)


@dataclass
class ProblemParts:
    points: set[str] = field(default_factory=set)
    segments: set[frozenset[str]] = field(default_factory=set)
    # Segments a relation names bare ("OA = 3"): drawing them is not extra.
    mentioned: set[frozenset[str]] = field(default_factory=set)
    rays: set[tuple[str, str]] = field(default_factory=set)
    point_lines: set[frozenset[str]] = field(default_factory=set)
    angles: set[tuple[str, str, str]] = field(default_factory=set)
    numbered: set[str] = field(default_factory=set)
    line_names: set[str] = field(default_factory=set)
    transversal: bool = False
    # Transversals the problem implies but doesn't name ("cut by a transversal").
    unnamed_transversals: int = 0
    words: set[str] = field(default_factory=set)
    numbers: set[float] = field(default_factory=set)
    # Named triangles and polygons, vertices in order.
    polygons: list[tuple[str, ...]] = field(default_factory=list)
    givens: list[_Relation] = field(default_factory=list)
    prove: list[_Relation] = field(default_factory=list)
    # What the problem asks for ("Find m∠C", "What is AB?").
    target_angles: list[tuple[str, str, str] | str] = field(default_factory=list)
    target_segments: set[frozenset[str]] = field(default_factory=set)
    # Measures and lengths the problem gives as algebra: (part, "2x + 5").
    expressions: list[tuple[Any, str]] = field(default_factory=list)
    # The circles the problem has, by center ("" for one it doesn't name).
    circles: list[str] = field(default_factory=list)
    # The regions the problem says are shaded: ("polygon", (A, B, D)) or
    # ("sector", center, frozenset of the two ends).
    shaded: list[tuple[Any, ...]] = field(default_factory=list)


# Where the statement to prove starts.
_PROVE_START = re.compile(
    r"\b(?:prove|show\s+that|explain\s+why|justify|verify|demonstrate)\b\s*(?:that\b|why\b)?\s*:?",
    re.IGNORECASE,
)


def _split_prove(t: str) -> tuple[str, str]:
    """(givens, statement to prove). The statement starts at the first
    'Prove' / 'Show that' / 'Explain why' / 'Justify' / 'Verify' /
    'Demonstrate'; a hint after it ('Hint: first prove ...') is not part of it."""
    m = _PROVE_START.search(t)
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
    out.words = figure_words(t)
    out.shaded = shaded_regions(t)
    out.circles = sorted(set(re.findall(
        rf"(?:\bcircle|\\odot)\s*(?:(?:with\s+)?cent(?:er|re)(?:ed)?\s*(?:at\s*)?(?:point\s*)?)?\{{?\s*({_PT})(?![A-Za-z])",
        t, re.IGNORECASE,
    )))
    if not out.circles and "circle" in out.words:
        out.circles = [""]
    out.transversal = re.search(r"\btransversals?\b", lower) is not None
    for source in (t, _clean(extra)):
        _collect_parts(source, out)
    _bare_request_parts(_clean(extra), out)
    out.unnamed_transversals = len(re.findall(
        rf"\btransversal(?!s)(?!\s+(?:\\overline|\\overleftrightarrow|\\overrightarrow|{_PT}{_PT}|{_LNAME}))",
        t, re.IGNORECASE,
    )) + 2 * len(re.findall(r"\btransversals\b", t, re.IGNORECASE))
    out.givens = _relations(given, out)
    out.prove = _relations(prove, out) if prove else []
    out.givens += coordinate_relations(t)
    # Every point a relation names must be drawn.
    for rel in (*out.givens, *out.prove):
        out.points |= _rel_points(rel)
        if rel.kind in ("length", "eqlen", "par", "perp", "tangent", "radius", "diam"):
            out.mentioned |= {frozenset(a) for a in rel.args if isinstance(a, tuple) and len(a) == 2}
        if rel.kind == "bisang":
            out.mentioned.add(frozenset((rel.args[1][1], rel.args[0])))
    return out


def _collect_parts(t: str, out: ProblemParts) -> None:
    for a, b in re.findall(_SEG, t):
        out.segments.add(frozenset((a, b)))
    for a, b in re.findall(_RAY, t):
        out.rays.add((a, b))
    for a, b in re.findall(_LINE2, t):
        out.point_lines.add(frozenset((a, b)))
    for a, b, c in re.findall(_TRI, t):
        for p, q in ((a, b), (b, c), (c, a)):
            out.segments.add(frozenset((p, q)))
        if (a, b, c) not in out.polygons:
            out.polygons.append((a, b, c))
    # Named polygons: "quadrilateral ABCD", "Rectangle ABCD", "ABCD is a kite".
    for m in [
        *re.finditer(rf"\b{_POLY_WORD}s?\s+(?P<v>(?:{_PT}){{3,8}})(?![A-Za-z0-9'])", t),
        *re.finditer(
            rf"(?<![A-Za-z\\{{'])(?P<v>(?:{_PT}){{4}})\s+is\s+an?\s+(?:(?i:isosceles)\s+)?"
            rf"(?:{_QUAD_WORD}|(?i:quadrilateral))\b", t,
        ),
    ]:
        vs = tuple(re.findall(_PT, m["v"]))
        if len(set(vs)) != len(vs):
            continue
        for i in range(len(vs)):
            out.segments.add(frozenset((vs[i], vs[(i + 1) % len(vs)])))
        out.points.update(vs)
        if vs not in out.polygons:
            out.polygons.append(vs)
    for a, v, b in re.findall(_ANG3, t):
        out.angles.add((a, v, b))
    out.numbered |= set(re.findall(_ANGN, t))
    for groups in (re.findall(_SEG, t), re.findall(_RAY, t), re.findall(_LINE2, t)):
        for g in groups:
            out.points.update(g)
    for g in re.findall(_TRI, t) + re.findall(_ANG3, t):
        out.points.update(g)
    out.points.update(re.findall(_ANG1, t))
    for m in re.finditer(rf"\b[Pp]oints?\s+({_PTLIST})(?![A-Za-z0-9'])", t):
        out.points.update(re.findall(_PT, m.group(1)))
    out.points.update(re.findall(rf"(?<![A-Za-z\\])({_PT})\s+(?:is|lies)\s+(?:the\s+midpoint|on|between)\b", t))
    out.points.update(re.findall(rf"\b(?:at|center|centre)\s+(?:point\s+)?({_PT})(?![A-Za-z0-9'])", t))
    out.points.update(re.findall(rf"\b(?:circle|\\odot)\s*({_PT})(?![A-Za-z0-9'])", t))
    out.points.update(re.findall(rf"\bendpoint\s+({_PT})(?![A-Za-z0-9'])", t))
    # A named transversal: "transversal EF" is drawn (as any straight piece).
    for a, b in re.findall(rf"\btransversal\s+({_PT})({_PT})(?![A-Za-z0-9'])", t):
        out.segments.add(frozenset((a, b)))
        out.points.update((a, b))
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
    pairs: list[tuple[str, str]] = []
    for m in re.finditer(
        rf"\b(?:[Ss]egments?|[Dd]iagonals?|[Ss]ides?|[Dd]raw(?:\s+in)?)\s+((?:{_PT}{_PT})(?:{_SEP}{_PT}{_PT})*)"
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


def _pairs_in(s: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for m in re.finditer(_LIN, s):
        g = [x for x in m.groups() if x]
        if len(g) == 2:
            out.append((g[0], g[1]))
    return out


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


def _rel_points(rel: _Relation) -> set[str]:
    """Every point name a relation refers to."""
    out: set[str] = set()

    def walk(x: Any) -> None:
        if isinstance(x, _Relation):
            walk(x.args)
        elif isinstance(x, str):
            if re.fullmatch(_PT, x):
                out.add(x)
        elif isinstance(x, Iterable):
            for y in x:
                walk(y)

    walk(rel.args)
    return out


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
    # A measure or length given as algebra ("m∠ABC = 2x + 5"): a label may show it.
    for m in re.finditer(rf"(?P<ref>{_ANGREF}|{_SEG}|{_BARE2})\s*=\s*(?P<rhs>[^=,;]*?[a-z][^=,;]*?)(?=[,;.]|\s*$)", t):
        ref, rhs = m.group("ref"), m.group("rhs")
        if linear_expr(rhs) is not None:
            pairs = _pairs_in(ref) if not ref.startswith("\\angle") else []
            parts.expressions.append((pairs[0] if pairs else _angle_ref(ref), rhs.strip()))
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


def _all_bare_pairs_are_points(pairs: list[tuple[str, str]], parts: ProblemParts) -> bool:
    return all(set(p) <= parts.points for p in pairs)


class _UnparsedError(ValueError):
    """Algebra the parser doesn't read: the fact it came from can't be checked."""


def _mixed(m: re.Match[str]) -> str:
    whole, num, den = (int(g) for g in m.groups())
    if den == 0:
        return m.group(0)  # left for the parser to refuse
    return f"({whole + num / den!r})"


def _polynomial(expr: str) -> dict[str, float]:
    """Algebra as {variable: coefficient} plus "" for the constant, read by a
    small recursive parser: + − × ÷, brackets ( ) [ ] { }, implicit
    multiplication ("2x", "2(x + 5)", "(x + 1)3"), unary minus, \\frac.
    Only first-degree terms of single letters: a product of two terms that
    both hold a variable, a power, or anything unknown raises _UnparsedError."""
    t = str(expr).replace("−", "-").replace("–", "-").replace("·", "*").replace("×", "*").replace("÷", "/")
    t = re.sub(r"\\(?:left|right)\b", "", t)
    t = re.sub(r"\\(?:cdot|times)\b", "*", t)
    t = re.sub(r"\\div\b", "/", t)
    t = re.sub(r"\^\s*\{?\s*\\circ\s*\}?|\\circ|°|\\,|\\!|\\;|\$", " ", t)
    t = re.sub(r"\\[dt]?frac\s*", r"\\frac", t)
    t = re.sub(r"\\frac(\d)(\d)", r"\\frac{\1}{\2}", t)  # \frac12 is \frac{1}{2}
    # A mixed number is one number: 4\frac{1}{2} and 4 1/2 are 4.5 (not 4·½).
    t = re.sub(r"(?<![\d.])(\d+)\s*\\frac\s*\{\s*(\d+)\s*\}\s*\{\s*(\d+)\s*\}", _mixed, t)
    t = re.sub(r"(?<![\d./])(\d+)\s+(\d+)\s*/\s*(\d+)(?![\d.])", _mixed, t)
    # A decimal comma (1,5 or 2{,}5) is left unread: reading it as two
    # numbers would misread the measure.
    tokens = re.findall(r"\\frac|\d+(?:\.\d+)?|\.\d+|[a-z]|[-+*/()\[\]{}^]|\S", t)
    pos = 0

    def peek() -> str | None:
        return tokens[pos] if pos < len(tokens) else None

    def take(want: str | None = None) -> str:
        nonlocal pos
        tok = peek()
        if tok is None or (want is not None and tok != want):
            raise _UnparsedError(expr)
        pos += 1
        return tok

    def add(p: dict[str, float], q: dict[str, float], sign: float = 1.0) -> dict[str, float]:
        out = dict(p)
        for k, v in q.items():
            out[k] = out.get(k, 0.0) + sign * v
        return out

    def mul(p: dict[str, float], q: dict[str, float]) -> dict[str, float]:
        pv = {k for k, v in p.items() if k and v}
        qv = {k for k, v in q.items() if k and v}
        if pv and qv:
            raise _UnparsedError(expr)  # x·y or x²: not first degree
        c, other = (p.get("", 0.0), q) if not pv else (q.get("", 0.0), p)
        return {k: c * v for k, v in other.items()}

    def const(p: dict[str, float]) -> float:
        if any(k and v for k, v in p.items()):
            raise _UnparsedError(expr)
        return p.get("", 0.0)

    closing = {"(": ")", "[": "]", "{": "}"}

    def atom() -> dict[str, float]:
        tok = take()
        if tok in closing:
            inner = sum_()
            take(closing[tok])
            return inner
        if tok == "\\frac":
            take("{")
            num = sum_()
            take("}")
            take("{")
            den = const(sum_())
            take("}")
            if den == 0:
                raise _UnparsedError(expr)
            return {k: v / den for k, v in num.items()}
        if re.fullmatch(r"\d+(?:\.\d+)?|\.\d+", tok):
            return {"": float(tok)}
        if re.fullmatch(r"[a-z]", tok):
            return {tok: 1.0}
        raise _UnparsedError(expr)

    def factor() -> dict[str, float]:
        tok = peek()
        if tok in ("-", "+"):
            take()
            inner = factor()
            return {k: -v for k, v in inner.items()} if tok == "-" else inner
        return atom()  # a power ("x^2") is left unread, so the whole fails

    def term() -> dict[str, float]:
        out = factor()
        while True:
            tok = peek()
            if tok == "*":
                take()
                out = mul(out, factor())
            elif tok == "/":
                take()
                den = const(factor())
                if den == 0:
                    raise _UnparsedError(expr)
                out = {k: v / den for k, v in out.items()}
            elif tok is not None and (tok in closing or tok == "\\frac" or re.fullmatch(r"[a-z]|\d.*|\.\d+", tok)):
                out = mul(out, atom())  # implicit: "2x", "2(x + 5)", "(x + 1)(2)"
            else:
                return out

    def sum_() -> dict[str, float]:
        out = term()
        while peek() in ("+", "-"):
            sign = 1.0 if take() == "+" else -1.0
            out = add(out, term(), sign)
        return out

    if not tokens:
        raise _UnparsedError(expr)
    result = sum_()
    if pos != len(tokens):
        raise _UnparsedError(expr)
    return result


def _linear(expr: str) -> tuple[float, float, str] | None:
    """'3x', '2x + 5', '2(x + 5)', '-(x - 3)' → (a, b, var) for a·var + b;
    None for anything else (two variables, powers, nothing to solve for,
    or algebra the parser can't read)."""
    try:
        poly = _polynomial(expr)
    except _UnparsedError:
        return None
    variables = [k for k, v in poly.items() if k and abs(v) > 1e-12]
    if len(variables) != 1:
        return None
    var = variables[0]
    return (poly[var], poly.get("", 0.0), var)


def _ang_key(a: Any) -> Any:
    """One key per angle however it's named: ∠ABC and ∠CBA are one angle."""
    return a if isinstance(a, str) else (a[1], frozenset((a[0], a[2])))


def solved_expressions(rels: list[_Relation]) -> list[_Relation]:
    """The same for a reading's facts: each "expr" relation (∠ and its
    algebra) solved from the others; one the facts don't fix constrains
    nothing and is dropped."""
    exprs: dict[Any, tuple[Any, float, float, str, str]] = {}
    for rel in rels:
        if rel.kind == "expr":
            lin = linear_expr(rel.args[1])
            if lin:
                exprs[_ang_key(rel.args[0])] = (rel.args[0], *lin, str(rel.args[1]))
    return _solve_measures(exprs, [r for r in rels if r.kind != "expr"])


def linear_expr(expr: str) -> tuple[float, float, str] | None:
    """A measure or length written as algebra ("2x + 5", "(3x)°") as
    (a, b, var) for a·var + b; None when it isn't one variable to the
    first power (then no drawing can be checked against it)."""
    return _linear(str(expr))


def algebra_relation(rels: list[_Relation]) -> _Relation | None:
    """Every measure and length the problem gives as algebra, held
    together: one relation saying some value of each variable (and one
    scale for the lengths) makes the drawing show them all. "m∠A = x°,
    m∠B = (2x)°" is then checked as ∠B = 2·∠A even when nothing fixes x;
    "AB = 2x, AC = 2x" as AB = AC. Plain lengths join the lengths, since
    they share the scale."""
    solved = {_ang_key(r.args[0]) for r in solved_expressions(rels)}
    angles, lengths, said = [], [], []
    for rel in rels:
        if rel.kind == "lenexpr" and (lin := linear_expr(rel.args[1])):
            lengths.append((rel.args[0], *lin))
            said.append(rel.text)
    length_vars = {var for _s, _a, _b, var in lengths}
    for rel in rels:
        # An angle its facts fix is checked as that measure; it joins only
        # to give a length's variable its value.
        if rel.kind == "expr" and (lin := linear_expr(rel.args[1])) and (
            _ang_key(rel.args[0]) not in solved or lin[2] in length_vars
        ):
            angles.append((rel.args[0], *lin))
            said.append(rel.text)
    if not angles and not lengths:
        return None
    if lengths:
        lengths += [(r.args[0], 0.0, float(r.args[1]), "") for r in rels if r.kind == "length"]
    return _Relation("algebra", (tuple(angles), tuple(lengths)), ", ".join(said))


def _algebra_holds(d: _Drawing, angles: tuple[Any, ...], lengths: tuple[Any, ...]) -> bool | None:
    """Some value of each variable makes every angle given as algebra match
    its drawn measure, and some scale (with those values) every length."""
    drawn_ang = []
    for ref, a, b, var in angles:
        ang = d.resolve(ref)
        if ang is None or not all(n in d.p for n in ang):
            return None
        drawn_ang.append((d.measure(ang), a, b, var))
    values: dict[str, float] = {}
    for var in {v for _m, _a, _b, v in drawn_ang}:
        terms = [(m, a, b) for m, a, b, v in drawn_ang if v == var]
        values[var] = sum(a * (m - b) for m, a, b in terms) / sum(a * a for _m, a, _b in terms)
        if any(abs(a * values[var] + b - m) >= _TOL_ANG for m, a, b in terms):
            return False
    if not lengths:
        return True
    drawn_len = []
    for (x, y), a, b, var in lengths:
        if x not in d.p or y not in d.p:
            return None
        drawn_len.append((_dist(d.p[x], d.p[y]), a, b, var))
    # drawn = scale·(a·var + b): linear in the scale and in scale·var for
    # each variable the angles don't fix.
    free = sorted({v for _l, a, _b, v in drawn_len if v and a and v not in values})
    cols = {"": 0, **{v: i + 1 for i, v in enumerate(free)}}
    rows = []
    for length, a, b, var in drawn_len:
        row = [0.0] * len(cols)
        row[0] = b + (a * values[var] if var in values else 0.0)
        if var in cols and var:
            row[cols[var]] += a
        rows.append((row, length))
    # Unknowns no length uses (no plain number: the scale alone) drop out.
    used = [j for j in range(len(cols)) if any(abs(r[j]) > 1e-12 for r, _l in rows)]
    rows = [([r[j] for j in used], length) for r, length in rows]
    n = len(used)
    normal = [[sum(r[i] * r[j] for r, _l in rows) for j in range(n)] for i in range(n)]
    rhs = [sum(r[i] * length for r, length in rows) for i in range(n)]
    solved = _solve([({j: normal[i][j] for j in range(n)}, rhs[i]) for i in range(n)], n)
    if len(solved) < n:
        return None  # two variables the lengths can't tell apart
    biggest = max(length for _r, length in rows)
    if 0 in used and solved[used.index(0)] <= 1e-9 * biggest:
        return False  # no scale: the plain numbers in the lengths vanish
    fitted = [sum(r[j] * solved[j] for j in range(n)) for r, _l in rows]
    return all(f > 0 and abs(f - length) <= _TOL_LEN * biggest for f, (_r, length) in zip(fitted, rows))


def _solve_measures(
    exprs: dict[Any, tuple[Any, float, float, str, str]], rels: list[_Relation],
) -> list[_Relation]:
    if not exprs:
        return []
    # Unknowns: each variable, then each angle.
    cols: dict[Any, int] = {}

    def col(k: Any) -> int:
        return cols.setdefault(k, len(cols))

    rows: list[tuple[dict[int, float], float]] = []

    def eq(terms: list[tuple[Any, float]], rhs: float) -> None:
        row: dict[int, float] = {}
        for k, c in terms:
            row[col(k)] = row.get(col(k), 0.0) + c
        rows.append((row, rhs))

    for key, (_ang, a, b, var, _text) in exprs.items():
        eq([(("ang", key), 1.0), (("var", var), -a)], b)
    for rel in rels:
        k, args = rel.kind, rel.args
        if k == "measure":
            eq([(("ang", _ang_key(args[0])), 1.0)], float(args[1]))
        elif k in ("eqang", "vertical"):
            eq([(("ang", _ang_key(args[0])), 1.0), (("ang", _ang_key(args[1])), -1.0)], 0.0)
        elif k == "anglesum":
            eq([(("ang", _ang_key(args[0])), 1.0), (("ang", _ang_key(args[1])), 1.0)], float(args[2]))
        elif k == "bisang":
            e, (x, v, z) = args
            half1, half2, whole = (("ang", _ang_key(q)) for q in ((x, v, e), (e, v, z), (x, v, z)))
            eq([(half1, 1.0), (half2, -1.0)], 0.0)
            eq([(half1, 1.0), (half2, 1.0), (whole, -1.0)], 0.0)
    # Opposite rays OA, OD: the named angles at O that run from A round to D add up to 180°.
    for rel in rels:
        if rel.kind != "opp":
            continue
        o, a, b = rel.args
        edges = [
            tuple(key[1]) for key in (*(e for e in exprs), *(c[1] for c in cols if c[0] == "ang"))
            if isinstance(key, tuple) and key[0] == o and len(key[1]) == 2
        ]
        path = _ray_path(a, b, edges)
        if path:
            eq([(("ang", (o, frozenset(pair))), 1.0) for pair in path], 180.0)
    values = _solve(rows, len(cols))
    out = []
    for key, (ang, _a, _b, var, text) in exprs.items():
        value = values.get(cols[("ang", key)])
        if value is not None:
            out.append(_Relation(
                "measure", (ang, value), f"{_ang_txt(ang)} = {text} = {value:g}°", family="solved",
            ))
    return out


def _ray_path(a: str, b: str, edges: list[tuple[str, ...]]) -> list[tuple[str, str]]:
    """Angles (pairs of ray ends) leading from ray a to ray b, each ray used once."""
    from collections import deque

    seen = {a}
    queue: deque[tuple[str, list[tuple[str, str]]]] = deque([(a, [])])
    while queue:
        at, path = queue.popleft()
        if at == b:
            return path
        for e in edges:
            if at in e:
                nxt = e[1] if e[0] == at else e[0]
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, [*path, (at, nxt)]))
    return []


def _solve(rows: list[tuple[dict[int, float], float]], n: int) -> dict[int, float]:
    """The unknowns a linear system fixes (Gauss–Jordan; free ones left out)."""
    m = [[row.get(j, 0.0) for j in range(n)] + [rhs] for row, rhs in rows]
    pivots: list[int] = []
    r = 0
    for c in range(n):
        best = max(range(r, len(m)), key=lambda i: abs(m[i][c]), default=None)
        if best is None or abs(m[best][c]) < 1e-9:
            continue
        m[r], m[best] = m[best], m[r]
        div = m[r][c]
        m[r] = [x / div for x in m[r]]
        for i in range(len(m)):
            if i != r and abs(m[i][c]) > 1e-12:
                f = m[i][c]
                m[i] = [x - f * y for x, y in zip(m[i], m[r])]
        pivots.append(c)
        r += 1
        if r == len(m):
            break
    out: dict[int, float] = {}
    for i, c in enumerate(pivots):
        if all(abs(m[i][j]) < 1e-9 for j in range(n) if j != c):
            out[c] = m[i][n]
    return out


def _quad_relations(shape: str, q: tuple[str, ...], isosceles: bool) -> list[_Relation]:
    """What a named quadrilateral is, as relations a drawing can be measured
    against (and whose marks the figure can carry)."""
    a, b, c, d = q
    name = f"{shape} {''.join(q)}"
    s = ((a, b), (b, c), (c, d), (d, a))

    def rel(kind: str, *args: object, what: str) -> _Relation:
        return _Relation(kind, args, f"{name} ({what})")

    def par(i: int, j: int) -> _Relation:
        return rel("par", s[i], s[j], what=f"{''.join(s[i])} ∥ {''.join(s[j])}")

    def eq(i: int, j: int) -> _Relation:
        return rel("eqlen", s[i], s[j], what=f"{''.join(s[i])} ≅ {''.join(s[j])}")

    def right(v: int) -> _Relation:
        ang = (q[v - 1], q[v], q[(v + 1) % 4])
        return rel("measure", ang, 90.0, what=f"right angle at {q[v]}")

    if shape == "parallelogram":
        return [par(0, 2), par(1, 3)]
    if shape == "rectangle":
        return [par(0, 2), par(1, 3), *(right(v) for v in range(4))]
    if shape == "rhombus":
        return [par(0, 2), par(1, 3), eq(0, 1), eq(1, 2), eq(2, 3)]
    if shape == "square":
        return [par(0, 2), par(1, 3), eq(0, 1), eq(1, 2), eq(2, 3), *(right(v) for v in range(4))]
    if shape == "kite":
        return [_Relation("any", (((eq(0, 1), eq(2, 3)), (eq(1, 2), eq(3, 0))),), name)]
    # A trapezoid has a pair of parallel sides; an isosceles one has equal legs.
    if isosceles:
        return [_Relation("any", (((par(0, 2), eq(1, 3)), (par(1, 3), eq(0, 2))),), f"isosceles {name}")]
    return [_Relation("any", (((par(0, 2),), (par(1, 3),)),), name)]


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
        # The figure's size, which every tolerance is relative to: the points
        # it shows or draws with, and its circles. A helper point nothing
        # uses is left out (it would make the tolerances as loose as it is
        # far away) and refused by the checker.
        self.used = used_points(fig)
        xs = [q[0] for k, q in self.p.items() if k in self.used]
        ys = [q[1] for k, q in self.p.items() if k in self.used]
        for c in fig.circles:
            cx, cy = self.p[c.center]
            r = float(c.radius) if c.radius is not None else _dist(self.p[c.center], self.p[c.through or c.center])
            xs += [cx - r, cx + r]
            ys += [cy - r, cy + r]
        self.scale = max(max(xs) - min(xs), max(ys) - min(ys), 1e-9) if xs else 1e-9
        # (kind, a, b): seg a→b, ray from a through b, or line through a, b.
        self.pieces: list[tuple[str, str, str]] = (
            [("seg", *_two(s)) for s in fig.segments]
            + [("ray", *_two(r)) for r in fig.rays]
            + [("line", ln.through[0], ln.through[1]) for ln in fig.lines]
        )
        self.lines = {_line_key(ln.name): ln for ln in fig.lines if ln.name}
        # In name order: the checker's messages (and so the retry prompt) must
        # not depend on the order the model wrote its labels in.
        self.labels: dict[tuple[str, str, str], str] = {
            _three(k): v for k, v in sorted(fig.angle_labels.items())
        }

    def collinear(self, a: Point, b: Point, q: Point) -> bool:
        d = _dist(a, b)
        if d < 1e-12:
            return False
        cross = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
        return abs(cross) / d <= _TOL_COLLINEAR * self.scale

    def same_line(self, s1: tuple[str, ...], s2: tuple[str, ...]) -> bool:
        """The straight pieces through s1's two points and s2's lie on one line."""
        a, b = self.p[s1[0]], self.p[s1[1]]
        return self.collinear(a, b, self.p[s2[0]]) and self.collinear(a, b, self.p[s2[1]])

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
            # ∠1: the angle labelled "1" (or "∠1", "∠1 = 40°").
            for key, text in self.labels.items():
                if text.strip() == a or re.sub(r"\s+", "", text.strip()) == f"∠{a}" or any(
                    n.lstrip("∠") == a for n in _parse_label(text, {a}).names
                ):
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
    facts: Any = None,
) -> list[FigureIssue]:
    """Every way `fig` disagrees with `problem_text`; empty means it passes.

    `request_text` is the teacher's message (parts she asks for must be
    drawn). For a step figure pass `step_text` (its title + description)
    and `base`, the question's own figure when it has one. `facts` is the
    problem's agreed reading (api/core/geometry/facts.py): what the figure
    must show comes from it; without it, from parsing the text."""
    is_step = step_text is not None
    parts = problem_parts(problem_text, facts, extra=f"{request_text}\n{step_text or ''}")
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
    labels = {
        n.lstrip("∠") for v in fig.angle_labels.values() for n in _parse_label(v, parts.numbered).names
    }
    for n in sorted(parts.numbered - labels):
        say("unlabelled", f"∠{n} is not labelled")
    if parts.transversal and not parts.line_names - {
        k for r in parts.givens if r.kind == "linepar" for k in r.args
    } and not _has_transversal(d):
        say("not_drawn", "not drawn: the transversal")

    # Givens true; the statement to prove true and unmarked. A relation the
    # drawing can't decide (∠B with three strokes at B) fails too.
    for rel, what, kind in (
        *((r, f"the given {r.text}", "false_given") for r in parts.givens),
        *((r, f"the statement to prove ({r.text})", "false_prove") for r in parts.prove),
    ):
        held = _holds(rel, d)
        if held is False:
            say(kind, f"{what} is not true in the drawing")
        elif held is None and rel.kind != "length" and _rel_points(rel) <= set(d.p):
            say("undecided", f"the checker can't measure {what} in the drawing")
    if not is_step:
        given_keys = {_rel_key(r) for r in parts.givens}
        for rel in parts.prove:
            if _rel_key(rel) not in given_keys and _marked(rel, d):
                say(
                    "prove_marked",
                    f"the statement to prove ({rel.text}) is marked on the figure; mark only the givens",
                )

    # A figure that collapses can make anything "true": two named points on
    # one spot, a named triangle or polygon drawn flat.
    for message in _degenerate(d, parts):
        say("degenerate", message)

    # Every mark on the figure is true in the drawing, and every given with
    # a textbook mark is marked (so "the givens are marked" is always true).
    for message in _mark_issues(d):
        say("false_mark", message)
    # (A step figure builds on the question's, which carries the marks; what
    # a step shows needs none.)
    for what in [] if is_step else _unmarked(d, parts, problem_text)[0]:
        say("unmarked", f"not marked: the given {what} (mark it as a textbook does)")

    # Two figures the problem names apart (no corner shared) are drawn
    # apart: overlapping, their sides and labels read as one figure.
    for message in _overlaps(d, parts):
        say("overlap", message)

    # Nothing drawn that the problem doesn't mention.
    for message in _extras(d, parts, base):
        say("extra", message)

    # Numbers on the figure: agree with the drawing, come from the problem.
    for message in _label_issues(d, parts, final_answer if not is_step else None, problem_text, step_text):
        say("label", message)

    for message in _arc_side_issues(d, _clean(f"{problem_text}\n{request_text}\n{step_text or ''}")):
        say("arc_side", message)

    if base is not None:
        for message in _step_consistency(d, _Drawing(base)):
            say("moved", message)
    return issues


def _extended(d: _Drawing, start: str, end: str, to: str) -> bool | None:
    """Segment start→end is extended past `end`: to the point `to` (in line,
    past `end`, and the piece end→to drawn), or, with no point named, by
    some drawn piece from `end` running on away from `start`."""
    p = d.p
    if start not in p or end not in p or (to and to not in p):
        return None
    a, b = p[start], p[end]

    def past(q: Point) -> bool:
        return d.collinear(a, b, q) and d.param(a, b, q) > 1 + _TOL_APART

    if to:
        return past(p[to]) and (d.seg_drawn(end, to) or d.seg_drawn(start, to) or d.ray_drawn(end, to)
                                or d.ray_drawn(start, to) or d.line_through(start, to))
    for kind, x, y in d.pieces:
        for u, w in ((x, y), (y, x)) if kind != "ray" else ((x, y),):
            if kind == "ray" and u == end and past(p[w]):
                return True
            if kind == "seg" and {u, w} & {end, start} and past(p[w]) and d.param(a, b, p[u]) <= 1 + _TOL_APART:
                return True
            if kind == "line" and d.collinear(a, b, p[u]) and d.collinear(a, b, p[w]):
                return True
    return False


def coordinates(text: str) -> dict[str, tuple[float, float]]:
    """Points the problem places at coordinates: "A(0, 0)", "B (4, 2)"."""
    num = r"(-?\d+(?:\.\d+)?)"
    out: dict[str, tuple[float, float]] = {}
    for m in re.finditer(rf"(?<![A-Za-z\\])({_PT})\s*=?\s*\(\s*{num}\s*,\s*{num}\s*\)", text.replace("−", "-")):
        out.setdefault(m.group(1), (float(m.group(2)), float(m.group(3))))
    return out


def coordinate_relations(text: str) -> list[_Relation]:
    """The problem's coordinates as one check (read by code from the text)."""
    at = coordinates(text)
    if len(at) < 2:
        return []
    said = ", ".join(f"{n}({x:g}, {y:g})" for n, (x, y) in sorted(at.items()))
    return [_Relation("coords", (tuple(sorted(at.items())),), f"the points are at {said}")]


def _at_coordinates(d: _Drawing, at: dict[str, tuple[float, float]]) -> bool | None:
    """The points sit where the problem's coordinates put them, up to one
    shift and one (positive) scale: the same shape, the same way up."""
    if not all(n in d.p for n in at) or len(at) < 2:
        return None
    names = sorted(at)
    gx = sum(at[n][0] for n in names) / len(names)
    gy = sum(at[n][1] for n in names) / len(names)
    dx = sum(d.p[n][0] for n in names) / len(names)
    dy = sum(d.p[n][1] for n in names) / len(names)
    given = [(at[n][0] - gx, at[n][1] - gy) for n in names]
    drawn = [(d.p[n][0] - dx, d.p[n][1] - dy) for n in names]
    norm = sum(x * x + y * y for x, y in given)
    if norm <= 0:
        return None
    k = sum(gx_ * x + gy_ * y for (gx_, gy_), (x, y) in zip(given, drawn)) / norm
    if k <= 0:
        return False
    return all(_dist((k * g[0], k * g[1]), q) <= 0.01 * d.scale for g, q in zip(given, drawn))


def _has_transversal(d: _Drawing) -> bool:
    """Some drawn piece cuts across two parallel ones."""
    return any(_crosses_parallels(d, pc) for pc in d.pieces)


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
            if k == "par":
                # Parallel means two lines: one drawn on top of the other is not it.
                return diff < _TOL_ANG and not d.same_line((a, b), (c, e))
            return abs(diff - 90) < _TOL_ANG
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
        if k == "anglerange":
            ang = d.resolve(args[0])
            if ang is None:
                return None
            return _shaped(d.measure(ang), args[1])
        if k == "trishape":
            (a, b, c), shape = args
            if not all(n in p for n in (a, b, c)):
                return None
            if shape == "scalene":
                sides = sorted(_dist(p[x], p[y]) for x, y in ((a, b), (b, c), (c, a)))
                return all(s2 - s1 >= _SHAPE_LEN * s2 for s1, s2 in zip(sides, sides[1:]))
            corners = [_angle(p[x], p[v], p[y]) for x, v, y in ((c, a, b), (a, b, c), (b, c, a))]
            if shape == "obtuse":
                return any(_shaped(m, "obtuse") for m in corners)
            return all(_shaped(m, "acute") for m in corners)
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
        if k == "anglepair":
            return _angle_pair(d, args[0], d.resolve(args[1]), d.resolve(args[2]))
        if k == "algebra":
            return _algebra_holds(d, args[0], args[1])
        if k == "interior":
            # Ray v→end lies strictly inside ∠x v y: the two parts add up to it.
            v, end, arms = cast(tuple[str, str, tuple[str, str]], args)
            x, y = arms
            if not all(n in p for n in (v, end, x, y)):
                return None
            part1, part2 = _angle(p[x], p[v], p[end]), _angle(p[end], p[v], p[y])
            return part1 > _TOL_ANG and part2 > _TOL_ANG and abs(part1 + part2 - _angle(p[x], p[v], p[y])) < _TOL_ANG
        if k == "beyond":
            return _extended(d, *args)
        if k == "coords":
            return _at_coordinates(d, dict(args[0]))
        if k == "linepar":
            n1, n2 = args
            if n1 not in d.lines or n2 not in d.lines:
                return None
            th1, th2 = d.lines[n1].through, d.lines[n2].through
            return (
                _dir_diff(_direction(p[th1[0]], p[th1[1]]), _direction(p[th2[0]], p[th2[1]])) < _TOL_ANG
                and not d.same_line(tuple(th1), tuple(th2))
            )
        if k == "oncircle":
            pts, center = args
            return any(all(n in p and _on_circle(d, c, n) for n in pts) for c in _circles(d, center))
        if k == "diam":
            (a, b), center = args
            return any(
                _on_circle(d, c, a) and _on_circle(d, c, b)
                and _dist(p[c.center], ((p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2))
                <= _TOL_LEN * _dist(p[a], p[b])
                for c in _circles(d, center)
            )
        if k == "radius":
            (a, b), = args
            return any(
                (c.center == x and _on_circle(d, c, y)) for c in d.fig.circles for x, y in ((a, b), (b, a))
            )
        if k == "tangent":
            (a, b), center, at = args
            if not all(n in p for n in (a, b, *([at] if at else []))):
                return None
            for c in _circles(d, center):
                r, o = _radius(d, c), p[c.center]
                dist = abs(_cross(p[a], p[b], o)) / _dist(p[a], p[b])
                if abs(dist - r) <= _TOL_LEN * r and (
                    not at or (_on_circle(d, c, at) and d.collinear(p[a], p[b], p[at]))
                ):
                    return True
            return False
        if k == "online":
            m, (a, b) = args
            if not all(n in p for n in (m, a, b)):
                return None
            return d.collinear(p[a], p[b], p[m])
        if k == "linemid":
            (a, b), (c, e) = args
            if not all(n in p for n in (a, b, c, e)):
                return None
            return d.collinear(p[a], p[b], ((p[c][0] + p[e][0]) / 2, (p[c][1] + p[e][1]) / 2))
        if k == "lineperp":
            n1, n2 = args
            if n1 not in d.lines or n2 not in d.lines:
                return None
            th1, th2 = d.lines[n1].through, d.lines[n2].through
            diff = _dir_diff(_direction(p[th1[0]], p[th1[1]]), _direction(p[th2[0]], p[th2[1]]))
            return abs(diff - 90) < _TOL_ANG
        if k == "anglesum":
            a1, a2 = d.resolve(args[0]), d.resolve(args[1])
            total, linear = args[2], args[3]
            if a1 is None or a2 is None:
                return None
            if abs(d.measure(a1) + d.measure(a2) - total) >= _TOL_ANG:
                return False
            if not linear:
                return True
            # A linear pair: one shared arm, the other two opposite.
            if p[a1[1]] != p[a2[1]]:
                return False
            v = p[a1[1]]
            ends1, ends2 = (p[a1[0]], p[a1[2]]), (p[a2[0]], p[a2[2]])
            return any(
                _angle(x, v, y) < _TOL_ANG and abs(_angle(ends1[1 - i], v, ends2[1 - j]) - 180) < _TOL_ANG
                for i, x in enumerate(ends1) for j, y in enumerate(ends2)
            )
        if k == "any":
            results = []
            for alt in args[0]:
                held = [_holds(r, d) for r in alt]
                results.append(False if False in held else None if None in held else True)
            if True in results:
                return True
            return False if all(r is False for r in results) else None
        if k == "lengthlabel":
            # A length on a side the problem doesn't name: some side of the
            # role the words give (any side, a leg, …) carries it.
            role = args[1] if len(args) > 1 else ""
            for ref, text in d.fig.side_labels.items():
                named = re.fullmatch(r"\s*\$?\s*[A-Za-z]\s*=\s*(.+)", text)  # "c = 13"
                value = _plain_number((named.group(1) if named else text).rstrip(". "))
                if value is not None and abs(value - float(args[0])) <= 1e-9 * max(1.0, abs(value)):
                    if _has_role(d, ref, role):
                        return True
            return False
        if k == "anyshape":
            return _has_shape(d, args[0])
        if k == "numbered":
            # ∠1 is the angle the reading says: its label sits on that angle.
            labelled, meant = d.resolve(args[0]), d.resolve(args[1])
            if labelled is None or meant is None:
                return None
            return _same_angle(d, labelled, meant)
        if k == "center":
            v, center = args
            return any(c.center == v for c in _circles(d, center)) if v in p else None
        if k == "crosses":
            t, l1, l2 = args

            def through(ref: str) -> tuple[Point, Point] | None:
                if _line_key(ref) in d.lines:
                    a, b = d.lines[_line_key(ref)].through
                    return p[a], p[b]
                n = re.findall(_PT, ref)
                return (p[n[0]], p[n[1]]) if len(n) == 2 and all(x in p for x in n) else None

            ls = [through(r) for r in (l1, l2)]
            if None in ls:
                return None
            if t:
                own = through(t)
                if own is None:
                    return None
                return all(_dir_diff(_direction(*own), _direction(*x)) > 5 for x in ls if x)
            return _has_transversal(d)
    except (KeyError, ValueError, TypeError, ZeroDivisionError):
        return None
    return None


def _has_role(d: _Drawing, ref: str, role: str) -> bool:
    """The labelled part `ref` plays `role`: "" any side; "leg" or
    "hypotenuse" a side of a drawn triangle with a right angle beside it or
    across from it; "radius" from a circle's centre to the circle;
    "diameter" a chord through the centre."""
    if not role:
        return True
    try:
        a, b = split_points(ref, 2)
    except ValueError:
        return False
    p = d.p
    if a not in p or b not in p:
        return False
    if role in ("radius", "diameter"):
        for c in d.fig.circles:
            if role == "radius" and c.center in (a, b) and _on_circle(d, c, b if c.center == a else a):
                return True
            if role == "diameter" and _on_circle(d, c, a) and _on_circle(d, c, b) and d.collinear(
                    p[a], p[b], p[c.center]) and 0 < d.param(p[a], p[b], p[c.center]) < 1:
                return True
        return False
    for v in p:
        if v in (a, b):
            continue
        if not (d.seg_drawn(a, b) and d.seg_drawn(a, v) and d.seg_drawn(b, v)):
            continue
        right_at = [x for x, (y, z) in ((v, (a, b)), (a, (v, b)), (b, (v, a)))
                    if abs(_angle(p[y], p[x], p[z]) - 90) < _TOL_ANG]
        if role == "hypotenuse" and v in right_at:
            return True
        if role == "leg" and (a in right_at or b in right_at):
            return True
    return False


# An obtuse or acute angle, or a scalene triangle, has to look it: 5° clear
# of a right angle, and sides 5% apart (a 91° angle reads as right).
_SHAPE_ANG = 5.0
_SHAPE_LEN = 0.05


def _shaped(measure: float, shape: str) -> bool:
    if shape == "obtuse":
        return 90 + _SHAPE_ANG <= measure <= 180 - _SHAPE_ANG
    return _SHAPE_ANG <= measure <= 90 - _SHAPE_ANG


def _degenerate(d: _Drawing, parts: ProblemParts) -> list[str]:
    """Named points drawn on one spot; named triangles and polygons drawn
    flat (no area, or three corners in a row) or crossed (a bow-tie); a
    helper point nothing in the figure uses."""
    out: list[str] = []
    if any(is_hidden(n) and n not in d.used for n in d.p):
        out.append("a helper point is used by nothing in the figure; remove it")
    named = sorted(n for n in d.p if not is_hidden(n))
    for i, a in enumerate(named):
        for b in named[i + 1:]:
            if _dist(d.p[a], d.p[b]) < _TOL_APART * d.scale:
                out.append(f"points {a} and {b} are drawn on the same spot")
    for poly in dict.fromkeys(parts.polygons):
        if len(set(poly)) != len(poly) or not all(n in d.p for n in poly):
            continue
        what = ("triangle " if len(poly) == 3 else "") + "".join(poly)
        flaw = _polygon_flaw([d.p[n] for n in poly], d.scale)
        if flaw is not None:
            kind, i, j = flaw
            if kind == "flat":
                out.append(f"{what} is drawn flat (it has no area)")
            elif kind == "short":
                side = poly[i] + poly[(i + 1) % len(poly)]
                out.append(f"{what} is drawn with side {side} too short to see, so it is drawn flat")
            elif kind == "row":
                corners = ", ".join(poly[(i + k) % len(poly)] for k in (-1, 0, 1))
                out.append(f"{what} is drawn with {corners} in a row, so {poly[i]} is no corner")
            else:
                s1 = poly[i] + poly[(i + 1) % len(poly)]
                s2 = poly[j] + poly[(j + 1) % len(poly)]
                out.append(f"{what} is drawn with sides {s1} and {s2} crossing, so it is no {_poly_word(poly)}")
    return out


def _polygon_flaw(q: list[Point], scale: float) -> tuple[str, int, int] | None:
    """Why the cycle of points `q` is no real polygon: ("flat", 0, 0) with
    no area, ("short", i, 0) when side i is too short to see (a sliver),
    ("row", i, 0) when corner i lies in a row with its neighbours,
    ("cross", i, j) when sides i and j (not next to each other) meet: a
    bow-tie is not a quadrilateral. None for a real (simple) polygon."""
    n = len(q)
    area = abs(sum(q[i - 1][0] * q[i][1] - q[i][0] * q[i - 1][1] for i in range(n))) / 2
    if area < 1e-3 * scale * scale:
        return ("flat", 0, 0)
    for i in range(n):
        if _dist(q[i], q[(i + 1) % n]) < _TOL_APART * scale:
            return ("short", i, 0)
    for i in range(n):
        turn = _angle(q[i - 1], q[i], q[(i + 1) % n])
        if math.isnan(turn) or turn < _TOL_CORNER or turn > 180 - _TOL_CORNER:
            return ("row", i, 0)
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue  # neighbours: they share corner 0
            if _sides_meet(q[i], q[(i + 1) % n], q[j], q[(j + 1) % n], scale):
                return ("cross", i, j)
    return None


def _sides_meet(p1: Point, p2: Point, q1: Point, q2: Point, scale: float) -> bool:
    """Two sides touch or cross (a side's end on the other counts)."""
    tol = 1e-6 * scale * scale
    d1, d2 = _cross(p1, p2, q1), _cross(p1, p2, q2)
    d3, d4 = _cross(q1, q2, p1), _cross(q1, q2, p2)
    if d1 * d2 < -tol and d3 * d4 < -tol:
        return True

    def on(a: Point, b: Point, c: Point) -> bool:
        return abs(_cross(a, b, c)) <= tol and min(a[0], b[0]) - 1e-9 <= c[0] <= max(a[0], b[0]) + 1e-9 \
            and min(a[1], b[1]) - 1e-9 <= c[1] <= max(a[1], b[1]) + 1e-9

    return on(p1, p2, q1) or on(p1, p2, q2) or on(q1, q2, p1) or on(q1, q2, p2)


def _poly_word(poly: tuple[str, ...] | str) -> str:
    return {3: "triangle", 4: "quadrilateral", 5: "pentagon", 6: "hexagon"}.get(len(poly), "polygon")


def _overlaps(d: _Drawing, parts: ProblemParts) -> list[str]:
    polys = [q for q in dict.fromkeys(parts.polygons) if all(n in d.p for n in q)]
    out = []
    for i, q1 in enumerate(polys):
        for q2 in polys[i + 1:]:
            if set(q1) & set(q2):
                continue
            a, b = [d.p[n] for n in q1], [d.p[n] for n in q2]
            if _polygons_overlap(a, b):
                out.append(f"{''.join(q1)} and {''.join(q2)} overlap in the drawing; draw them apart")
    return out


def _polygons_overlap(a: list[Point], b: list[Point]) -> bool:
    """Two simple polygons share area: an edge of one crosses an edge of the
    other, or one lies inside the other."""
    def crosses(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
        d1, d2 = _cross(p1, p2, q1), _cross(p1, p2, q2)
        d3, d4 = _cross(q1, q2, p1), _cross(q1, q2, p2)
        return d1 * d2 < 0 and d3 * d4 < 0

    def inside(pt: Point, poly: list[Point]) -> bool:
        n, hit = len(poly), False
        for i in range(n):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
            if (y1 > pt[1]) != (y2 > pt[1]) and pt[0] < x1 + (pt[1] - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
        return hit

    def edges(poly: list[Point]) -> list[tuple[Point, Point]]:
        return [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]

    if any(crosses(*e, *f) for e in edges(a) for f in edges(b)):
        return True
    return inside(a[0], b) or inside(b[0], a)


def _cross(a: Point, b: Point, q: Point) -> float:
    return (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])


def _radius(d: _Drawing, c: Any) -> float:
    # A circle given by radius is in the same units as the points.
    return float(c.radius) if c.radius is not None else _dist(d.p[c.center], d.p[c.through or c.center])


def _circles(d: _Drawing, center: str) -> list[Any]:
    """The drawn circles a relation can mean: the one centred at `center`,
    or any circle when the problem doesn't name it."""
    return [c for c in d.fig.circles if not center or c.center == center]


def _on_circle(d: _Drawing, c: Any, n: str) -> bool:
    r = _radius(d, c)
    return n in d.p and abs(_dist(d.p[c.center], d.p[n]) - r) <= _TOL_LEN * r


def _shape_holds(shape: str, q: list[Point]) -> bool:
    """Is the cycle of points `q` (in order) a `shape`?"""
    n = len(q)
    sides = [_dist(q[i], q[(i + 1) % n]) for i in range(n)]
    angles = [_angle(q[i - 1], q[i], q[(i + 1) % n]) for i in range(n)]

    def eq(x: float, y: float) -> bool:
        return abs(x - y) <= _TOL_LEN * max(x, y)

    def par(i: int, j: int) -> bool:
        return _dir_diff(_direction(q[i], q[(i + 1) % n]), _direction(q[j], q[(j + 1) % n])) < _TOL_ANG

    if n == 3:
        if shape == "right":
            return any(abs(x - 90) < _TOL_ANG for x in angles)
        if shape == "isosceles":
            return any(eq(sides[i], sides[(i + 1) % 3]) for i in range(3))
        if shape == "equilateral":
            return eq(sides[0], sides[1]) and eq(sides[1], sides[2])
        return False
    right_angles = all(abs(x - 90) < _TOL_ANG for x in angles)
    rhombus = all(eq(sides[0], x) for x in sides[1:])
    return {
        "parallelogram": par(0, 2) and par(1, 3),
        "rectangle": right_angles,
        "rhombus": rhombus,
        "square": rhombus and right_angles,
        "trapezoid": par(0, 2) or par(1, 3),
        "kite": (eq(sides[0], sides[1]) and eq(sides[2], sides[3]))
                 or (eq(sides[1], sides[2]) and eq(sides[3], sides[0])),
    }.get(shape, False)


def _has_shape(d: _Drawing, shape: str) -> bool:
    """Some triangle / quadrilateral drawn (all its sides drawn) is a `shape`:
    for a problem that says "the rectangle below" without naming points."""
    names = list(d.p)
    edge = {
        frozenset((a, b)) for i, a in enumerate(names) for b in names[i + 1:]
        if d.p[a] != d.p[b] and d.seg_drawn(a, b)
    }
    size = 3 if shape in _TRIANGLE_SHAPES else 4
    from itertools import combinations, permutations

    for combo in combinations(names, size):
        first, *rest = combo
        for order in permutations(rest):
            cycle = (first, *order)
            if size == 4 and order[0] > order[-1]:
                continue  # each 4-cycle once
            if all(frozenset((cycle[i], cycle[(i + 1) % size])) in edge for i in range(size)):
                pts = [d.p[n] for n in cycle]
                # A flat, cornerless or crossed cycle is no shape at all,
                # lettered or not.
                if _polygon_flaw(pts, d.scale) is not None:
                    continue
                if _shape_holds(shape, pts):
                    return True
    return False


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
            # Arrows on a segment, or on a named line through its two ends
            # ("AB ∥ CD" drawn as lines AB and CD).
            through = {ln.name: "".join(ln.through) for ln in f.lines if ln.name and len(ln.through) == 2}
            segs = [[through.get(r, r) for r in g if r in through or r not in {ln.name for ln in f.lines}]
                    for g in f.parallel_groups]
            return same_group(segs, args[0], args[1], 2)
        if k == "linepar":
            return any({args[0], args[1]} <= {_line_key(r) for r in g} for g in f.parallel_groups)
        if k == "eqang":
            a1, a2 = (d.resolve(x) for x in args)
            return a1 is not None and a2 is not None and same_group(f.arc_groups, a1, a2, 3)
        if k == "bisang":
            e, (x, v, z) = args
            return same_group(f.arc_groups, (x, v, e), (e, v, z), 3)
        # A right angle is marked by its box, or by a "90°" label on it.
        right = [*f.right_angles,
                 *(r for r, text in f.angle_labels.items() if 90.0 in _parse_label(text, set()).values)]
        if k == "perp":
            (a, b), (c, e) = args
            return any(_box_on_lines(d, _three(r), (p[a], p[b]), (p[c], p[e])) for r in right)
        if k == "lineperp":
            l1, l2 = d.lines[args[0]].through, d.lines[args[1]].through
            return any(
                _box_on_lines(d, _three(r), (p[l1[0]], p[l1[1]]), (p[l2[0]], p[l2[1]])) for r in right
            )
        if k == "measure":
            ang = d.resolve(args[0])
            if ang is None:
                return False
            value = float(args[1])
            if value == 90 and any(_same_angle(d, _three(r), ang, mod=180) for r in f.right_angles):
                return True
            return any(
                value in _parse_label(text, set()).values and _same_angle(d, key, ang)
                for key, text in d.labels.items()
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


def _rel_key(rel: _Relation) -> Any:
    """The same relation however the problem words it ("AD ≅ BC" given, and
    "AD ≅ BC" inside "ABCD is a parallelogram" to prove)."""
    k, args = rel.kind, rel.args

    def ang(a: Any) -> Any:
        return a if isinstance(a, str) else (a[1], frozenset((a[0], a[2])))

    if k in ("par", "perp", "eqlen"):
        return (k, frozenset((frozenset(args[0]), frozenset(args[1]))))
    if k == "eqang":
        return (k, frozenset((ang(args[0]), ang(args[1]))))
    if k == "measure":
        return (k, ang(args[0]), float(args[1]))
    if k in ("mid", "on", "online"):
        return (k, args[0], frozenset(args[1]))
    return (k, repr(args))


# The givens a textbook figure marks: ticks, arcs, boxes and arrows.
_MARKABLE = ("eqlen", "eqang", "perp", "par", "linepar", "lineperp", "mid", "bisang")


def unmarked_givens(fig: ConstructionFigure, problem_text: str, facts: Any = None) -> tuple[list[str], int]:
    """The givens that have a textbook mark (≅ sides by ticks, ≅ angles and
    an angle bisector's halves by arcs, ⊥ and right angles by a box, ∥ by
    arrows, a midpoint's halves by ticks, a stated measure by its label)
    but aren't marked on `fig`; and how many givens have one."""
    return _unmarked(_Drawing(fig), problem_parts(problem_text, facts), problem_text)


def _unmarked(d: _Drawing, parts: ProblemParts, problem_text: str) -> tuple[list[str], int]:
    stated = _numbers(_clean(problem_text))

    def markable(r: _Relation) -> bool:
        if r.kind in ("eqlen", "eqang") and r.args[0] == r.args[1]:
            return False  # "AB ≅ AB" (a shared side) has no mark
        if r.kind in _MARKABLE:
            return True
        if r.kind != "measure" or str(r.args[0]).isdigit():
            return False  # ∠1's figure label is its name "1", not its measure
        # A measure the problem states (a solved one would print the answer;
        # one given as algebra, "m∠1 = 4x + 9", solved to 41°, is labelled by
        # its expression, which a label can't be matched against).
        value = float(r.args[1])
        return value == 90 or (value in stated and r.family != "solved")

    shown = [r for r in parts.givens if markable(r)]
    return [r.text for r in shown if not _marked(r, d)], len(shown)


def givens_marked(fig: ConstructionFigure, problem_text: str, facts: Any = None) -> bool:
    """Every given with a textbook mark is marked on `fig`, and there is at
    least one (so "the givens are marked" is true)."""
    missing, markable = unmarked_givens(fig, problem_text, facts)
    return bool(markable) and not missing


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
            shown = ", ".join(_show_seg(*_two(r)) for r in group)
            out.append(f"the tick marks on {shown} claim equal lengths, but they differ in the drawing")
    for group in f.arc_groups:
        sizes = [d.measure(_three(r)) for r in group]
        if max(sizes) - min(sizes) > _TOL_ANG:
            names = ", ".join(_show_ang(_three(r)) for r in group)
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
                        f"the {kind} on {_show_ang((x, v, y))} sits on an angle whose side {_show_seg(v, arm)} "
                        "isn't drawn"
                    )
    for ref in f.right_angles:
        drawn = d.measure(_three(ref))
        if abs(drawn - 90) > _TOL_ANG:
            out.append(f"the right-angle mark on {_show_ang(_three(ref))} is on an angle drawn as {drawn:.0f}°")
    lines = {ln.name: ln for ln in f.lines if ln.name}
    for group in f.parallel_groups:
        dirs = []
        for ref in group:
            a, b = tuple(lines[ref].through) if ref in lines else _two(ref)
            dirs.append(_direction(p[a], p[b]))
        ends = [tuple(lines[r].through) if r in lines else _two(r) for r in group]
        if any(_dir_diff(dirs[0], x) > _TOL_ANG for x in dirs[1:]) or any(
            d.same_line(e1, e2) for i, e1 in enumerate(ends) for e2 in ends[i + 1:]
        ):
            shown = ", ".join(r if r in lines else _show_seg(*_two(r)) for r in group)
            out.append(f"the parallel arrows on {shown} are on pieces that aren't parallel in the drawing")
    return out


def _extras(d: _Drawing, parts: ProblemParts, base: ConstructionFigure | None) -> list[str]:
    """Drawn pieces nothing in the problem accounts for."""
    p = d.p
    named: list[tuple[str, str, str]] = []
    for kind, pairs in (("seg", parts.segments | parts.mentioned), ("line", parts.point_lines)):
        for s in pairs:
            first, second = sorted(s)
            named.append((kind, first, second))
    named += [("ray", a, b) for a, b in parts.rays]
    for a, v, b in parts.angles:
        named += [("ray", v, a), ("ray", v, b)]
    # The arms of a numbered angle the problem names (∠1, placed by the
    # figure) are accounted for by the angle itself. No other label or mark
    # accounts for anything: a label "y" or an arc on an extra piece would
    # otherwise make it count as named.
    for key, text in d.labels.items():
        if any(n.lstrip("∠") in parts.numbered for n in _parse_label(text, parts.numbered).names):
            x, v, y = key
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

    if not parts.points and not parts.line_names:
        # The problem names nothing ("the right triangle below"): the pieces
        # must make one figure; a piece apart from it is extra.
        loose = _apart(d)
    else:
        loose = [pc for pc in d.pieces if not accounted(pc)]
        # A transversal the problem implies but doesn't name may be any one
        # straight piece crossing two parallel ones; exactly as many as implied.
        allowed = parts.unnamed_transversals
        kept = []
        for pc in loose:
            if allowed > 0 and _crosses_parallels(d, pc):
                allowed -= 1
                continue
            kept.append(pc)
        loose = kept
    out = [
        f"extra {kind if kind != 'seg' else 'segment'} not in the problem: {_show_seg(a, b)}" for kind, a, b in loose
    ]
    return out + _curved_extras(d, parts)


def _curved_extras(d: _Drawing, parts: ProblemParts) -> list[str]:
    """Each circle, arc, sector and shaded region is one the problem has:
    a circle per circle it names (centred where it says), an arc or sector
    only where it speaks of one, centred at its circle's centre with both
    ends on that circle, and shading only on a region it names as shaded."""
    out: list[str] = []
    words = parts.words
    room = {c: parts.circles.count(c) for c in parts.circles}
    kept = []
    for c in d.fig.circles:
        key = "" if is_hidden(c.center) else c.center
        if room.get(key, 0) > 0:
            room[key] -= 1
            kept.append(c)
        else:
            out.append("extra circle not in the problem")

    def on_kept(center: str, ends: list[str]) -> bool:
        if any(c.center == center and all(_on_circle(d, c, n) for n in ends) for c in kept):
            return True
        # A sector of a problem with no circle ("shade sector ABD"): centred
        # at a named point, its ends equally far from it.
        r1, r2 = (_dist(d.p[center], d.p[n]) for n in ends)
        return not parts.circles and not is_hidden(center) and abs(r1 - r2) <= _TOL_LEN * max(r1, r2)

    def show(ends: list[str]) -> str:
        named = [n for n in ends if not is_hidden(n)]
        return f" {''.join(named)}" if len(named) == 2 else ""

    for kind, pieces, word in (("arc", d.fig.arcs, {"arc"}), ("sector", d.fig.sectors, {"sector"})):
        for arc in pieces:
            if not word & words:
                out.append(f"extra {kind} not in the problem")
            elif not on_kept(arc.center, arc.endpoints):
                out.append(
                    f"the {kind}{show(arc.endpoints)} is not drawn on the problem's circle "
                    "(centred at its centre, with both ends on it)",
                )
    for region in d.fig.shaded:
        if region.sector is not None:
            drawn: tuple[Any, ...] = ("sector", region.sector.center, frozenset(region.sector.endpoints),
                                      region.sector.major)
            if drawn in parts.shaded and not on_kept(region.sector.center, region.sector.endpoints):
                out.append(
                    "the shaded sector is not drawn on the problem's circle "
                    "(centred at its centre, with both ends on it)",
                )
                continue
        else:
            drawn = ("polygon", tuple(region.polygon or ()))
        if not any(_same_region(drawn, want) for want in parts.shaded):
            out.append(
                "extra shading not in the problem" if not ({"shade"} & words)
                else "the shading is not on the region the problem says is shaded",
            )
    # And each region the problem says is shaded is drawn shaded.
    shown = [("sector", r.sector.center, frozenset(r.sector.endpoints), r.sector.major) if r.sector is not None
             else ("polygon", tuple(r.polygon or ())) for r in d.fig.shaded]
    for want in parts.shaded:
        if not any(_same_region(x, want) for x in shown):
            if want[0] == "sector":
                a, b = sorted(want[2])
                what = f"{'major ' if want[3] else ''}sector {a}{want[1]}{b}"
            else:
                what = "".join(want[1])
            out.append(f"not drawn: the shading of {what}")
    return out


# "major arc AB", "minor arc AB", "arc ACB" (through C), "major sector AOB";
# a two-letter arc ("arc AB") is the minor one.
_NAMED_ARC = re.compile(
    r"(?:\b(?P<side>major|minor)\s+)?\b(?P<w>arc|sector)s?\s+\{?\s*(?P<n>(?-i:(?:[A-Z][0-9]*'*){2,3}))\s*\}?(?![A-Za-z])",
    re.IGNORECASE,
)


def named_arcs(text: str) -> list[tuple[str, frozenset[str], str]]:
    """(arc | sector, its two ends, what the text says of its side: "major",
    "minor", or a point it passes through) for each arc or sector the
    (cleaned) text names. A sector XYZ is centred at Y."""
    out: list[tuple[str, frozenset[str], str]] = []
    for m in _NAMED_ARC.finditer(text):
        pts = re.findall(r"[A-Z][0-9]*'*", m["n"])
        word, side = m["w"].lower(), (m["side"] or "").lower()
        if word == "sector":
            if len(pts) == 3:
                out.append(("sector", frozenset((pts[0], pts[2])), side or "minor"))
        elif len(pts) == 2:
            out.append(("arc", frozenset(pts), side or "minor"))
        elif not side:
            out.append(("arc", frozenset((pts[0], pts[2])), pts[1]))  # arc ACB passes through C
    return out


def _side_through(p: dict[str, Point], center: str, ends: list[str], through: str) -> bool | None:
    """Whether the arc of `ends` through `through` is the major one (None when
    the point isn't placed)."""
    if through not in p or center not in p or not all(n in p for n in ends):
        return None
    c = p[center]

    def at(n: str) -> float:
        return math.atan2(p[n][1] - c[1], p[n][0] - c[0])

    a1, a2, x = at(ends[0]), at(ends[1]), at(through)
    sweep = (a2 - a1) % (2 * math.pi)
    inside = (x - a1) % (2 * math.pi) < sweep  # on the counter-clockwise run from ends[0]
    return inside == (sweep > math.pi)


def with_arc_sides(raw_spec: dict[str, Any], text: str) -> dict[str, Any]:
    """The figure with each arc, sector and shaded sector drawn on the side
    the problem names ("major arc AB", "arc ACB", "major sector AOB"): code
    chooses it, since the AI's figure format has no side. An arc the problem
    doesn't name keeps the minor side."""
    wants = named_arcs(_clean(text))
    if not wants:
        return raw_spec
    p = {k: tuple(v) for k, v in (raw_spec.get("points") or {}).items()
         if isinstance(v, (list, tuple)) and len(v) == 2}

    def side(arc: Any, word: str) -> Any:
        if not isinstance(arc, dict) or not isinstance(arc.get("endpoints"), list):
            return arc
        ends = frozenset(arc["endpoints"])
        said = [s for w, e, s in wants if e == ends and w == word]
        if not said:
            return arc
        s = said[0]
        major: bool | None = s == "major"
        if s not in ("major", "minor"):
            try:
                major = _side_through(p, arc.get("center"), list(arc["endpoints"]), s)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                major = None
        if major is None or bool(arc.get("major")) == major:
            return arc
        return {**arc, "major": major}

    out = dict(raw_spec)
    out["arcs"] = [side(a, "arc") for a in raw_spec.get("arcs") or []]
    out["sectors"] = [side(a, "sector") for a in raw_spec.get("sectors") or []]
    out["shaded"] = [
        {**r, "sector": side(r["sector"], "sector")} if isinstance(r, dict) and isinstance(r.get("sector"), dict)
        else r for r in raw_spec.get("shaded") or []
    ]
    out = {k: v for k, v in out.items() if v or k in raw_spec}
    return raw_spec if all(out.get(k) == raw_spec.get(k) for k in ("arcs", "sectors", "shaded")) else out


def _arc_side_issues(d: _Drawing, text: str) -> list[str]:
    """Each arc or sector drawn for one the problem names is on the side it
    names: major or minor, or through the point it names."""
    out: list[str] = []
    wants = named_arcs(text)
    pieces = [("arc", a) for a in d.fig.arcs] + [("sector", a) for a in d.fig.sectors] + [
        ("sector", r.sector) for r in d.fig.shaded if r.sector is not None]
    for word, arc in pieces:
        ends = frozenset(arc.endpoints)
        said = [s for w, e, s in wants if e == ends and w == word]
        if not said:
            continue
        ok = []
        for s in said:
            if s in ("major", "minor"):
                ok.append(arc.major == (s == "major"))
            else:
                major = _side_through(d.p, arc.center, list(arc.endpoints), s)
                ok.append(major is not None and major == arc.major)
        if not any(ok):
            a, b = sorted(ends)
            name = f"{a}{arc.center}{b}" if word == "sector" else f"{a}{b}"
            what = {"major": f"major {word} {name}", "minor": f"{word} {name}"}.get(said[0], f"arc {a}{said[0]}{b}")
            out.append(f"the {word} {name} is drawn on the other side of the circle from {what}")
    return out


def _same_region(a: tuple[Any, ...], b: tuple[Any, ...]) -> bool:
    if a[0] != b[0]:
        return False
    if a[0] == "sector":
        return bool(a[1:4] == b[1:4])
    x, y = list(a[1]), list(b[1])
    if len(x) != len(y) or set(x) != set(y):
        return False
    turns = [y[i:] + y[:i] for i in range(len(y))]
    return x in turns or x[::-1] in turns


def _meets(d: _Drawing, p1: tuple[str, str, str], p2: tuple[str, str, str]) -> bool:
    """Pieces p1 and p2 (not parallel) meet: where their lines cross lies
    on both as drawn (a segment between its ends, a ray past its start)."""
    (ax, ay), (bx, by) = d.p[p1[1]], d.p[p1[2]]
    (cx, cy), (ex, ey) = d.p[p2[1]], d.p[p2[2]]
    den = (bx - ax) * (ey - cy) - (by - ay) * (ex - cx)
    if abs(den) < 1e-12:
        return False
    t = ((cx - ax) * (ey - cy) - (cy - ay) * (ex - cx)) / den
    x = (ax + t * (bx - ax), ay + t * (by - ay))
    return d.piece_covers(p1, x, x) and d.piece_covers(p2, x, x)


def _crosses_parallels(d: _Drawing, piece: tuple[str, str, str]) -> bool:
    """`piece` cuts across two other drawn pieces that are parallel: it
    meets both, not merely runs in another direction."""
    own = _direction(d.p[piece[1]], d.p[piece[2]])
    others = [
        (pc, _direction(d.p[pc[1]], d.p[pc[2]])) for pc in d.pieces
        if pc != piece and _meets(d, piece, pc)
    ]
    return any(
        _dir_diff(x, y) < _TOL_ANG and _dir_diff(x, own) > 5
        for i, (_p, x) in enumerate(others) for _q, y in others[i + 1:]
    )


def _apart(d: _Drawing) -> list[tuple[str, str, str]]:
    """Pieces not joined to the largest connected group of pieces (two
    pieces join when they share a point or one ends on the other)."""
    pieces = d.pieces
    if len(pieces) < 2:
        return []
    parent = list(range(len(pieces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def touches(p1: tuple[str, str, str], p2: tuple[str, str, str]) -> bool:
        for a, b in ((p1, p2), (p2, p1)):
            for end in (a[1], a[2]):
                q = d.p[end]
                if any(_dist(q, d.p[e]) < 1e-9 for e in (b[1], b[2])) or d.piece_covers(b, q, q):
                    return True
        # Or they cross.
        a1, a2, b1, b2 = d.p[p1[1]], d.p[p1[2]], d.p[p2[1]], d.p[p2[2]]
        den = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0])
        if abs(den) < 1e-12:
            return False
        ta = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / den
        tb = ((b1[0] - a1[0]) * (a2[1] - a1[1]) - (b1[1] - a1[1]) * (a2[0] - a1[0])) / den

        def within(kind: str, t_: float) -> bool:
            return {"seg": -1e-3 <= t_ <= 1 + 1e-3, "ray": t_ >= -1e-3, "line": True}[kind]

        return within(p1[0], ta) and within(p2[0], tb)

    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            if touches(pieces[i], pieces[j]):
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(pieces)):
        groups.setdefault(find(i), []).append(i)
    biggest = max(groups.values(), key=len)
    return [pieces[i] for i in range(len(pieces)) if i not in biggest]


def _plain_number(text: str) -> float | None:
    """'138°', '138', '12 cm' → the number; None for '2x+5', 'x', '√34'."""
    unit = (r"(?:°|\^\s*\\circ|\^\{\\circ\}|\\circ|deg|degrees|cm|mm|km|m|in|inch(?:es)?|ft|feet|foot|yd"
            r"|units?|meters?)")
    m = re.fullmatch(rf"\s*\$?\s*({_NUM})\s*{unit}?\s*\$?\s*", text)
    return float(m.group(1)) if m else None


@dataclass
class _Label:
    """A label read by its parts: "m∠C = 50°" names ∠C and shows 50;
    "x = 50°" names x; "(2x + 5)°" is algebra; "∠1" (or a bare "1" on a
    problem with numbered angles) is a name."""

    names: list[str]
    values: list[float]
    exprs: list[str]

    @property
    def empty(self) -> bool:
        return not (self.names or self.values or self.exprs)


_LABEL_ANGLE = rf"∠\s*(?:{_PT}){{1,3}}|∠\s*\d+"
_LABEL_SEG = rf"(?:{_PT}){{2}}"
_LABEL_VAR = r"[a-z](?:_\{?\d+\}?)?"


def _parse_label(text: str, numbered: Collection[str] = ()) -> _Label:
    t = _clean(text).replace("$", " ")
    t = re.sub(r"\\angle\s*", "∠", t)
    t = re.sub(r"\\overline\s*\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"[{}]", "", t).strip().rstrip(".").strip()
    out = _Label([], [], [])
    sides = [x.strip() for x in t.split("=")]
    for i, part in enumerate(sides):
        if not part:
            continue
        last = i == len(sides) - 1
        compact = re.sub(r"\s+", "", part)
        if len(sides) == 1 and re.fullmatch(r"\d+", compact) and compact in numbered:
            out.names.append(compact)  # a bare "1" names ∠1
        elif (value := _plain_number(part)) is not None:
            out.values.append(value)
        elif re.fullmatch(rf"(?:{_LABEL_ANGLE}|{_LABEL_SEG})", compact) or (
            not last and re.fullmatch(_LABEL_VAR, compact)
        ):
            out.names.append(compact)
        else:
            out.exprs.append(part)
    return out


def _same_algebra(a: str, b: str) -> bool:
    """Two spellings of one expression: "(2x + 5)°" and "2x+5"."""
    def norm(e: str) -> str:
        e = re.sub(r"\^\s*\\circ|\\circ|[°()\s*{}$]", "", _clean(e)).replace("−", "-")
        return e.lower()

    la, lb = linear_expr(a), linear_expr(b)
    if la is not None and lb is not None:
        return la == lb
    return norm(a) == norm(b)


def _show_seg(a: str, b: str) -> str:
    """A segment's name for a teacher: helper points are never named."""
    named = [n for n in (a, b) if not is_hidden(n)]
    if len(named) == 2:
        return f"{a}{b}"
    return f"from {named[0]} to an unnamed point" if named else "between two unnamed points"


def _show_ang(key: tuple[str, str, str]) -> str:
    if not any(is_hidden(n) for n in key):
        return "∠" + "".join(key)
    return f"an angle at {key[1]}" if not is_hidden(key[1]) else "an angle at an unnamed point"


def _is_target_angle(d: _Drawing, parts: ProblemParts, key: tuple[str, str, str]) -> bool:
    for target in parts.target_angles:
        ang = d.resolve(target)
        if ang is not None and all(n in d.p for n in ang) and _same_angle(d, ang, key):
            return True
    return False


def _given_measures(d: _Drawing, parts: ProblemParts, key: tuple[str, str, str]) -> set[float]:
    """The measures the problem itself gives for the angle at `key` (not
    ones solved from its numbers): stated measures, and 90° for an angle
    between two lines it says are perpendicular."""
    out: set[float] = set()

    def walk(rel: _Relation) -> None:
        if rel.kind == "any":
            for alt in rel.args[0]:
                for r in alt:
                    walk(r)
        elif rel.kind == "measure" and rel.family != "solved":
            ang = d.resolve(rel.args[0])
            if ang is not None and all(n in d.p for n in ang) and _same_angle(d, ang, key):
                out.add(float(rel.args[1]))
        elif rel.kind in ("perp", "lineperp"):
            if rel.kind == "perp":
                l1, l2 = rel.args
            elif rel.args[0] in d.lines and rel.args[1] in d.lines:
                l1, l2 = (tuple(d.lines[n].through) for n in rel.args)
            else:
                return
            if not all(n in d.p for n in (*l1, *l2)):
                return
            x, v, y = key
            on = [
                {arm for arm in (x, y) if d.collinear(d.p[ln[0]], d.p[ln[1]], d.p[arm])}
                for ln in (l1, l2) if d.collinear(d.p[ln[0]], d.p[ln[1]], d.p[v])
            ]
            if len(on) == 2 and ((x in on[0] and y in on[1]) or (y in on[0] and x in on[1])):
                out.add(90.0)

    for rel in parts.givens:
        walk(rel)
    return out


def _problem_angles(parts: ProblemParts) -> list[tuple[str, str, str] | str]:
    """Every angle the problem names: a label may name only these."""
    out: list[Any] = [*parts.angles, *parts.target_angles]
    where = {"eqang": (0, 1), "measure": (0,), "vertical": (0, 1), "anglepair": (1, 2), "anglesum": (0, 1),
             "numbered": (0, 1)}

    def walk(rel: _Relation) -> None:
        if rel.kind == "any":
            for alt in rel.args[0]:
                for r in alt:
                    walk(r)
        elif rel.kind in where:
            out.extend(rel.args[i] for i in where[rel.kind])
        elif rel.kind == "bisang":
            out.append(rel.args[1])
        elif rel.kind == "algebra":
            out.extend(term[0] for term in rel.args[0])

    for rel in (*parts.givens, *parts.prove):
        walk(rel)
    return out


def _given_lengths(parts: ProblemParts, side: frozenset[str]) -> set[float]:
    out = {float(r.args[1]) for r in parts.givens if r.kind == "length" and frozenset(r.args[0]) == side}
    # A length the problem gives for a side it doesn't name ("a width of 7").
    return out | {float(r.args[0]) for r in parts.givens if r.kind == "lengthlabel"}


def _label_issues(
    d: _Drawing, parts: ProblemParts, final_answer: str | None, problem_text: str, step_text: str | None,
) -> list[str]:
    """Every label read by its parts and checked: a number against the
    drawing, against what the problem asks for (a question's figure must
    not print the answer), and against the problem, which must give THAT
    value for THAT part; a name must be the part's own (∠1 where the
    problem has ∠1, x on the angle it calls x); algebra must be the
    problem's own for that part. A step figure may also show what its
    step says. `final_answer` is None for a step figure."""
    out: list[str] = []
    answer_numbers = _numbers(_clean(final_answer or ""))
    step_numbers = _numbers(_clean(step_text)) if step_text is not None else set()
    # The problem's math, where its letters are names ("$b$"), not words ("a").
    in_math = " ".join(re.findall(r"\$([^$]*)\$", problem_text))

    def number_issue(label: str, where: str, value: float, given: set[float]) -> str | None:
        if any(abs(value - g) <= 1e-6 * max(1.0, abs(g)) for g in given) or value in step_numbers:
            return None
        if value in answer_numbers:
            return f"the label {label!r} on {where} gives away the answer"
        return f"the label {label!r} on {where} shows {value:g}, which the problem doesn't give for {where}"

    def exprs_for(match: Any) -> list[str]:
        return [e for part, e in parts.expressions if match(part)]

    variables = {lin[2] for _p, e in parts.expressions if (lin := linear_expr(e))}

    def letter_ok(name: str, own: list[str]) -> bool:
        """A letter is this part's own algebra ("x" where m∠A = x°), or a
        name the problem gives a part it doesn't name by points ("the
        missing leg b"): written in the problem, and no variable tied to
        another part."""
        if any(_same_algebra(name, e) for e in own):
            return True
        return bool(re.fullmatch(_LABEL_VAR, name)) and name not in variables and re.search(
            rf"(?<![A-Za-z\\]){re.escape(name)}(?![A-Za-z])", in_math,
        ) is not None

    named_angles = _problem_angles(parts)
    for key, text in d.labels.items():
        where = _show_ang(key)
        lab = _parse_label(text, parts.numbered)
        if lab.empty:
            out.append(f"the label {text!r} on {where} is empty")
            continue

        def this_angle(ref: Any, key: tuple[str, str, str] = key) -> bool:
            ang = d.resolve(ref) if isinstance(ref, str) or (isinstance(ref, tuple) and len(ref) == 3) else None
            return ang is not None and all(n in d.p for n in ang) and _same_angle(d, ang, key)

        own = exprs_for(this_angle)
        for name in lab.names:
            number = re.fullmatch(r"∠?\s*(\d+)", name)
            if number:
                if number.group(1) not in parts.numbered:
                    out.append(
                        f"the label {text!r} on {where} names ∠{number.group(1)}, which the problem doesn't have",
                    )
            elif name.startswith("∠"):
                if not this_angle(_angle_ref(r"\angle " + name[1:])):
                    out.append(f"the label {text!r} on {where} names {name}, a different angle")
                elif not any(this_angle(a) for a in named_angles):
                    out.append(f"the label {text!r} on {where} names {name}, an angle the problem doesn't name")
            elif not letter_ok(name, own):
                out.append(f"the label {text!r} on {where} names {name}, which the problem doesn't call that angle")
        for e in lab.exprs:
            if not letter_ok(re.sub(r"\s+", "", e), own):
                out.append(f"the label {text!r} on {where} shows {e}, which the problem doesn't give for {where}")
        drawn = d.measure(key)
        for value in lab.values:
            if final_answer is not None and _is_target_angle(d, parts, key):
                out.append(f"the label {text!r} on {where} gives away the answer (the problem asks for it)")
                continue
            if not math.isnan(drawn) and abs(drawn - value) > _TOL_LABEL_ANG:
                out.append(f"the label {text!r} on {where} does not match the drawing (drawn as {drawn:.0f}°)")
            issue = number_issue(text, where, value, _given_measures(d, parts, key))
            if issue:
                out.append(issue)
    lengths: list[tuple[str, float, float]] = []
    for side, text in sorted(d.fig.side_labels.items()):
        a, b = _two(side)
        where = _show_seg(a, b)
        lab = _parse_label(text)
        if lab.empty:
            out.append(f"the label {text!r} on {where} is empty")
            continue
        pair = frozenset((a, b))
        own = exprs_for(lambda part, pair=pair: isinstance(part, tuple) and len(part) == 2 and frozenset(part) == pair)
        given = _given_lengths(parts, frozenset((a, b)))
        for name in lab.names:
            if re.fullmatch(_LABEL_SEG, name):
                if frozenset(split_points(name, 2)) != frozenset((a, b)):
                    out.append(f"the label {text!r} on {where} names {name}, a different segment")
                elif pair not in parts.segments | parts.mentioned | parts.target_segments:
                    out.append(f"the label {text!r} on {where} names {name}, a segment the problem doesn't name")
            elif not letter_ok(name, own):
                out.append(f"the label {text!r} on {where} names {name}, which the problem doesn't call that side")
        for e in lab.exprs:
            if not letter_ok(re.sub(r"\s+", "", e), own):
                out.append(f"the label {text!r} on {where} shows {e}, which the problem doesn't give for {where}")
        for value in lab.values:
            if value > 0:
                lengths.append((where, value, _dist(d.p[a], d.p[b])))
            if final_answer is not None and frozenset((a, b)) in parts.target_segments:
                out.append(f"the label {text!r} on {where} gives away the answer (the problem asks for it)")
                continue
            issue = number_issue(text, where, value, given)
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
    for name, q in sorted(base.p.items()):
        if name in step.p and _dist(q, step.p[name]) > _TOL_MOVE * span:
            out.append(f"point {name} is not where the question's figure puts it")
    for kind, a, b in base.pieces:
        if a not in step.p or b not in step.p:
            out.append(f"the step's figure leaves out {_show_seg(a, b)}, which the question's figure draws")
            continue
        kept = {"seg": step.seg_drawn, "ray": step.ray_drawn, "line": step.line_through}[kind](a, b)
        if not kept:
            name = _show_seg(a, b) if kind == "seg" else f"{kind} {_show_seg(a, b)}"
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


def problem_parts(problem_text: str, facts: Any = None, *, extra: str = "") -> ProblemParts:
    """What the figure must show: from the agreed reading when there is one."""
    if facts is not None:
        from api.core.geometry.facts import to_parts

        return to_parts(facts, problem_text, extra)  # type: ignore[no-any-return]
    return parse_problem(problem_text, extra=extra)


def unbacked_marks(fig: ConstructionFigure, problem_text: str, facts: Any = None) -> dict[str, list[int]]:
    """Mark groups on a question's figure that no given backs: ticks, arcs
    or arrows tying together parts the problem never says are equal or
    parallel (a derived fact such as alternate interior angles would hand
    the student a step), and one-member groups, which pair a part with
    nothing. Returns {field: [group indexes]}. Removing a mark never makes a
    figure false, so callers drop these rather than reject the figure."""
    parts = problem_parts(problem_text, facts)
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
    # A named line through two points is backed by a given about either the
    # line (ℓ ∥ m) or the segment between them ("AB ∥ CD" drawn as lines).
    through = {ln.name: seg_key(ln.through) for ln in fig.lines if ln.name and len(ln.through) == 2}
    for i, group in enumerate(fig.parallel_groups):
        pkeys = [_line_key(r) if r in line_names else seg_key(_two(r)) for r in group]
        tkeys = [through.get(r, k) for r, k in zip(group, pkeys)]
        if len(pkeys) < 2 or not (pars.same(pkeys) or pars.same(tkeys)):
            out.setdefault("parallel_groups", []).append(i)
    for i, ref in enumerate(fig.right_angles):
        if not _box_backed(d, _three(ref), parts.givens):
            out.setdefault("right_angles", []).append(i)
    # A mark showing the statement to prove hands the student the answer,
    # even where the givens' numbers back it (∠ADE = ∠ABC = 48° once x is
    # solved): it goes too.
    given_keys = {_rel_key(r) for r in parts.givens}
    prove = [r for r in parts.prove if _rel_key(r) not in given_keys]
    fields = ("tick_groups", "arc_groups", "parallel_groups", "right_angles")
    for name in fields if prove else ():
        for i, item in enumerate(getattr(fig, name)):
            if i in out.get(name, []):
                continue
            alone = _Drawing(fig.model_copy(update={f: ([item] if f == name else []) for f in fields}))
            if any(_marked(rel, alone) for rel in prove):
                out.setdefault(name, []).append(i)
    for name in out:
        out[name].sort()
    return out


def _angle_pair(d: _Drawing, kind: str, a1: tuple[str, str, str] | None,
                a2: tuple[str, str, str] | None) -> bool | None:
    """Where two angles sit around a transversal: the line through their
    vertices. Each must have one arm along it; an arm pointing toward the
    other vertex makes the angle interior, away makes it exterior; the other
    arm says which side of the transversal it is on."""
    if a1 is None or a2 is None:
        return None
    p = d.p
    v1, v2 = p[a1[1]], p[a2[1]]
    if _dist(v1, v2) < 1e-9 * max(d.scale, 1e-9):
        return False
    t = (v2[0] - v1[0], v2[1] - v1[1])

    def place(a: tuple[str, str, str], v: Point, other: Point) -> tuple[bool, int] | None:
        ends = [p[a[0]], p[a[2]]]
        along = [e for e in ends if d.collinear(v, other, e)]
        if len(along) != 1:
            return None
        arm = ends[1 - ends.index(along[0])]
        toward = (along[0][0] - v[0]) * (other[0] - v[0]) + (along[0][1] - v[1]) * (other[1] - v[1]) > 0
        side = t[0] * (arm[1] - v[1]) - t[1] * (arm[0] - v[0])
        return toward, (1 if side > 0 else -1)

    first, second = place(a1, v1, v2), place(a2, v2, v1)
    if first is None or second is None:
        return False
    (in1, side1), (in2, side2) = first, second
    if kind == "alternate_interior":
        return in1 and in2 and side1 != side2
    if kind == "alternate_exterior":
        return not in1 and not in2 and side1 != side2
    if kind == "same_side_interior":
        return in1 and in2 and side1 == side2
    if kind == "corresponding":
        return in1 != in2 and side1 == side2
    return None


def _box_backed(d: _Drawing, box: tuple[str, str, str], givens: list[_Relation]) -> bool:
    """A right-angle box some given states: a ⊥, a 90° angle, a right angle,
    a rectangle's corner, or "the right triangle" with no names."""
    p = d.p
    for rel in givens:
        k, args = rel.kind, rel.args
        try:
            if k == "perp":
                (a, b), (c, e) = args
                if _box_on_lines(d, box, (p[a], p[b]), (p[c], p[e])):
                    return True
            elif k == "lineperp":
                l1, l2 = d.lines[args[0]].through, d.lines[args[1]].through
                if _box_on_lines(d, box, (p[l1[0]], p[l1[1]]), (p[l2[0]], p[l2[1]])):
                    return True
            elif k == "measure" and float(args[1]) == 90:
                ang = d.resolve(args[0])
                if ang is not None and _same_angle(d, ang, box, mod=180):
                    return True
            elif k == "any":
                if _box_backed(d, box, [r for alt in args[0] for r in alt]):
                    return True
            elif k == "anyshape" and args[0] in ("right", "rectangle", "square"):
                return True
        except (KeyError, ValueError, TypeError, ZeroDivisionError):
            continue
    return False
