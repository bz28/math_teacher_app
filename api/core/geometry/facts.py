"""The facts a geometry problem states, read by AI and checked by code.

A figure is checked against a list of facts, not against regexes over the
problem's wording. The list comes from two independent AI readings of the
problem (different prompts, same model), and code then decides whether the
reading can be trusted:

  1. agreement — the two readings must say the same thing once written one
     way (AB = BA, ∠ABC = ∠CBA, a triangle correspondence kept, a chain
     ≅ ≅ ≅ the same as its pairs);
  2. coverage — every point the text names, and every word or symbol that
     states a relation (∥ ⊥ ≅ midpoint tangent rectangle ...), is accounted
     for by some fact about the names near it;
  3. verifiable — every fact has a numeric check on the drawing.

Any failure means no figure, with the reason. A reading that passes is the
figure's contract: the checker measures the drawing against each fact.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

FactKind = Literal[
    "parallel", "perpendicular", "congruent_segments", "congruent_angles", "equal_length",
    "angle_measure", "midpoint", "on_segment", "on_line", "collinear", "intersect",
    "bisects_segment", "bisects_angle", "right_angle", "opposite_rays",
    "vertical_angles", "linear_pair", "supplementary", "complementary",
    "congruent_triangles", "similar_triangles", "isosceles", "equilateral", "right_triangle",
    "parallelogram", "rectangle", "square", "rhombus", "trapezoid", "isosceles_trapezoid", "kite",
    "on_circle", "tangent", "chord", "diameter", "radius", "central_angle", "inscribed_angle",
    "numbered_angle", "transversal", "other",
]
SHAPES = ("parallelogram", "rectangle", "square", "rhombus", "trapezoid", "isosceles_trapezoid", "kite")


class Fact(BaseModel):
    kind: FactKind
    # Names, as the problem writes them: points "A", "B'"; segments, rays
    # and two-point lines "AB" (a ray from its first letter); named lines
    # "m", "ell1"; angles "ABC" (vertex in the middle), "B" or "1";
    # triangles "ABC"; polygons "ABCD" in order.
    items: list[str] = Field(default_factory=list)
    point: str | None = None  # the midpoint, the point on, the apex, the meeting point
    value: float | None = None  # a number the problem states (degrees or length)
    expr: str | None = None  # a measure given as algebra: "2x + 5"
    circle: str | None = None  # the circle's center ("" when unnamed)
    quote: str = ""  # the words of the problem the fact comes from


class Target(BaseModel):
    kind: Literal["angle", "segment", "other"]
    item: str = ""


class Part(BaseModel):
    kind: Literal["point", "segment", "ray", "line", "angle", "circle", "triangle", "polygon"]
    item: str

    @field_validator("kind", mode="before")
    @classmethod
    def _shape_is_a_polygon(cls, v: Any) -> Any:
        """'rectangle', 'square', … asked for is the polygon of that name."""
        if isinstance(v, str) and v.lower() in (*SHAPES, "quadrilateral", "pentagon", "hexagon"):
            return "polygon"
        return v


class FigureFacts(BaseModel):
    points: list[str] = Field(default_factory=list)
    segments: list[str] = Field(default_factory=list)
    rays: list[str] = Field(default_factory=list)
    lines: list[str] = Field(default_factory=list)  # two-point lines "AB"
    named_lines: list[str] = Field(default_factory=list)
    triangles: list[str] = Field(default_factory=list)
    polygons: list[str] = Field(default_factory=list)
    circles: list[str] = Field(default_factory=list)  # centers; "" for an unnamed circle
    givens: list[Fact] = Field(default_factory=list)
    prove: list[Fact] = Field(default_factory=list)
    find: list[Target] = Field(default_factory=list)
    requested: list[Part] = Field(default_factory=list)


# ── Names ──────────────────────────────────────────────────────────────

def as_facts(x: Any) -> FigureFacts | None:
    """A reading as stored (a dict) or in hand; None when there is none or
    it doesn't parse (a stored reading that no longer parses checks
    nothing, so the figure fails closed)."""
    if x is None or isinstance(x, FigureFacts):
        return x
    try:
        return FigureFacts.model_validate(x)
    except ValueError:
        return None


_PT = r"[A-Z][0-9]*'*"


def split_names(s: str) -> list[str]:
    """'AB' → ['A', 'B']; "A'B'" → ["A'", "B'"]; 'B1C' → ['B1', 'C']."""
    s = re.sub(r"\s+", "", s.replace("′", "'").replace("’", "'"))
    return re.findall(_PT, s) if re.fullmatch(f"(?:{_PT})+", s) else []


def line_key(raw: str) -> str:
    """One spelling per named line: '\\ell_1', 'ℓ1', 'l_1' → 'ell1'; 'm' → 'm'."""
    n = re.sub(r"[\\{}_\s$]", "", raw).replace("ℓ", "ell")
    if re.fullmatch(r"l\d+", n):
        n = "ell" + n[1:]
    return n


def _is_line_name(s: str) -> bool:
    return bool(re.fullmatch(r"[a-z]|ell\d*|l\d+", line_key(s)))


Canon = Any


def seg(s: str) -> Canon:
    n = split_names(s)
    return ("seg", frozenset(n)) if len(n) == 2 else ("bad", s)


def lin(s: str) -> Canon:
    """A straight thing: a named line, or the two points it passes through."""
    if _is_line_name(s):
        return ("line", line_key(s))
    return seg(s)


def ang(s: str, facts: FigureFacts | None = None) -> Canon:
    """∠ABC → (B, {A, C}); ∠B → the named triangle's / polygon's angle at B
    when B is a corner of exactly one; ∠1 → the angle it labels when the
    reading says which."""
    s = re.sub(r"^\s*m\s*(?=∠|\\angle)", "", s)  # m∠C, the measure of ∠C, is ∠C
    s = s.strip().lstrip("∠").replace("\\angle", "").strip("{} ")
    if re.fullmatch(r"\d+", s):
        if facts is not None:
            for f in facts.givens:
                if f.kind == "numbered_angle" and len(f.items) == 2 and f.items[0] == s:
                    return ang(f.items[1], facts)
        return ("num", s)
    n = split_names(s)
    if len(n) == 3:
        return ("ang", n[1], frozenset((n[0], n[2])))
    if len(n) == 1:
        if facts is not None:
            corners = {
                frozenset((poly[i - 1], poly[(i + 1) % len(poly)]))
                for poly in (split_names(p) for p in (*facts.triangles, *facts.polygons))
                for i, v in enumerate(poly) if v == n[0]
            }
            if len(corners) == 1:
                return ("ang", n[0], next(iter(corners)))
        return ("ang", n[0], frozenset())
    return ("bad", s)


def cycle(s: str) -> Canon:
    """A polygon up to where it starts and which way it runs."""
    n = split_names(s)
    if not n:
        return ("bad", s)
    rots = [tuple(n[i:] + n[:i]) for i in range(len(n))]
    rev = [tuple(reversed(r)) for r in rots]
    return ("poly", min(rots + rev))


def correspondence(t1: str, t2: str) -> Canon:
    """△ABC ≅ △DEF: the vertex pairs A↔D, B↔E, C↔F, however written."""
    a, b = split_names(t1), split_names(t2)
    if len(a) != len(b) or not a:
        return ("bad", t1 + t2)
    return frozenset(frozenset(p) for p in zip(a, b))


def _num(v: float | None) -> float | None:
    return None if v is None else round(float(v), 2)


def _expr(e: str | None) -> str | None:
    if not e:
        return None
    e = e.replace("−", "-").replace("°", "").replace("degrees", "")
    return re.sub(r"[\s()]", "", e) or None


# ── Atomic facts: one canonical form per thing said ────────────────────


def atoms(facts: FigureFacts) -> dict[str, set[Canon]]:
    """Each section of the reading as a set of canonical atoms."""

    def of(fs: Iterable[Fact]) -> set[Canon]:
        out: set[Canon] = set()
        for f in fs:
            out |= _fact_atoms(f, facts)
        return _closure(out)

    return {
        "points": {p.strip() for p in facts.points if split_names(p)},
        "givens": _implied_away(of(g for g in facts.givens if not _names_a_figure(g, facts))),
        "prove": _implied_away(of(f for f in facts.prove if not _names_a_figure(f, facts))),
        # What is asked for matters to the checker only as a named angle or
        # segment (its label must not print the answer); "other" checks nothing.
        "find": {a for a in (_target_atom(t, facts) for t in facts.find) if a[0] != "other" and a[1][0] != "bad"},
        # A part asked for that the problem already names asks for nothing
        # more ("can you provide the drawing?" read as every side).
        "requested": {_part_atom(p) for p in facts.requested} - _named_parts(facts),
    }


def _named_parts(facts: FigureFacts) -> set[Canon]:
    out = {("segment", seg(x)) for x in facts.segments} | {("line", lin(x)) for x in facts.lines}
    out |= {("point", p.strip()) for p in facts.points}
    for poly in (*facts.triangles, *facts.polygons):
        n = split_names(poly)
        out |= {("segment", ("seg", frozenset((n[i], n[(i + 1) % len(n)])))) for i in range(len(n))}
        out.add(("polygon", cycle(poly)))
    return out


def _names_a_figure(f: Fact, facts: FigureFacts) -> bool:
    """An "other" fact that only names a listed triangle or polygon ("In
    △ABC"): naming isn't stating, so it is no fact."""
    if f.kind != "other" or not f.items:
        return False
    named = {cycle(x) for x in (*facts.triangles, *facts.polygons)}
    if any(cycle(x) not in named for x in f.items):
        return False
    rest = re.sub(r"\\triangle|△|\b(?:in|given|triangle|quadrilateral|polygon)\b", " ", f.quote, flags=re.I)
    for x in f.items:
        rest = rest.replace(x, " ")
    return not re.sub(r"[\s$:,.{}]", "", rest)


def _implied_away(atoms_: set[Canon]) -> set[Canon]:
    """'△ABC is isosceles' says no more than two of its sides from one corner
    being congruent: drop it when the reading also says that."""
    eq = {a[1] for a in atoms_ if isinstance(a, tuple) and a[0] == "eqlen"}

    def implied(a: Canon) -> bool:
        if not (isinstance(a, tuple) and a[0] == "isosceles" and a[1][0] == "poly"):
            return False
        t = a[1][1]
        sides = [frozenset((t[i], t[(i + 1) % 3])) for i in range(3)]
        return any(
            frozenset((("seg", s1), ("seg", s2))) in eq
            for i, s1 in enumerate(sides) for s2 in sides[i + 1:]
        )

    return {a for a in atoms_ if not implied(a)}


def merged(a: FigureFacts, b: FigureFacts) -> FigureFacts:
    """Two readings that agree, as one: the first, plus every given or
    statement to prove the second writes another way ("X is on AB" for "EF
    meets AB at X"). A fact more is a check more, never one fewer."""
    def key(f: Fact) -> tuple[Any, ...]:
        return (f.kind, tuple(f.items), f.point, f.value, f.expr, f.circle)

    def union(x: list[Fact], y: list[Fact]) -> list[Fact]:
        have = {key(f) for f in x}
        return [*x, *(f for f in y if key(f) not in have and not _names_a_figure(f, b))]

    return a.model_copy(update={
        "givens": [f for f in union(a.givens, b.givens) if not _names_a_figure(f, a)],
        "prove": [f for f in union(a.prove, b.prove) if not _names_a_figure(f, a)],
    })


def _closure(atoms_: set[Canon]) -> set[Canon]:
    """'≅' and '∥' are equivalences: a chain and its pairs say the same."""
    out = {a for a in atoms_ if not (isinstance(a, tuple) and a[0] in ("eqlen", "eqang", "par"))}
    for kind in ("eqlen", "eqang", "par"):
        parent: dict[Canon, Canon] = {}

        def find(x: Canon) -> Canon:
            parent.setdefault(x, x)
            while parent[x] != x:
                x = parent[x]
            return x

        for a in atoms_:
            if isinstance(a, tuple) and a[0] == kind:
                x, y = tuple(a[1]) if len(a[1]) == 2 else (next(iter(a[1])),) * 2
                parent[find(x)] = find(y)
        groups: dict[Canon, set[Canon]] = {}
        for x in list(parent):
            groups.setdefault(find(x), set()).add(x)
        for members in groups.values():
            ms = sorted(members, key=repr)
            out |= {(kind, frozenset((x, y))) for i, x in enumerate(ms) for y in ms[i + 1:]}
    return out


def _fact_atoms(f: Fact, facts: FigureFacts) -> set[Canon]:
    k, it = f.kind, f.items

    def A(s: str) -> Canon:  # noqa: N802 - an angle
        return ang(s, facts)

    def measure(a: Canon) -> Canon:
        return ("measure", a, _num(f.value), _expr(f.expr))

    if k in ("parallel", "perpendicular") and len(it) >= 2:
        if k == "perpendicular":
            p1, p2 = split_names(it[0]), split_names(it[1])
            shared = set(p1) & set(p2) if len(p1) == len(p2) == 2 else set()
            if len(shared) == 1:  # AB ⊥ BC: the right angle at B
                v = next(iter(shared))
                return {("measure", ("ang", v, frozenset((set(p1) | set(p2)) - {v})), 90.0, None)}
            return {("perp", frozenset((lin(it[0]), lin(it[1]))))}
        return {("par", frozenset((lin(x), lin(y)))) for x, y in zip(it, it[1:])}
    if k == "congruent_segments":
        return {("eqlen", frozenset((seg(x), seg(y)))) for x, y in zip(it, it[1:])}
    if k == "congruent_angles":
        return {("eqang", frozenset((A(x), A(y)))) for x, y in zip(it, it[1:])}
    if k == "equal_length" and it:
        return {("length", seg(it[0]), _num(f.value), _expr(f.expr))}
    if k in ("angle_measure", "central_angle", "inscribed_angle") and it:
        extra = {(k, A(it[0]), f.circle or "")} if k != "angle_measure" else set()
        return ({measure(A(it[0]))} if f.value is not None or f.expr else set()) | extra
    if k == "right_angle" and it:
        return {("measure", A(it[0]), 90.0, None)}
    if k == "midpoint" and it and f.point:
        return {("mid", f.point, seg(it[0]))}
    if k in ("on_segment", "on_line") and it and f.point:
        # On segment AB, on line AB, or where AB meets another line: one
        # incidence (the merged reading keeps both wordings' checks).
        return {("on", f.point, lin(it[0]))}
    if k == "collinear":
        return {("collinear", frozenset(it))}
    if k == "intersect" and f.point and len(it) >= 2:
        return {("on", f.point, lin(x)) for x in it}
    if k == "bisects_segment" and len(it) >= 2:
        out: set[Canon] = {("linemid", lin(it[0]), seg(it[1]))}
        if f.point:
            out |= {("mid", f.point, seg(it[1])), ("on", f.point, lin(it[0]))}
        return out
    if k == "bisects_angle" and len(it) >= 2:
        return {("bisang", seg(it[0]), A(it[1]))}
    if k == "opposite_rays" and len(it) >= 2:
        return {("opp", frozenset((seg(it[0]), seg(it[1]))))}
    if k in ("vertical_angles", "linear_pair", "supplementary", "complementary") and len(it) >= 2:
        return {(k, frozenset((A(it[0]), A(it[1]))))}
    if k in ("congruent_triangles", "similar_triangles") and len(it) >= 2:
        return {(k, correspondence(it[0], it[1]))}
    if k == "isosceles" and it:
        t = split_names(it[0])
        if f.point and f.point in t:
            o1, o2 = (v for v in t if v != f.point)
            return {("eqlen", frozenset((seg(f.point + o1), seg(f.point + o2))))}
        return {("isosceles", cycle(it[0]))}
    if k == "equilateral" and it:
        t = split_names(it[0])
        if len(t) == 3:
            return {("eqlen", frozenset((seg(t[0] + t[1]), seg(t[1] + t[2])))),
                    ("eqlen", frozenset((seg(t[1] + t[2]), seg(t[2] + t[0]))))}
    if k == "right_triangle":
        if f.point and it:
            return {("measure", A(f.point), 90.0, None)}
        return {("right_triangle", cycle(it[0]) if it else None)}
    if k in SHAPES:
        return {(k, cycle(it[0]) if it else None)}
    if k == "on_circle":
        return {("on_circle", p, f.circle or "") for p in it}
    if k in ("tangent", "chord", "diameter", "radius") and it:
        return {(k, lin(it[0]) if k == "tangent" else seg(it[0]), f.circle or "", f.point or "")}
    if k == "numbered_angle" and len(it) >= 2:
        return {("numbered", it[0], ang(it[1]))}
    if k == "transversal" and it:
        return {("transversal", lin(it[0]) if it[0] else None, frozenset(lin(x) for x in it[1:]))}
    return {("other", k, tuple(it), f.quote.strip().lower())}


def _target_atom(t: Target, facts: FigureFacts) -> Canon:
    if t.kind == "angle":
        return ("angle", ang(t.item, facts))
    if t.kind == "segment":
        return ("segment", seg(t.item))
    return ("other",)


def _part_atom(p: Part) -> Canon:
    if p.kind == "segment":
        return ("segment", seg(p.item))
    if p.kind == "angle":
        return ("angle", ang(p.item))
    if p.kind == "line":
        return ("line", lin(p.item))
    if p.kind in ("triangle", "polygon"):
        # "the rectangle" asked for by description, not by name: unnamed.
        return ("polygon", cycle(p.item) if split_names(p.item) else None)
    return (p.kind, p.item.strip())


def _say(a: Canon) -> str:
    """An atom in words, for the reason a teacher sees."""
    def name(x: Any) -> str:
        if isinstance(x, frozenset):
            return "/".join(sorted(name(y) for y in x))
        if isinstance(x, tuple):
            if x and x[0] == "seg":
                return "".join(sorted(x[1]))
            if x and x[0] == "ang":
                return "∠" + (x[1] if not x[2] else f"{sorted(x[2])[0]}{x[1]}{sorted(x[2])[1]}")
            if x and x[0] in ("line", "num", "poly"):
                return str(x[1] if x[0] != "poly" else "".join(x[1]))
            return " ".join(name(y) for y in x if y not in (None, ""))
        return str(x)

    return name(a)


def disagreements(a: FigureFacts, b: FigureFacts) -> list[str]:
    """Where the two readings differ, in words; empty when they agree."""
    x, y = atoms(a), atoms(b)
    out = []
    for section in ("points", "givens", "prove", "find", "requested"):
        only_a, only_b = x[section] - y[section], y[section] - x[section]
        for atom in sorted(only_a | only_b, key=repr)[:3]:
            out.append(f"{section}: {_say(atom)}")
    return out


# ── Coverage: the reading accounts for everything the text states ─────

# Each word or symbol that states a relation, and the fact kinds that can
# account for it.
_SIGNALS: list[tuple[str, tuple[str, ...]]] = [
    (r"\\parallel|∥|\bparallel\b", ("parallel", "parallelogram", "rectangle", "square", "rhombus", "trapezoid",
                                     "isosceles_trapezoid", "transversal")),
    (r"\\perp|⊥|\bperpendicular\b", ("perpendicular", "right_angle", "angle_measure", "bisects_segment")),
    (r"\\cong|≅|\bcongruent\b", ("congruent_segments", "congruent_angles", "congruent_triangles", "isosceles",
                                 "equilateral", "kite", "rhombus", "square", "midpoint")),
    (r"\\sim\b|∼|\bsimilar\b", ("similar_triangles",)),
    (r"\bmidpoints?\b", ("midpoint", "bisects_segment")),
    (r"\bbisect(?:s|ed|ing|or|ors)?\b", ("bisects_segment", "bisects_angle", "midpoint")),
    (r"\btangents?\b", ("tangent",)),
    (r"\bright\s+(?:angles?|triangles?)\b", ("right_angle", "right_triangle", "angle_measure", "perpendicular",
                                              "rectangle", "square")),
    (r"\bequilateral\b", ("equilateral",)),
    (r"\bisosceles\b", ("isosceles", "isosceles_trapezoid")),
    (r"\bparallelograms?\b", ("parallelogram", "rectangle", "square", "rhombus")),
    (r"\brectangles?\b", ("rectangle", "square")),
    (r"\bsquares?\b(?!\s*(?:units?|roots?|feet|foot|inch(?:es)?|cm|mm|m|meters?|ft|in|yards?)\b)", ("square",)),
    (r"\brhomb(?:us|i|uses)\b", ("rhombus", "square")),
    (r"\btrapezoids?\b|\btrapezia\b", ("trapezoid", "isosceles_trapezoid")),
    (r"\bkites?\b", ("kite",)),
    (r"\bdiameters?\b", ("diameter",)),
    (r"\bradi(?:us|i)\b", ("radius", "on_circle", "central_angle")),
    (r"\bchords?\b", ("chord",)),
    (r"\binscribed\b", ("on_circle", "inscribed_angle")),
    (r"\bcircles?\b|\\odot|⊙", ("on_circle", "tangent", "chord", "diameter", "radius", "central_angle",
                                "inscribed_angle")),
    (r"\bopposite\s+rays\b", ("opposite_rays",)),
    (r"\bvertical\s+angles\b", ("vertical_angles",)),
    (r"\blinear\s+pair\b", ("linear_pair",)),
    (r"\bsupplementary\b", ("supplementary", "linear_pair")),
    (r"\bcomplementary\b", ("complementary",)),
    (r"\btransversals?\b", ("transversal",)),
    (r"\b(?:lie|lies)\s+on\b|\bis\s+on\b|\bare\s+on\b", ("on_segment", "on_line", "on_circle", "collinear",
                                                         "midpoint", "intersect")),
    (r"\bcollinear\b", ("collinear", "on_line", "on_segment")),
    (r"\b(?:intersect(?:s|ing)?|meets?)\b", ("intersect", "on_segment", "on_line", "transversal")),
    (r"\balternate\s+(?:interior|exterior)\b|\bcorresponding\s+angles\b|\b(?:same[-\s]side|consecutive)\s+interior\b",
     ("congruent_angles", "supplementary", "transversal")),
    (r"\baltitudes?\b|\bmedians?\b|\bequidistant\b|\bconcentric\b|\bcircumscribed\b", ()),
]
# A method, not a fact: "use the Alternate Interior Angles Theorem", "by SAS".
_METHOD = re.compile(
    r"\b(?:use|using)\b[^.;:?\n]*|\bby\s+(?:the\s+)?(?:definition|theorem|postulate|property|converse|"
    r"SAS|ASA|AAS|SSS|HL|CPCTC|AA|SSA)\b[^.;:?\n]*|\b(?:theorem|postulate)\b",
    re.IGNORECASE,
)
_NOT_NAMES = {"I", "SAS", "ASA", "AAS", "SSS", "HL", "CPCTC", "AA", "SSA", "CPCF"}


def _names(s: str) -> set[str]:
    out: set[str] = set()
    for m in re.finditer(rf"(?<![A-Za-z\\])((?:{_PT})+)(?![a-z])", s):
        run = m.group(1)
        if run in _NOT_NAMES or (run == "A" and re.match(r"A\s+[a-z]", s[m.start():])):
            continue
        out |= set(split_names(run))
    return out


def _fact_names(f: Fact) -> set[str]:
    out = set(split_names(f.point or "")) | ({f.circle} if f.circle else set())
    for x in f.items:
        out |= set(split_names(x)) | ({line_key(x)} if _is_line_name(x) else set())
    return out


def coverage_gaps(text: str, facts: FigureFacts) -> list[str]:
    """What the text states that the reading doesn't account for: a point
    name with no place in it, or a relation word / symbol with no fact of
    its kind about the names near it."""
    from api.core.geometry.figure_check import _clean, parse_problem

    t = _clean(text)
    gaps = [f"point {n}" for n in sorted(parse_problem(text).points - set(facts.points))]
    every = [*facts.givens, *facts.prove]
    methods = [m.span() for m in _METHOD.finditer(t)]
    for pattern, kinds in _SIGNALS:
        for m in re.finditer(pattern, t, re.IGNORECASE):
            if any(a <= m.start() < b for a, b in methods):
                continue
            lo = max((t.rfind(ch, 0, m.start()) for ch in ".;:?!\n"), default=-1) + 1
            his = [i for i in (t.find(ch, m.end()) for ch in ".;:?!\n") if i != -1]
            clause = t[lo:min(his) if his else len(t)]
            near = _names(re.sub(r"\\[A-Za-z]+", " ", clause)) | {
                line_key(x) for x in re.findall(r"(?<![A-Za-z\\])(?:[a-z]|\\ell\s*_?\{?\d*\}?)(?![A-Za-z])", clause)
                if not re.fullmatch(r"[a-z]", x) or re.search(rf"\b[Ll]ines?\s+{x}\b|\b{x}\s*(?:\\parallel|∥)", clause)
            }
            ok = [f for f in every if f.kind in kinds and (not near or _fact_names(f) & near or not _fact_names(f))]
            if kinds and "circle" in pattern and facts.circles:
                ok = ok or [None]  # type: ignore[list-item]
            if not ok:
                word = m.group(0).strip()
                gaps.append(f"“{word}”" + (f" (about {', '.join(sorted(near))})" if near else ""))
    return list(dict.fromkeys(gaps))


# ── Verifiers: each fact as relations the drawing is measured against ─

def unverifiable(facts: FigureFacts) -> list[str]:
    """Facts with no numeric check on the drawing."""
    out = []
    for f in [*facts.givens, *facts.prove]:
        try:
            rels = to_relations(f, facts)
        except (ValueError, IndexError):
            rels = None
        if not rels:
            out.append(f.quote.strip() or f.kind.replace("_", " "))
    return out


def _a(s: str) -> str:
    return f"∠{s}"


def _num_txt(v: float | None) -> str:
    return "" if v is None else f"{v:g}"


def describe(f: Fact) -> str:
    """The fact in the problem's notation, written by code (never the AI's
    quote), for the checker's messages: "AB ≅ CD", "M is the midpoint of AB"."""
    k, it, p = f.kind, f.items, f.point or ""
    first = it[0] if it else ""
    rest = " and ".join(it[1:])
    on = f"the circle {f.circle}" if f.circle else "the circle"
    measure = f"{_num_txt(f.value)}°" if f.value is not None else (f.expr or "")
    size = f" (m{_a(first)} = {measure})" if measure else ""
    joined = {
        "parallel": " ∥ ", "perpendicular": " ⊥ ", "congruent_segments": " ≅ ",
    }
    if k in joined:
        return joined[k].join(it)
    said: dict[str, str] = {
        "congruent_angles": " ≅ ".join(_a(x) for x in it),
        "equal_length": f"{first} = {_num_txt(f.value)}" if first else f"a side of length {_num_txt(f.value)}",
        "angle_measure": f"m{_a(first)} = {measure}",
        "right_angle": f"{_a(first)} is a right angle",
        "midpoint": f"{p} is the midpoint of {first}",
        "on_segment": f"{p} is on {first}",
        "on_line": f"{p} is on line {first}",
        "collinear": f"{', '.join(it)} are collinear",
        "intersect": f"{' and '.join(it)} meet at {p}",
        "bisects_segment": f"{first} bisects {rest}",
        "bisects_angle": f"{first} bisects {_a(rest)}",
        "opposite_rays": f"{' and '.join(it)} are opposite rays",
        "vertical_angles": f"{' and '.join(_a(x) for x in it)} are vertical angles",
        "linear_pair": f"{' and '.join(_a(x) for x in it)} form a linear pair",
        "supplementary": f"{' and '.join(_a(x) for x in it)} are supplementary",
        "complementary": f"{' and '.join(_a(x) for x in it)} are complementary",
        "congruent_triangles": " ≅ ".join(f"△{x}" for x in it),
        "similar_triangles": " ∼ ".join(f"△{x}" for x in it),
        "isosceles": f"△{first} is isosceles",
        "equilateral": f"△{first} is equilateral",
        "right_triangle": f"△{first} is a right triangle" if first else "the triangle is a right triangle",
        "on_circle": f"{', '.join(it)} {'lie' if len(it) > 1 else 'lies'} on {on}",
        "tangent": f"{first} is tangent to {on}" + (f" at {p}" if p else ""),
        "chord": f"{first} is a chord of {on}",
        "diameter": f"{first} is a diameter of {on}",
        "radius": f"{first} is a radius of {on}",
        "central_angle": f"{_a(first)} is a central angle of {on}{size}",
        "inscribed_angle": f"{_a(first)} is inscribed in {on}{size}",
        "numbered_angle": f"{_a(first)} is {_a(rest)}",
        "transversal": f"{first or 'a transversal'} crosses {rest}",
    }
    if k in said:
        return said[k]
    if k in SHAPES:
        name = k.replace("_", " ")
        return f"{first} is {'an' if k[0] in 'aeiou' else 'a'} {name}" if first else f"a {name}"
    return f"{k.replace('_', ' ')} {' '.join(it)}".strip()


def to_relations(f: Fact, facts: FigureFacts) -> list[Any]:
    """The checker's relations for one fact; [] when it has no verifier."""
    from api.core.geometry.figure_check import _quad_relations, _Relation

    k, it = f.kind, f.items
    text = describe(f)

    def R(kind: str, *args: Any, what: str = text) -> _Relation:  # noqa: N802
        return _Relation(kind, args, what)

    def pair(s: str) -> tuple[str, str]:
        n = split_names(s)
        if len(n) != 2:
            raise ValueError(s)
        return (n[0], n[1])

    def angle(s: str) -> tuple[str, str, str] | str:
        c = ang(s, facts)
        if c[0] == "num":
            return c[1]  # type: ignore[no-any-return]
        if c[0] != "ang":
            raise ValueError(s)
        if not c[2]:
            return ("", c[1], "")
        x, y = sorted(c[2])
        return (x, c[1], y)

    def tri(s: str) -> tuple[str, ...]:
        n = split_names(s)
        if len(n) != 3:
            raise ValueError(s)
        return tuple(n)

    def line_pair(a: str, b: str, kind: str) -> _Relation:
        if _is_line_name(a) and _is_line_name(b):
            return R("line" + kind, line_key(a), line_key(b))
        return R(kind, pair(a), pair(b))

    def value_rel(a: tuple[str, str, str] | str) -> list[_Relation]:
        return [R("measure", a, float(f.value))] if f.value is not None else []

    if k in ("parallel", "perpendicular") and len(it) >= 2:
        kind = "par" if k == "parallel" else "perp"
        out = [line_pair(x, y, kind) for x, y in zip(it, it[1:])]
        if k == "perpendicular" and f.point:
            out += [R("online", f.point, pair(x)) for x in it[:2] if not _is_line_name(x)]
        return out
    if k == "congruent_segments" and len(it) >= 2:
        return [R("eqlen", pair(x), pair(y)) for x, y in zip(it, it[1:])]
    if k == "congruent_angles" and len(it) >= 2:
        return [R("eqang", angle(x), angle(y)) for x, y in zip(it, it[1:])]
    if k == "equal_length" and it:
        pair(it[0])
        return [R("length", pair(it[0]), float(f.value or 0))]
    if k == "equal_length" and f.value is not None:
        # A side the problem doesn't name ("a width of 7 inches"): the
        # figure shows it by a side labelled with that length.
        return [R("lengthlabel", float(f.value))]
    if k == "angle_measure" and it:
        a = angle(it[0])
        if f.value is None and not f.expr:
            return []
        return value_rel(a) or [R("expr", a, f.expr)]
    if k == "right_angle" and it:
        return [R("measure", angle(it[0]), 90.0)]
    if k == "midpoint" and it and f.point:
        return [R("mid", f.point, pair(it[0]))]
    if k == "on_segment" and it and f.point:
        return [R("on", f.point, pair(it[0]))]
    if k == "on_line" and it and f.point:
        return [R("online", f.point, pair(it[0]))]
    if k == "collinear" and len(it) >= 3:
        return [R("online", q, (it[0], it[1])) for q in it[2:]]
    if k == "intersect" and f.point and len(it) >= 2:
        return [R("online", f.point, pair(x)) for x in it]
    if k == "bisects_segment" and len(it) >= 2:
        out = [R("linemid", pair(it[0]), pair(it[1]))]
        if f.point:
            out += [R("mid", f.point, pair(it[1])), R("online", f.point, pair(it[0]))]
        return out
    if k == "bisects_angle" and len(it) >= 2:
        a = angle(it[1])
        r = pair(it[0])
        if not isinstance(a, tuple) or not a[0] or a[1] not in r:
            raise ValueError(it[1])
        return [R("bisang", r[1] if r[0] == a[1] else r[0], a)]
    if k == "opposite_rays" and len(it) >= 2:
        (a, b), (c, e) = pair(it[0]), pair(it[1])
        if a != c:
            raise ValueError(it)
        return [R("opp", a, b, e)]
    if k == "vertical_angles" and len(it) >= 2:
        return [R("vertical", angle(it[0]), angle(it[1]))]
    if k in ("linear_pair", "supplementary", "complementary") and len(it) >= 2:
        total = 90.0 if k == "complementary" else 180.0
        return [R("anglesum", angle(it[0]), angle(it[1]), total, k == "linear_pair")]
    if k == "congruent_triangles" and len(it) >= 2:
        return [R("congtri", tri(it[0]), tri(it[1]))]
    if k == "similar_triangles" and len(it) >= 2:
        t1, t2 = tri(it[0]), tri(it[1])
        return [
            R("eqang", (t1[i - 1], t1[i], t1[(i + 1) % 3]), (t2[i - 1], t2[i], t2[(i + 1) % 3]),
              what=f"{text} (∠{t1[i]} ≅ ∠{t2[i]})")
            for i in range(3)
        ]
    if k == "isosceles" and it:
        a, b, c = tri(it[0])
        if f.point in (a, b, c):
            o1, o2 = (v for v in (a, b, c) if v != f.point)
            return [R("eqlen", (f.point, o1), (f.point, o2))]
        sides = ((a, b), (b, c), (c, a))
        alts = tuple((R("eqlen", s1, s2),) for s1, s2 in zip(sides, sides[1:] + sides[:1]))
        return [R("any", alts)]
    if k == "equilateral" and it:
        a, b, c = tri(it[0])
        return [R("eqlen", (a, b), (b, c)), R("eqlen", (b, c), (c, a))]
    if k == "right_triangle":
        if f.point and it:
            a, b, c = tri(it[0])
            if f.point not in (a, b, c):
                raise ValueError(f.point)
            o1, o2 = sorted(v for v in (a, b, c) if v != f.point)
            return [R("measure", (o1, f.point, o2), 90.0)]
        if f.point:
            return [R("measure", angle(f.point), 90.0)]
        if it:
            a, b, c = tri(it[0])
            alts = tuple((R("measure", (x, v, y), 90.0),) for x, v, y in ((c, a, b), (a, b, c), (b, c, a)))
            return [R("any", alts)]
        return [R("anyshape", "right")]
    if k in SHAPES:
        if not it:
            return [R("anyshape", k.replace("isosceles_", ""))] if k != "isosceles_trapezoid" else []
        q = tuple(split_names(it[0]))
        if len(q) != 4:
            raise ValueError(it[0])
        rels = _quad_relations(k.replace("isosceles_", ""), q, k == "isosceles_trapezoid")
        return [R(r.kind, *r.args, what=r.text) for r in rels]
    if k == "on_circle" and it:
        return [R("oncircle", tuple(it), f.circle or "")]
    if k == "tangent" and it:
        return [R("tangent", pair(it[0]), f.circle or "", f.point or "")]
    if k == "chord" and it:
        return [R("oncircle", pair(it[0]), f.circle or "")]
    if k == "diameter" and it:
        return [R("diam", pair(it[0]), f.circle or "")]
    if k == "radius" and it:
        return [R("radius", pair(it[0]))]
    if k in ("central_angle", "inscribed_angle") and it:
        a = angle(it[0])
        if not isinstance(a, tuple) or not a[0]:
            raise ValueError(it[0])
        out = value_rel(a) or ([R("expr", a, f.expr)] if f.expr else [])
        if k == "central_angle":
            return [*out, R("center", a[1], f.circle or "")]
        return [*out, R("oncircle", (a[0], a[1], a[2]), f.circle or "")]
    if k == "numbered_angle" and len(it) >= 2:
        return [R("numbered", it[0], angle(it[1]))]
    if k == "transversal" and len(it) >= 3:
        return [R("crosses", it[0], it[1], it[2])] if it[0] else [R("crosses", "", it[1], it[2])]
    return []


def requested_segments(facts: FigureFacts) -> set[frozenset[str]]:
    return {frozenset(split_names(p.item)) for p in facts.requested if p.kind == "segment"
            and len(split_names(p.item)) == 2}


# ── The tool the readers answer with ───────────────────────────────────

_ITEMS = {"type": "array", "items": {"type": "string"}}
FACTS_TOOL: dict[str, Any] = {
    "name": "geometry_facts",
    "description": "Every fact the geometry problem states, as a list.",
    "input_schema": {
        "type": "object",
        "properties": {
            "points": _ITEMS, "segments": _ITEMS, "rays": _ITEMS, "lines": _ITEMS, "named_lines": _ITEMS,
            "triangles": _ITEMS, "polygons": _ITEMS, "circles": _ITEMS,
            **{
                section: {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": list(FactKind.__args__)},  # type: ignore[attr-defined]
                            "items": _ITEMS,
                            "point": {"type": ["string", "null"]},
                            "value": {"type": ["number", "null"]},
                            "expr": {"type": ["string", "null"]},
                            "circle": {"type": ["string", "null"]},
                            "quote": {"type": "string"},
                        },
                        "required": ["kind", "items", "quote"],
                    },
                }
                for section in ("givens", "prove")
            },
            "find": {"type": "array", "items": {
                "type": "object",
                "properties": {"kind": {"type": "string", "enum": ["angle", "segment", "other"]},
                               "item": {"type": "string"}},
                "required": ["kind", "item"],
            }},
            "requested": {"type": "array", "items": {
                "type": "object",
                "properties": {"kind": {"type": "string",
                                        "enum": ["point", "segment", "ray", "line", "angle", "circle",
                                                 "triangle", "polygon"]},
                               "item": {"type": "string"}},
                "required": ["kind", "item"],
            }},
        },
        "required": ["points", "givens", "prove", "find", "requested"],
    },
}


# ── The reading as what the figure must show ───────────────────────────


def to_parts(facts: FigureFacts, text: str, extra: str = "") -> Any:
    """The checker's ProblemParts from an agreed reading: the parts to draw,
    the givens and the statement to prove as relations (measures given as
    algebra solved where the facts fix them), and what the problem asks for.
    `extra` (a step's text) adds parts to draw, never givens."""
    from api.core.geometry.figure_check import (
        _FIGURE_WORDS,
        ProblemParts,
        _bare_request_parts,
        _clean,
        _collect_parts,
        _numbers,
        _rel_points,
        solved_expressions,
    )

    out = ProblemParts()
    t = _clean(text)
    out.numbers = _numbers(t)
    out.words = {w for w in _FIGURE_WORDS if w in t.lower()}

    def two(s: str) -> tuple[str, str] | None:
        n = split_names(s)
        return (n[0], n[1]) if len(n) == 2 else None

    out.points |= {p.strip() for p in facts.points if split_names(p)}
    for s in [*facts.segments, *(p.item for p in facts.requested if p.kind == "segment")]:
        if pr := two(s):
            out.segments.add(frozenset(pr))
    for s in [*facts.rays, *(p.item for p in facts.requested if p.kind == "ray")]:
        if pr := two(s):
            out.rays.add(pr)
    for s in [*facts.lines, *(p.item for p in facts.requested if p.kind == "line")]:
        if _is_line_name(s):
            out.line_names.add(line_key(s))
        elif pr := two(s):
            out.point_lines.add(frozenset(pr))
    out.line_names |= {line_key(n) for n in facts.named_lines}
    asked = [p.item for p in facts.requested if p.kind in ("triangle", "polygon")]
    for poly in (*facts.triangles, *facts.polygons, *asked):
        v = split_names(poly)
        if len(v) >= 3:
            out.polygons.append(tuple(v))
            out.segments |= {frozenset((v[i], v[(i + 1) % len(v)])) for i in range(len(v))}
    out.points |= {p.item.strip() for p in facts.requested if p.kind == "point" and split_names(p.item)}

    def rels(fs: list[Fact]) -> list[Any]:
        return [r for f in fs for r in to_relations(f, facts)]

    out.givens, out.prove = rels(facts.givens), rels(facts.prove)
    out.givens += solved_expressions(out.givens + out.prove)
    out.givens = [r for r in out.givens if r.kind != "expr"]
    out.prove = [r for r in out.prove if r.kind != "expr"]
    for f in [*facts.givens, *facts.prove]:
        if f.kind == "numbered_angle" and f.items:
            out.numbered.add(f.items[0])
        if f.kind == "transversal":
            out.transversal = True
            if not (f.items and f.items[0]):
                out.unnamed_transversals += 1
            elif pr := two(f.items[0]):
                out.segments.add(frozenset(pr))
            elif _is_line_name(f.items[0]):
                out.line_names.add(line_key(f.items[0]))
        for x in f.items:
            if _is_line_name(x) and f.kind in ("parallel", "perpendicular", "transversal"):
                out.line_names.add(line_key(x))
    for rel in (*out.givens, *out.prove):
        out.points |= {n for n in _rel_points(rel) if split_names(n)}
        if rel.kind in ("length", "eqlen", "par", "perp", "tangent", "radius", "diam"):
            out.mentioned |= {frozenset(a) for a in rel.args if isinstance(a, tuple) and len(a) == 2}
        if rel.kind == "bisang":
            out.mentioned.add(frozenset((rel.args[1][1], rel.args[0])))
    angle_items = {
        "congruent_angles": slice(None), "angle_measure": slice(0, 1), "right_angle": slice(0, 1),
        "vertical_angles": slice(None), "linear_pair": slice(None), "supplementary": slice(None),
        "complementary": slice(None), "bisects_angle": slice(1, 2), "numbered_angle": slice(1, 2),
        "central_angle": slice(0, 1), "inscribed_angle": slice(0, 1),
    }
    for f in [*facts.givens, *facts.prove]:
        for x in f.items[angle_items[f.kind]] if f.kind in angle_items else []:
            n = split_names(x)
            if len(n) == 3:
                out.angles.add((n[0], n[1], n[2]))
            elif re.fullmatch(r"\d+", x.strip().lstrip("∠")):
                out.numbered.add(x.strip().lstrip("∠"))  # ∠1 must carry its label
    for tg in facts.find:
        if tg.kind == "angle":
            c = ang(tg.item, facts)
            if c[0] == "ang" and len(c[2]) == 2:
                out.angles.add((sorted(c[2])[0], c[1], sorted(c[2])[1]))  # its arms may be drawn
            if c[0] == "ang":
                xs = sorted(c[2])
                out.target_angles.append((xs[0], c[1], xs[1]) if xs else ("", c[1], ""))
            elif c[0] == "num":
                out.target_angles.append(c[1])
        elif tg.kind == "segment" and (pr := two(tg.item)):
            out.target_segments.add(frozenset(pr))
    if extra.strip():
        _collect_parts(_clean(extra), out)
        _bare_request_parts(_clean(extra), out)
    return out
