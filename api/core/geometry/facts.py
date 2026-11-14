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
    "numbered_angle", "transversal",
    "alternate_interior", "alternate_exterior", "corresponding", "same_side_interior",
    "interior_ray", "extension",
    "obtuse_angle", "acute_angle", "obtuse_triangle", "acute_triangle", "scalene",
    "other",
]
# Kinds code writes from a reading's own words (see standard_reading); the
# readers' tool doesn't offer them.
CODE_KINDS = ("interior_ray", "extension", "obtuse_angle", "acute_angle", "obtuse_triangle", "acute_triangle",
              "scalene")
# Two angles a transversal makes with two lines, by where they sit.
PAIRS = ("alternate_interior", "alternate_exterior", "corresponding", "same_side_interior")
CIRCLE_KINDS = ("on_circle", "tangent", "chord", "diameter", "radius", "central_angle", "inscribed_angle")
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
    # Written by code, never by a reading: each fact taken out of a reading
    # and why, so the stored facts show what was set aside.
    dropped: list[str] = Field(default_factory=list)


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
                if f.kind == "numbered_angle" and len(f.items) == 2 and f.items[0] == s and _labels_an_angle(f):
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
    from api.core.geometry.figure_check import linear_expr

    try:
        parsed = linear_expr(e)
    except (ValueError, ZeroDivisionError):
        parsed = None
    if parsed is not None:
        # One form per value: "2.5x", "5x/2" and "2\frac{1}{2}x" are one expression.
        a, b, var = parsed
        return f"{round(a, 6):g}{var}{round(b, 6):+g}"
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
        "givens": _implied_away(of(g for g in facts.givens if not _states_nothing(g, facts))),
        "prove": _implied_away(of(f for f in facts.prove if not _states_nothing(f, facts))),
        # What is asked for matters to the checker only as a named angle or
        # segment (its label must not print the answer); "other" checks nothing.
        "find": {a for a in (_target_atom(t, facts) for t in facts.find) if a[0] != "other" and a[1][0] != "bad"},
        # A part asked for that the problem already names asks for nothing
        # more ("can you provide the drawing?" read as every side).
        # A part asked for by no name ("the transversal", "the first
        # rectangle") is a part the checker can't require, so it says nothing.
        "requested": {a for a in (_part_atom(p) for p in facts.requested) if _has_name(a)} - _named_parts(facts),
    }


def _has_name(part: Canon) -> bool:
    name = part[1] if isinstance(part, tuple) and len(part) > 1 else None
    return name is not None and not (isinstance(name, tuple) and name[:1] == ("bad",))


def _named_parts(facts: FigureFacts) -> set[Canon]:
    out = {("segment", seg(x)) for x in facts.segments} | {("line", lin(x)) for x in facts.lines}
    # A ray the problem names, or an arm of an angle it names (∠ABC: BA, BC).
    out |= {("ray", r.strip()) for r in facts.rays}
    for f in [*facts.givens, *facts.prove]:
        for x in f.items:
            n = split_names(x)
            if len(n) == 3:
                out |= {("ray", n[1] + n[0]), ("ray", n[1] + n[2])}
    out |= {("line", lin(x)) for x in facts.named_lines}
    out |= {("point", p.strip()) for p in facts.points}
    for poly in (*facts.triangles, *facts.polygons):
        n = split_names(poly)
        out |= {("segment", ("seg", frozenset((n[i], n[(i + 1) % len(n)])))) for i in range(len(n))}
        out.add(("polygon", cycle(poly)))
    return out


def _labels_an_angle(f: Fact) -> bool:
    """A numbered_angle fact that says which named angle carries the label
    ("∠1 is ∠ABC"), not just that there is an ∠1 ("1" → "", "1" → "1")."""
    return len(f.items) == 2 and len(split_names(f.items[1])) in (1, 3)


def _states_nothing(f: Fact, facts: FigureFacts) -> bool:
    """A fact that states nothing about the figure: an "other" fact that
    only names a listed triangle or polygon ("In △ABC"), since naming isn't
    stating; or "∠1 is an angle" with no angle named for it."""
    if f.kind == "numbered_angle":
        return not _labels_an_angle(f)
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
    being congruent, and 'M is on BC' no more than 'M is the midpoint of BC':
    drop each when the reading also says the stronger fact."""
    eq = {a[1] for a in atoms_ if isinstance(a, tuple) and a[0] == "eqlen"}
    mids = {(a[1], a[2]) for a in atoms_ if isinstance(a, tuple) and a[0] == "mid"}

    def implied(a: Canon) -> bool:
        if isinstance(a, tuple) and a[0] == "on":
            return (a[1], a[2]) in mids
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
        return [*x, *(f for f in y if key(f) not in have and not _states_nothing(f, b))]

    return a.model_copy(update={
        "dropped": [*a.dropped, *(x for x in b.dropped if x not in a.dropped)],
        "givens": [f for f in union(a.givens, b.givens) if not _states_nothing(f, a)],
        "prove": [f for f in union(a.prove, b.prove) if not _states_nothing(f, a)],
    })


def with_step(question: FigureFacts, step: FigureFacts) -> FigureFacts:
    """The facts a step figure is checked against: the question's, plus what
    the step states (its givens, and what it shows, which holds from then
    on). The question's own statement to prove and its targets stay."""
    def union(x: list[Any], y: list[Any]) -> list[Any]:
        return [*x, *(i for i in y if i not in x)]

    names = ("points", "segments", "rays", "lines", "named_lines", "triangles", "polygons", "circles")
    return question.model_copy(update={
        **{k: union(getattr(question, k), getattr(step, k)) for k in names},
        "givens": union(question.givens, [*step.givens, *step.prove]),
        "requested": union(question.requested, step.requested),
        "dropped": union(question.dropped, [f"step: {x}" for x in step.dropped]),
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
    if k == "equal_length" and len(it) >= 2:
        # "DA = DC": the sides are equal (and each has the value, if one is given).
        out_: set[Any] = {("eqlen", frozenset((seg(x), seg(y)))) for x, y in zip(it, it[1:])}
        if f.value is not None or f.expr:
            out_ |= {("length", seg(x), _num(f.value), _expr(f.expr)) for x in it}
        return out_
    if k == "equal_length" and it:
        return {("length", seg(it[0]), _num(f.value), _expr(f.expr))}
    if k == "interior_ray" and len(it) >= 2:
        return {("interior", seg(it[0]), A(it[1]))}
    if k == "extension" and it:
        return {("extension", tuple(split_names(it[0])), f.point or "")}
    if k in ("obtuse_angle", "acute_angle") and it:
        return {(k, A(it[0]))}
    if k in ("obtuse_triangle", "acute_triangle", "scalene") and it:
        return {(k, cycle(it[0]))}
    if k in ("angle_measure", "central_angle", "inscribed_angle") and it:
        extra = {(k, A(it[0]), f.circle or "")} if k != "angle_measure" else set()
        n = split_names(it[0])
        if k == "central_angle" and f.circle and len(n) == 3 and n[1] == f.circle.strip():
            # ∠AOB in circle O: a circle is named by its centre, so the angle
            # at O is central by its names alone; the measure is the fact.
            extra = set()
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
        out = {(k, lin(it[0]) if k == "tangent" else seg(it[0]), f.circle or "", f.point or "")}
        if k in ("radius", "diameter") and (f.value is not None or f.expr):
            # "radius OA = 3" states OA = 3, as "OA = 3" does.
            out.add(("length", seg(it[0]), _num(f.value), _expr(f.expr)))
        return out
    if k == "numbered_angle" and len(it) >= 2:
        return {("numbered", it[0], ang(it[1]))}
    if k in PAIRS:
        return {(k, frozenset((A(it[0]), A(it[1]))) if len(it) >= 2 else None)}
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

# (The accounting itself is in api/core/geometry/coverage.py.)
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
    """What the text says that the reading doesn't account for: an
    allowlist over the text's tokens (api/core/geometry/coverage.py)."""
    from api.core.geometry.coverage import coverage_gaps as gaps

    return gaps(text, facts)


# A clause that asks or instructs ("Find m∠C", "Write a two-column proof")
# states nothing about the figure (proving is a statement, so not here).
# Not "which" (a relative "which" clause states something: "∠B, which is a
# right angle"), nor "draw", "label", "sketch", "construct": what a drawing
# instruction names ("Draw AD ⊥ BC") is part of the figure and needs its fact.
_QUESTION = re.compile(
    r"\b(?:find|what|how|determine|calculate|compute|solve|identify|name|write|give|express|list|"
    r"classify|round|leave|simplify|complete|fill|graph|plot|set\s+up|evaluate)\b",
    re.IGNORECASE,
)
_CLAUSE_END = re.compile(r"[.;?!\n]|,|\b(?:and|if|where|when|so\s+that|such\s+that|given\s+that|then)\b",
                         re.IGNORECASE)
# Words that only name or point at the figure.
_NAMING = re.compile(
    r"\b(?:in|the|a|an|given|let|consider|below|above|shown|figure|diagram|triangles?|quadrilaterals?|polygons?|"
    r"points?|segments?|lines?|rays?|angles?|sides?|vertices|vertex|with|of|for|has|have|is|are|be|this|that|as|and|"
    r"prove|show|statements?|reasons?|all|share[sd]?|sharing|endpoints?|common)\b|\\triangle|\\angle|\\overline|\\overrightarrow|\\overleftrightarrow"
    r"|[\s,.:;$(){}|*\-]",
    re.IGNORECASE,
)


# "(1)", "(a)", "1." at the start of a list item, "Step 2": not numbers given.
_LIST_MARK = r"\(\s*(?:\d+|[a-z]|[ivx]+)\s*\)|(?:(?<=\n)|^)\s*\d+[.)]\s|\bstep\s+\d+\b|\|\s*\d+\s*\|"


def parse_problem_points(t: str) -> set[str]:
    from api.core.geometry.figure_check import parse_problem

    return parse_problem(t).points


# A dot that ends nothing: a decimal point ("2.5"). (An abbreviation's dot,
# "e.g.", does end a clause: what follows it is still covered as a clause.)
_NOT_A_STOP = re.compile(r"(?<=\d)\.(?=\d)")
# Only names: "AB", "∠1", "A, B" — what a list joins before its statement.
_ONLY_NAMES = re.compile(
    r"^(?:\s|\$|[{},]|\\angle\s*\{?\s*\d+\s*\}?|∠\s*\d+|(?<![A-Za-z])(?:[A-Z][0-9]*'*)+(?![a-z]))*$")


_ONLY_A_NUMBER = re.compile(
    r"^\s*(?:the\s+)?-?\d+(?:\.\d+)?\s*(?:°|degrees?|units?|cm|mm|m|in(?:ches)?|ft|feet|foot|yards?|meters?|"
    r"inches|miles?|km)?\s*(?:long|wide|tall|respectively)?\s*$", re.IGNORECASE)


def _lists_names(piece: str) -> bool:
    """A piece that only lists names, with naming words ("Points A", "∠1",
    "segments AB"): the "and" or comma after it goes on with the list."""
    if not re.search(r"(?<![A-Za-z])[A-Z]|\\angle\s*\{?\s*\d|∠\s*\d", piece):
        return False
    if re.match(r"\s*(?:\(\s*\w+\s*\)\s*)?(?:in|on|for|from|within|inside)\b", piece, re.IGNORECASE):
        return False  # "In △ABC, …" sets the scene; its comma ends it
    rest = re.sub(r"(?<![A-Za-z\\])(?:[A-Z][0-9]*'*)+(?![a-z])|\\angle\s*\{?\s*\d+\s*\}?|∠\s*\d+", " ", piece)
    rest = re.sub(_LIST_MARK, " ", rest)
    # What a question or a statement to prove leads with states nothing yet
    # ("Explain why ∠ADE and ∠ABC are congruent", "find QS, PQ, and QR").
    rest = re.sub(r"\b(?:explain|why|prove|show|verify|justify|whether)\b", " ", _QUESTION.sub(" ", rest), flags=re.I)
    return not _NAMING.sub("", rest)


def _non_stops(t: str) -> set[int]:
    """Positions of the dots in `t` that end no sentence."""
    return {m.start() + k for m in _NOT_A_STOP.finditer(t) for k, ch in enumerate(m.group(0)) if ch == "."}


def _clauses(t: str) -> list[tuple[int, int]]:
    """The text cut into clauses (spans): at sentence ends, commas, "and",
    "if", "where" … but never inside brackets ("A(0, 0)"), at a decimal
    point, nor at a comma or "and" that only lists
    names ("AB and CD are parallel", "A, B and C lie on circle O")."""
    out: list[tuple[int, int]] = []
    start, depth = 0, 0
    skip = _non_stops(t)
    i = 0
    while i < len(t):
        ch = t[i]
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth = max(0, depth - 1)
        elif depth == 0 and i not in skip and (m := _CLAUSE_END.match(t, i)) and (
                not m.group(0)[0].isalpha() or i == 0 or not t[i - 1].isalpha()):
            word = m.group(0).strip().lower()
            if word in (",", "and") and _lists_names(t[start:i]) and not (
                    out and _states(t[out[-1][0]:out[-1][1]])
                    and re.fullmatch(r"\s*(?:,\s*)?(?:and\s*)?", t[out[-1][1]:start], re.IGNORECASE)):
                # A list of names goes on to what is said about them ("A, B and
                # C lie on circle O") -- unless the names end a statement before
                # them ("right angles at A and C, and AB = 3": C is the angle's).
                i = m.end()
                continue
            out.append((start, i))
            start = i = m.end()
            continue
        i += 1
    out.append((start, len(t)))
    trimmed: list[tuple[int, int]] = []
    for a, b in out:
        while a < b and t[a].isspace():
            a += 1
        while b > a and t[b - 1].isspace():
            b -= 1
        if a >= b:
            continue
        if trimmed and _ONLY_A_NUMBER.match(t[a:b]) and not re.search(r"[.;?!\n]", t[trimmed[-1][1]:a]):
            # "legs of length 3 and 4": a number alone goes on with the list before it.
            trimmed[-1] = (trimmed[-1][0], b)
            continue
        trimmed.append((a, b))
    return trimmed


# Where a question's target phrase ends: "Find m∠A | in right △ABC",
# "What is AC | if …", "the length of AC | (where …)". What follows is said
# about the figure and is covered like any statement.
_TARGET_END = re.compile(
    r"\s+(?:in|inside|outside|with|without|if|given|where|when|whenever|knowing|whose|which|that|such|so|"
    r"using|by|assuming|since|because)\b"
    r"|\s+of\s+(?:an?\s+|the\s+)?(?:right|acute|obtuse|scalene|isosceles|equilateral)\b"
    r"|\s*[(—–:;,.?!]|\s+-+\s",
    re.IGNORECASE,
)


def _question_spans(t: str) -> list[tuple[int, int]]:
    """The target phrases of questions and instructions: from the question
    word through what is asked ("Find m∠A", "What is the length of AC"),
    up to the end of its clause or a condition ("… if AB = 5"). Only the
    target's own tokens are exempt (coverage.py); the rest of a question's
    sentence is accounted for like any statement."""
    out: list[tuple[int, int]] = []
    for a, b in _clauses(t):
        clause = t[a:b]
        if re.search(r"\b(?:prove|show\s+that|verify|justify|explain)\b", clause, re.IGNORECASE):
            continue
        if m := _QUESTION.search(clause):
            start = a + m.start()
            end = _TARGET_END.search(t, start + 1, b)
            out.append((start, end.start() if end else b))
    return out


def _states(piece: str) -> bool:
    """The piece says something beyond naming parts of the figure."""
    rest = re.sub(r"(?<![A-Za-z\\])(?:[A-Z][0-9]*'*)+(?![a-z])|\\angle\s*\{?\s*\d+\s*\}?", "", piece)
    return bool(_NAMING.sub("", rest))


def _restated(t: str, clauses: list[tuple[int, int]]) -> dict[int, int]:
    """Clauses of the (cleaned) text that say again, exactly, what an
    earlier clause said ("In the figure below, M is the midpoint of AC.
    Given: M is the midpoint of AC"): {restating clause: the clause it
    repeats}. Exactly: the same symbols, names, words and their case, only
    the spacing may differ, and a leading "Given:" or "also" changes
    nothing. "∠A ≅ ∠D" restated as "∠CAE ≅ ∠BDE" is not a repeat."""
    seen: dict[tuple[str, ...], int] = {}
    out: dict[int, int] = {}
    for ci, (a, b) in enumerate(clauses):
        toks = re.findall(r"\\[A-Za-z]+|[A-Za-z]+|\d+(?:\.\d+)?|\S", t[a:b])
        while toks and toks[0] in ("Given", "given", "Also", "also", ":"):
            toks = toks[1:]
        key = tuple(toks)
        if not key:
            continue
        if key in seen:
            out[ci] = seen[key]
        else:
            seen[key] = ci
    return out


# \frac{1}{2}, \frac12, 4\frac{1}{2} (cleaned text), and 4 1/2.
_FRACTIONS = (
    re.compile(r"(?:(?<![\d.])(?P<whole>\d+)\s*)?\\[dt]?frac\s*(?:\{\s*(?P<num>\d+)\s*\}\s*\{\s*(?P<den>\d+)\s*\}"
               r"|(?P<n1>\d)(?P<d1>\d))"),
    re.compile(r"(?<![\d.])(?P<whole>\d+)\s+(?P<num>\d+)\s*/\s*(?P<den>\d+)(?![\d.])"),
)


def _fraction_value(m: re.Match[str]) -> float | None:
    g = m.groupdict()
    num, den = g.get("num") or g.get("n1"), g.get("den") or g.get("d1")
    if not num or not den or not float(den):
        return None
    return round(float(g.get("whole") or 0) + float(num) / float(den), 6)


def invented_points(facts: FigureFacts, text: str) -> list[str]:
    """Points a reading names that the problem (or the teacher's message)
    never writes: the reading made them up for an unnamed figure."""
    from api.core.geometry.figure_check import _clean

    def prime(x: str) -> str:
        return x.replace("′", "'")

    written: set[str] = set()
    for run in re.findall(r"(?<![A-Za-z\\])((?:[A-Z](?:'|′)*)+)(?![a-z])", prime(_clean(text)) + "\n" + prime(text)):
        written |= {prime(n) for n in split_names(run)} | set(re.findall(r"[A-Z]'*", run))
    return sorted(p.strip() for p in facts.points if split_names(p) and prime(p.strip()) not in written)


# ── Verifiers: each fact as relations the drawing is measured against ─

def unverifiable(facts: FigureFacts) -> list[str]:
    """Facts with no numeric check on the drawing."""
    out = []
    for f in [*facts.givens, *facts.prove]:
        if _states_nothing(f, facts):
            continue
        try:
            rels = to_relations(f, facts)
        except (ValueError, IndexError):
            rels = None
        if not rels:
            out.append(f.quote.strip() or f.kind.replace("_", " "))
    return out


_CIRCLE_WORDS = re.compile(
    r"\bcircles?\b|\bsemicircles?\b|\\odot|⊙|\bradi(?:us|i)\b|\bdiameters?\b|\bchords?\b|\btangen(?:t|ts|cy)\b|"
    r"\binscribed\b|\bcircum|\barcs?\b|\\overset\s*\{?\s*\\frown|\\wideparen",
    re.IGNORECASE,
)


def grounded(facts: FigureFacts, text: str) -> FigureFacts:
    """The reading without circle facts when the text (problem and request)
    names no circle: there is then no circle to state anything about ("share
    hypotenuse BC" read as "BC is a diameter"). Each fact set aside is noted
    in `dropped`, written by code."""
    if _CIRCLE_WORDS.search(text):
        return facts
    out: dict[str, list[Fact]] = {"givens": [], "prove": []}
    notes: list[str] = []
    for section in ("givens", "prove"):
        for f in getattr(facts, section):
            if f.kind in CIRCLE_KINDS:
                notes.append(f"set aside from {section}: {describe(f)} (the problem names no circle)")
            else:
                out[section].append(f)
    if facts.circles:
        notes.append("set aside: circles " + ", ".join(c or "(unnamed)" for c in facts.circles)
                     + " (the problem names no circle)")
    if not notes:
        return facts
    return facts.model_copy(update={**out, "circles": [], "dropped": [*facts.dropped, *notes]})


_SEG_W = r"(?:\\overline\s*)?\{?\s*([A-Z][0-9]*'*)\s*([A-Z][0-9]*'*)\s*\}?"
_PT_W = r"(?:point\s+)?\{?\s*([A-Z][0-9]*'*)\s*\}?(?![A-Za-z])"
# "side BC extended to point D", "extending side RP beyond P", "extend BM to E".
_EXTENSIONS = [
    re.compile(rf"(?:side\s+|segment\s+)?{_SEG_W}\s+(?:is\s+)?extended\s+(?:beyond|past|through)\s+{_PT_W}"
               rf"(?:\s+to\s+{_PT_W})?", re.I),
    re.compile(rf"extend(?:ing|s|ed)?\s+(?:side\s+|segment\s+)?{_SEG_W}\s+(?:beyond|past|through)\s+{_PT_W}"
               rf"(?:\s+to\s+{_PT_W})?", re.I),
    re.compile(rf"(?:side\s+|segment\s+)?{_SEG_W}\s+(?:is\s+)?extended\s+to\s+{_PT_W}", re.I),
    re.compile(rf"extend(?:ing|s|ed)?\s+(?:side\s+|segment\s+)?{_SEG_W}\s+to\s+{_PT_W}", re.I),
]
_INTERIOR = re.compile(
    r"(?:ray\s+)?(?:\\overrightarrow\s*)?\{?\s*([A-Z][0-9]*'*)\s*([A-Z][0-9]*'*)\s*\}?\s+(?:lies|is)\s+"
    r"(?:in|on)\s+the\s+interior\s+of\s+∠\s*((?:[A-Z][0-9]*'*){3})", re.I)
_DRAW = re.compile(rf"^\s*(?:and\s+)?(?:then\s+)?draw\s+(?:segment\s+|the\s+segment\s+)?{_SEG_W}\s*[.,;]?\s*$", re.I)
_COORD = r"[A-Z][0-9]*'*\s*=?\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)"
# The angle sum of a triangle: always 180°, so it says nothing about the figure.
_ANGLE_SUM = re.compile(
    r"(?:m\s*)?(?:\\angle|∠)\s*\{?\s*([A-Z])\s*\}?\s*\+\s*(?:m\s*)?(?:\\angle|∠)\s*\{?\s*([A-Z])\s*\}?\s*\+\s*"
    r"(?:m\s*)?(?:\\angle|∠)\s*\{?\s*([A-Z])\s*\}?\s*=\s*180|"
    r"\b(?:the\s+)?(?:three\s+)?(?:interior\s+)?angles(?:\s+of\s+(?:the\s+|a\s+|any\s+)?(?:triangle|\\triangle\s*[A-Z]{3}))?"
    r"\s+(?:sum|add(?:\s+up)?)\s+to\s+180", re.I)


_ANGLE_SHAPE = re.compile(
    r"∠\s*((?:[A-Z][0-9]*'*){1,3}|\d+)\s+(?:is\s+)?(?:an?\s+)?(obtuse|acute)(?:\s+angle)?(?![A-Za-z])")
_TRIANGLE_SHAPE = re.compile(
    r"(?<![A-Za-z])(obtuse|acute|scalene)\s+(?:triangle\s*|△\s*)((?:[A-Z][0-9]*'*){3})(?![A-Za-z0-9'])"
    r"|(?:triangle\s*|△\s*)((?:[A-Z][0-9]*'*){3})\s+is\s+(?:an?\s+)?(obtuse|acute|scalene)(?![A-Za-z])")


def _angle_or_triangle_shape(plain: str) -> tuple[str, str] | None:
    """(kind, name) when a quote says exactly that an angle is obtuse or
    acute, or a triangle is obtuse, acute or scalene ("∠B is obtuse",
    "acute △ABC"), and nothing more: "acute △ABC with AB the longest side"
    says more than the shape fact would check, so it stays unverifiable."""
    if m := _ANGLE_SHAPE.fullmatch(plain):
        return f"{m.group(2).lower()}_angle", m.group(1)
    if m := _TRIANGLE_SHAPE.fullmatch(plain):
        word, name = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        word = word.lower()
        return ("scalene" if word == "scalene" else f"{word}_triangle"), name
    return None


def _names_upper(m: re.Match[str]) -> bool:
    """The names a case-blind pattern caught are capitals ("BC", not "de")."""
    return all(g is None or g[:1].isupper() for g in m.groups())


def _plain_quote(q: str) -> str:
    """A quote as a teacher reads it (\\overline{AB} → AB, \\angle → ∠)."""
    from api.core.geometry.figure_check import _clean, _plain

    return re.sub(r"\s+", " ", _plain(_clean(q))).strip(" .,;:")


def _norm_quote(q: str) -> str:
    return _plain_quote(q).lower()


def _angle_sum_of_triangle(quote: str, facts: FigureFacts) -> bool:
    """The quote says a triangle's three angles add up to 180° (the
    statement, not a value): ∠A + ∠B + ∠C = 180° for a named △ABC, or
    "the three angles sum to 180°" when the problem has a triangle."""
    from api.core.geometry.figure_check import _clean

    m = _ANGLE_SUM.search(_clean(quote))
    if not m:
        return False
    corners = {frozenset(split_names(t)) for t in facts.triangles} | {
        frozenset(split_names(p)) for p in facts.polygons if len(split_names(p)) == 3}
    if m.group(1):
        return frozenset(m.group(1, 2, 3)) in corners
    return bool(corners)


def standard_reading(facts: FigureFacts) -> FigureFacts:
    """What code reads out of a reading's own words before the two readings
    are compared (both get the same treatment, so this can only make them
    agree on what the words say):

    - "side BC extended to point D", "extending RP beyond P": an extension
      fact (D past C on line BC), whatever kind the reading gave it;
    - "ray BD lies in the interior of ∠ABC": an interior-ray fact;
    - "draw AD": the segment AD to draw, not a fact;
    - "A(0, 0), B(4, 2)": nothing (code reads coordinates from the text);
    - a triangle's angles adding up to 180°: nothing (always true);
    - an "other" fact whose words another fact of the reading checks in
      full ("PQ is the perpendicular bisector of AB" beside the
      perpendicular and bisector facts quoting those words): nothing more;
    - "△ABD is shaded": nothing (code reads shading from the text);
    - a shape fact whose quote neither names the shape nor states any
      relation ("Quadrilateral ABCD" read as a parallelogram): nothing;
    - "∠BCA is at vertex C, inside △ABC": nothing (its name says as much);
    - "∠AGH ≅ ∠GHD (alternate interior angles)": also the position fact.

    Each fact taken out is noted in `dropped`."""
    from api.core.geometry.figure_check import _clean, shaded_regions

    segments = list(facts.segments)
    notes: list[str] = []
    out: dict[str, list[Fact]] = {"givens": [], "prove": []}
    added_pairs: list[Fact] = []
    for section in ("givens", "prove"):
        for f in getattr(facts, section):
            q = f.quote or ""
            plain = _plain_quote(q)
            # An "other" fact becomes a checkable kind only when its quote is
            # exactly that phrase: a quote that says more keeps it unverifiable.
            exact = f.kind == "other"

            def find(rx: re.Pattern[str], plain: str = plain, exact: bool = exact) -> re.Match[str] | None:
                return rx.fullmatch(plain) if exact else rx.search(plain)
            ext = next((m for rx in _EXTENSIONS if (m := find(rx)) and _names_upper(m)), None)
            interior = m if (m := find(_INTERIOR)) and _names_upper(m) else None
            if ext and f.kind in ("other", "on_segment", "on_line", "collinear", "intersect"):
                a, b, *rest = ext.groups()
                past, to = (rest[0], rest[1]) if len(rest) == 2 else (None, rest[0])
                start, end = (a, b) if past in (None, b) else (b, a)
                if past is not None and past not in (a, b):
                    out[section].append(f)
                    continue
                new = Fact(kind="extension", items=[start + end], point=to or None, quote=q)
                if not any(x.kind == "extension" and x.items == new.items and x.point == new.point
                           for x in out[section]):
                    out[section].append(new)
                continue
            if (shape := _angle_or_triangle_shape(plain)) and (f.kind == "other" or (
                    f.kind == "angle_measure" and f.value is None and not f.expr)):
                out[section].append(Fact(kind=shape[0], items=[shape[1]], quote=q))
                continue
            if interior and f.kind == "other":
                ray, ang_ = interior.group(1) + interior.group(2), interior.group(3)
                out[section].append(Fact(kind="interior_ray", items=[ray, ang_], quote=q))
                continue
            if f.kind == "other" and (m := _DRAW.match(plain)) and _names_upper(m):
                pair = m.group(1) + m.group(2)
                if not any(frozenset(split_names(x)) == frozenset(pair) for x in segments):
                    segments.append(pair)
                notes.append(f"read as a part to draw: “{q}”")
                continue
            if f.kind == "other" and re.search(_COORD, q) and not re.sub(
                r"\b(?:and|vertices|vertex|at|has|have|with|points?|triangle|quadrilateral|polygon)\b|[\s,.;:$]",
                "", re.sub(rf"{_COORD}|(?<![A-Za-z])[A-Z]{{2,}}(?![a-z])", "", q), flags=re.I,
            ):
                notes.append(f"read by code (coordinates): “{q}”")
                continue
            if f.kind == "other" and shaded_regions(_clean(q)) and not re.sub(
                r"\b(?:is|are|shaded|shade|the|a|region|triangle|sector|and)\b|[\s,.;:$△]|\\triangle",
                "", re.sub(r"(?<![A-Za-z])[A-Z]{3,}(?![a-z])", "", _plain_quote(q)), flags=re.I,
            ):
                notes.append(f"read by code (shading): “{q}”")
                continue
            if f.kind in _SHAPE_WORD and not re.search(_SHAPE_WORD[f.kind], plain, re.I) and not re.search(
                    _RELATION_SAID, plain, re.I):
                # "Quadrilateral ABCD" read as a parallelogram: the words name
                # the figure and state nothing about it.
                notes.append(f"set aside: {describe(f)} (its quote “{q}” doesn't say so)")
                continue
            if f.kind == "other" and _names_its_angle(_plain_quote(q)):
                notes.append(f"set aside: “{q}” (it only says where the angle its name gives is)")
                continue
            if _angle_sum_of_triangle(q, facts) and f.value is None:
                notes.append(f"set aside: “{q}” (a triangle's angles always add up to 180°)")
                continue
            out[section].append(f)
    # An "other" fact another fact already checks in full.
    for section in ("givens", "prove"):
        kept = []
        for f in out[section]:
            nq = _norm_quote(f.quote or "")
            covering = [g for g in out[section] if g.kind != "other" and nq and nq in _norm_quote(g.quote or "")]
            if f.kind == "other" and covering and _said_by(f, covering, facts):
                notes.append(f"set aside: “{f.quote}” (checked by {', '.join(describe(g) for g in covering)})")
                continue
            kept.append(f)
        out[section] = kept
    # "∠AGH ≅ ∠GHD (alternate interior angles)": where the angles sit.
    for f in out["prove"] + out["givens"]:
        if f.kind != "congruent_angles" or len(f.items) != 2:
            continue
        for pk in PAIRS:
            paren = rf"\(\s*(?:as\s+|which\s+are\s+)?{_PAIR_RX[pk]}\s*(?:angles)?\s*\)"
            if re.search(paren, f.quote, re.I) and not any(
                g.kind == pk and set(g.items) == set(f.items) for g in out["givens"]
            ):
                added_pairs.append(Fact(kind=pk, items=list(f.items), quote=f.quote))
    out["givens"] += added_pairs
    if out == {"givens": facts.givens, "prove": facts.prove} and segments == facts.segments and not notes:
        return facts
    return facts.model_copy(update={**out, "segments": segments, "dropped": [*facts.dropped, *notes]})


# A shape fact's quote names the shape.
_SHAPE_WORD = {
    "isosceles": r"\bisosceles\b", "equilateral": r"\bequilateral\b|\bequiangular\b",
    "right_triangle": r"\bright\b|90|⊥|\\perp|\bperpendicular\b",
    "parallelogram": r"\bparallelograms?\b", "rectangle": r"\brectangles?\b", "square": r"\bsquares?\b",
    "rhombus": r"\brhomb(?:us|uses|i)\b", "trapezoid": r"\btrapez(?:oid|oids|ium)\b",
    "isosceles_trapezoid": r"\bisosceles\b", "kite": r"\bkites?\b",
}
# Words or symbols by which a quote states a relation ("DA = DC" says
# isosceles at D; "Quadrilateral ABCD" says nothing).
_RELATION_SAID = (r"[=≅∥⊥∼≈]|\\(?:cong|parallel|perp|sim)\b|\b(?:parallel|perpendicular|congruent|equal|same|"
                  r"bisect\w*|midpoint|degrees?|right|sides?|angles?)\b|°|\d")
_PT1 = r"([A-Z][0-9]*'*)"
_ANGLE_SAID = re.compile(
    rf"^\s*∠\s*{_PT1}{_PT1}{_PT1}\s+is\s+at\s+(?:the\s+)?vertex\s+{_PT1}"
    rf"(?:\s*,?\s*(?:inside|in)\s+△\s*{_PT1}{_PT1}{_PT1})?"
    rf"(?:\s*,?\s*(?:and\s+)?between\s+(?:the\s+)?sides\s+{_PT1}{_PT1}\s+and\s+{_PT1}{_PT1})?\s*[.;]?\s*$")


def _names_its_angle(quote: str) -> bool:
    """"∠BCA is at vertex C, inside △ABC, between sides BC and AC": only
    where the angle its own name puts is (its vertex, its triangle, its
    sides), so it states nothing more."""
    m = _ANGLE_SAID.match(quote)
    if not m:
        return False
    x, v, y, at, *rest = m.groups()
    tri, sides = rest[:3], rest[3:]
    if at != v:
        return False
    if tri[0] is not None and set(tri) != {x, v, y}:
        return False
    if sides[0] is not None and {frozenset(sides[:2]), frozenset(sides[2:])} != {
            frozenset((v, x)), frozenset((v, y))}:
        return False
    return True


# Words that carry no relation of their own in a fact's quote.
_FILLER = re.compile(
    r"\b(?:a|an|the|is|are|of|at|from|all|two|three|both|each|and|point|points|vertex|vertices|line|lines|"
    r"segment|segments|ray|rays|angle|angles|side|sides|with|to|in|that|which|its|their|given|let|prove)\b"
    r"|[↔→\s,.;:$()]", re.I)


def _said_by(f: Fact, covering: list[Fact], facts: FigureFacts) -> bool:
    """Every word of an "other" fact's quote is said by the checked facts
    quoting the same words: its names are theirs, and once the names, the
    filler words, and each relation word those facts' kinds account for
    are taken out, nothing is left ("↔PQ is the perpendicular bisector of
    AB" beside "PQ ⊥ AB" and "PQ bisects AB"). "A secant passes through A
    and B on the circle" beside "A, B lie on the circle" keeps "secant
    passes", so it stays (and can't be checked)."""
    names = set().union(*(_fact_names(g) for g in covering))
    if not _names(_plain_quote(f.quote)) <= names | {line_key(x) for x in names}:
        return False
    from api.core.geometry.coverage import INERT_WORDS, VOCAB, tokens
    from api.core.geometry.figure_check import _clean

    vocab = set().union(*(VOCAB.get(g.kind, frozenset()) for g in covering))
    rest = " ".join(k.norm for k in tokens(_clean(f.quote or ""))
                    if k.kind in ("word", "sym", "num", "var") and k.norm not in vocab and k.norm not in INERT_WORDS)
    return not _FILLER.sub("", rest)


_PAIR_RX = {
    "alternate_interior": r"alternate\s+interior",
    "alternate_exterior": r"alternate\s+exterior",
    "corresponding": r"corresponding",
    "same_side_interior": r"(?:same[-\s]side|consecutive|co-?)\s*interior",
}


def described_in_words(facts: FigureFacts) -> list[str]:
    """Facts with no check whose parts the problem describes rather than
    names ("the acute angle at line m", "a diagonal")."""
    out = []
    for f in [*facts.givens, *facts.prove]:
        if _states_nothing(f, facts) or f.kind != "other" and to_relations_or_none(f, facts):
            continue
        if not any(split_names(x) for x in f.items):
            out.append(f.quote.strip() or f.kind.replace("_", " "))
    return out


def to_relations_or_none(f: Fact, facts: FigureFacts) -> list[Any] | None:
    try:
        return to_relations(f, facts) or None
    except (ValueError, IndexError):
        return None


def first_difference(a: FigureFacts, b: FigureFacts) -> str:
    """The first given or statement to prove one reading has and the other
    doesn't, in words written by code; "" when it is elsewhere."""
    x, y = atoms(a), atoms(b)
    for section in ("givens", "prove"):
        for mine, theirs, facts in ((x, y, a), (y, x, b)):
            for f in getattr(facts, section):
                if _states_nothing(f, facts):
                    continue
                own = _closure(_fact_atoms(f, facts)) & mine[section]
                if own - theirs[section]:
                    return describe(f) if f.kind != "other" else ""
    return ""


def impossible_measures(facts: FigureFacts) -> list[str]:
    """Angles the problem's own numbers make more than a straight angle, or
    zero or less: no figure can show them."""
    from api.core.geometry.figure_check import _ang_txt, solved_expressions

    rels: list[Any] = []
    for f in facts.givens:
        rels += to_relations_or_none(f, facts) or []
    out = []
    for r in [*solved_expressions(rels), *(r for r in rels if r.kind == "measure")]:
        if r.kind != "measure":
            continue
        v = float(r.args[1])
        if v > 180 + 1e-6:
            out.append(f"the problem's numbers make {_ang_txt(r.args[0])} {v:g}°, more than a straight angle; "
                       "check the problem for a typo")
        elif v <= 1e-6:
            out.append(f"the problem's numbers make {_ang_txt(r.args[0])} {v:g}°, which no angle can be; "
                       "check the problem for a typo")
    return list(dict.fromkeys(out))


def _a(s: str) -> str:
    return f"∠{s}"


def _pair_words(kind: str) -> str:
    return kind.replace("_", " ").replace("same side", "same-side")


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
    amount = _num_txt(f.value) if f.value is not None else f.expr or ""
    said: dict[str, str] = {
        "congruent_angles": " ≅ ".join(_a(x) for x in it),
        "equal_length": (
            " = ".join([*it, *([amount] if amount else [])])
            if len(it) >= 2 else
            f"{first} = {_num_txt(f.value) if f.value is not None else f.expr or ''}" if first
            else f"a side of length {_num_txt(f.value)}"
        ),
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
        "interior_ray": f"ray {first} lies inside {_a(rest)}",
        "obtuse_angle": f"{_a(first)} is obtuse",
        "acute_angle": f"{_a(first)} is acute",
        "obtuse_triangle": f"△{first} is obtuse",
        "acute_triangle": f"△{first} is acute",
        "scalene": f"△{first} is scalene",
        "extension": (f"{first} is extended beyond {split_names(first)[-1] if split_names(first) else ''}"
                      + (f" to {p}" if p else "")),
        **{
            pk: (f"{' and '.join(_a(x) for x in it)} are {_pair_words(pk)} angles"
                 if len(it) >= 2 else f"which angles are {_pair_words(pk)}")
            for pk in PAIRS
        },
    }
    if k in said:
        return said[k]
    if k in SHAPES:
        name = k.replace("_", " ")
        return f"{first} is {'an' if k[0] in 'aeiou' else 'a'} {name}" if first else f"a {name}"
    return f"{k.replace('_', ' ')} {' '.join(it)}".strip()


_LENGTH_ROLES = (
    ("hypotenuse", r"\bhypotenuses?\b"), ("leg", r"\blegs?\b"), ("radius", r"\bradi(?:us|i)\b"),
    ("diameter", r"\bdiameters?\b"),
    ("unplaced", r"\b(?:bases?|heights?|altitudes?|apothems?|slant|diagonals?|medians?|perimeter|chords?|arcs?)\b"),
)


def _length_role(quote: str) -> str:
    """The role a length's words give its unnamed part: "hypotenuse",
    "leg", "radius", "diameter", "unplaced" (a role the checker can't place
    on a drawing), or "" (any side: "a side of 4", "7 wide")."""
    return next((role for role, rx in _LENGTH_ROLES if re.search(rx, quote or "", re.IGNORECASE)), "")


def to_relations(f: Fact, facts: FigureFacts) -> list[Any]:
    """The checker's relations for one fact; [] when it has no verifier."""
    from api.core.geometry.figure_check import _quad_relations, _Relation, linear_expr

    k, it = f.kind, f.items
    text = describe(f)

    def R(kind: str, *args: Any, what: str = text, family: str = "") -> _Relation:  # noqa: N802
        return _Relation(kind, args, what, family=family)

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

    def algebra(e: str | None) -> str:
        # Algebra the checker can't hold a drawing to (two variables, x²)
        # leaves the fact with no check: it is "can't verify".
        if not e or linear_expr(e) is None:
            raise ValueError(e)
        return e

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
    if k == "equal_length" and len(it) >= 2:
        # "DA = DC": two sides equal; with a value or algebra, each has it.
        rels = [R("eqlen", pair(x), pair(y)) for x, y in zip(it, it[1:])]
        if f.value is not None:
            rels += [R("length", pair(x), float(f.value)) for x in it]
        elif f.expr:
            rels += [R("lenexpr", pair(x), algebra(f.expr)) for x in it]
        return rels
    if k == "equal_length" and it:
        if f.value is not None:
            return [R("length", pair(it[0]), float(f.value))]
        return [R("lenexpr", pair(it[0]), algebra(f.expr))] if f.expr else []
    if k == "interior_ray" and len(it) >= 2:
        v, end = pair(it[0])
        whole = angle(it[1])
        if isinstance(whole, str):
            raise ValueError(it[1])
        x, vertex, y = whole
        if vertex != v or not x:
            raise ValueError(it[1])
        return [R("interior", v, end, (x, y))]
    if k == "extension" and it:
        start, end = pair(it[0])
        return [R("beyond", start, end, f.point or "")]
    if k in ("obtuse_angle", "acute_angle") and it:
        return [R("anglerange", angle(it[0]), k.removesuffix("_angle"))]
    if k in ("obtuse_triangle", "acute_triangle", "scalene") and it:
        return [R("trishape", tri(it[0]), k.removesuffix("_triangle"))]
    if k == "equal_length" and f.value is not None:
        # A side the problem doesn't name ("a width of 7 inches"): the
        # figure shows it by a side labelled with that length, on a part of
        # the role the words give it (a leg, the hypotenuse, a radius). A
        # role the checker can't place (a base, a height) leaves it unchecked.
        role = _length_role(f.quote)
        if role == "unplaced":
            raise ValueError(f.quote)
        return [R("lengthlabel", float(f.value), role)]
    if k == "angle_measure" and it:
        a = angle(it[0])
        if f.value is None and not f.expr:
            return []
        if f.value is not None and f.expr:
            # "m∠1 = 4x + 9", solved to 41°: the figure labels the algebra.
            return [R("measure", a, float(f.value), family="solved")]
        return value_rel(a) or [R("expr", a, algebra(f.expr))]
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
    if k in PAIRS and len(it) >= 2:
        return [R("anglepair", k, angle(it[0]), angle(it[1]))]
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
    if k in ("radius", "diameter") and it:
        out = [R("diam", pair(it[0]), f.circle or "") if k == "diameter" else R("radius", pair(it[0]))]
        if f.value is not None:  # its stated length, as for "OA = 3"
            out.append(R("length", pair(it[0]), float(f.value)))
        elif f.expr:
            out.append(R("lenexpr", pair(it[0]), algebra(f.expr)))
        return out
    if k in ("central_angle", "inscribed_angle") and it:
        a = angle(it[0])
        if not isinstance(a, tuple) or not a[0]:
            raise ValueError(it[0])
        out = value_rel(a) or ([R("expr", a, algebra(f.expr))] if f.expr else [])
        if k == "central_angle":
            return [*out, R("center", a[1], f.circle or "")]
        return [*out, R("oncircle", (a[0], a[1], a[2]), f.circle or "")]
    if k == "numbered_angle" and len(it) >= 2:
        return [R("numbered", it[0], angle(it[1]))]
    if k == "transversal" and len(it) >= 3:
        return [R("crosses", it[0], it[1], it[2])] if it[0] else [R("crosses", "", it[1], it[2])]
    return []


def unnamed_requests(facts: FigureFacts) -> list[str]:
    """Parts the teacher asked for by description, not by name ("the
    altitude from the top vertex"): nothing can hold a figure to them, so
    the reply must say they weren't added."""
    out = []
    for p in facts.requested:
        n = split_names(p.item)
        named = {
            "point": len(n) == 1, "segment": len(n) == 2, "ray": len(n) == 2,
            "line": len(n) == 2 or _is_line_name(p.item), "angle": len(n) in (1, 3) or p.item.strip().isdigit(),
            "triangle": len(n) == 3, "polygon": len(n) >= 3, "circle": True,
        }.get(p.kind, False)
        if not named and p.item.strip():
            out.append(p.item.strip())
    return out


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
                            "kind": {"type": "string", "enum": [
                                k for k in FactKind.__args__ if k not in CODE_KINDS  # type: ignore[attr-defined]
                            ]},
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
        ProblemParts,
        _bare_request_parts,
        _clean,
        _collect_parts,
        _numbers,
        _rel_points,
        algebra_relation,
        coordinate_relations,
        figure_words,
        shaded_regions,
        solved_expressions,
    )

    out = ProblemParts()
    t = _clean(text)
    out.numbers = _numbers(t)
    out.words = figure_words(t)
    out.shaded = shaded_regions(t)
    # The reading's circles, and any a circle fact names.
    named = [f.circle for f in [*facts.givens, *facts.prove] if f.circle is not None]
    out.circles = [*facts.circles, *dict.fromkeys(c for c in named if c not in facts.circles)]

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
    # Coordinates are read by code from the text, never from a reading.
    out.givens += coordinate_relations(t)
    # Measures given as algebra: the ones the facts fix become plain
    # measures; all of them are held together by one relation.
    every = out.givens + out.prove
    out.givens += solved_expressions(every)
    if alg := algebra_relation(every):
        out.givens.append(alg)
    out.expressions = [(r.args[0], r.args[1]) for r in every if r.kind in ("expr", "lenexpr")]
    out.givens = [r for r in out.givens if r.kind not in ("expr", "lenexpr")]
    out.prove = [r for r in out.prove if r.kind not in ("expr", "lenexpr")]
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
        **{pk: slice(None) for pk in PAIRS},
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
