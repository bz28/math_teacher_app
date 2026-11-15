"""The fact card: the facts of a geometry problem the AI WRITES, handed over
directly instead of read back from its words.

When the AI writes a problem (generation, regenerate, a chat rewrite), it
fills in a card: the points and parts of the figure, the givens, what to
prove or find, and what the student constructs. Code then

  1. checks the card (`read_card`): only kinds the checker can verify, no
     "other", no code-only kinds, every name it uses declared, every fact
     checkable, no impossible measure;
  2. writes the problem's givens and ask from the card (`card_text`), one
     fixed phrase per fact kind, so the words the student reads say exactly
     what the card says and nothing more. The AI may add a context sentence
     and a hint, each kept only when it names no point, gives no number and
     states no relation (`clean_context`, `clean_hint`);
  3. checks the drawing against the card itself (figure_check), so there are
     no readings and no word coverage for these problems.

Who draws what is on the card, not guessed from the words: the parts in the
card's own lists are shown in the figure (an auxiliary line such as the
median AD included); what the student constructs is the `constructs`
section, and its parts are never drawn (`constructed_drawn`).

Never a wrong figure: anything the card can't be held to means no card, and
a problem without a card gets no figure.
"""

from __future__ import annotations

import math
import re
from typing import Any

from pydantic import ValidationError

from api.core.geometry.facts import (
    CODE_KINDS,
    FACTS_TOOL,
    PAIRS,
    SHAPES,
    Fact,
    FactKind,
    FigureFacts,
    Target,
    _is_line_name,
    impossible_measures,
    lin,
    line_key,
    split_names,
    unverifiable,
)

# The kinds an author card may use: every kind the checker verifies from
# named parts. Not "other" (it checks nothing), not the kinds only code
# writes from a reading's words.
AUTHOR_KINDS: tuple[str, ...] = tuple(
    k for k in FactKind.__args__  # type: ignore[attr-defined]
    if k != "other" and k not in CODE_KINDS
)

_ITEMS = {"type": "array", "items": {"type": "string"}}
_FACT_ITEM: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(AUTHOR_KINDS)},
        "items": _ITEMS,
        "point": {"type": ["string", "null"]},
        "value": {"type": ["number", "null"]},
        "expr": {"type": ["string", "null"]},
        "circle": {"type": ["string", "null"]},
    },
    "required": ["kind", "items"],
    "additionalProperties": False,
}
_FACTS_PROPS = FACTS_TOOL["input_schema"]["properties"]

# The card, as the generation tools take it.
CARD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        "The problem's fact card. Code writes the problem's givens and question from it, one fixed "
        "phrase per fact, and checks the figure against it. Names: points 'A', \"B'\"; segments, rays "
        "and two-point lines 'AB' (a ray from its first letter); named lines 'm'; angles 'ABC' (vertex "
        "in the middle) or '1' for a numbered angle; triangles 'ABC'; polygons 'ABCD' in order; circles "
        "by their center point."
    ),
    "properties": {
        "points": {**_ITEMS, "description": "Every point the figure shows, by name."},
        "segments": {**_ITEMS, "description": "Segments the figure shows (including an auxiliary line such "
                                              "as a median the problem draws)."},
        "rays": {**_ITEMS, "description": "Rays the figure shows: 'BD' from B through D."},
        "lines": {**_ITEMS, "description": "Full lines the figure shows, by two points: 'AB'."},
        "named_lines": {**_ITEMS, "description": "Lines named by a letter: 'm', 'ell_1'."},
        "triangles": _FACTS_PROPS["triangles"],
        "polygons": _FACTS_PROPS["polygons"],
        "circles": {**_ITEMS, "description": "Circles, by their center point."},
        "givens": {"type": "array", "items": _FACT_ITEM, "description": "What the problem gives."},
        "prove": {"type": "array", "items": _FACT_ITEM, "description": "What the student proves."},
        "find": {
            "type": "array",
            "description": "What the student finds: an angle ('ABC'), a segment's length ('AB'), or "
                           "kind 'other' with item a variable ('x') that a given's expr uses.",
            "items": {
                "type": "object",
                "properties": {"kind": {"type": "string", "enum": ["angle", "segment", "other"]},
                               "item": {"type": "string"}},
                "required": ["kind", "item"],
                "additionalProperties": False,
            },
        },
        "constructs": {
            "type": "array", "items": _FACT_ITEM,
            "description": (
                "What the STUDENT constructs (compass and straightedge, or draws themselves), as facts the "
                "construction must make true. Its parts are never drawn in the figure; a point only the "
                "construction makes is not listed under points."
            ),
        },
    },
    "required": ["points", "givens"],
    "additionalProperties": False,
}

CONTEXT_FIELD: dict[str, Any] = {
    "type": "string",
    "enum": [""],  # filled below from CONTEXTS
    "description": "Optional, only with figure_facts: one setting sentence from the list, or empty.",
}
HINT_FIELD: dict[str, Any] = {
    "type": "string",
    "enum": ["", *()],  # filled below from HINTS
    "description": "Optional, only with figure_facts: one method hint from the list, or empty.",
}


# ── Reading the card ───────────────────────────────────────────────────

_NAME = re.compile(r"[A-Z][0-9]*'*")
_VARIABLE = re.compile(r"[a-z]")
# Kinds whose two-name items are segments of the figure (they are shown).
_SEGMENT_ITEMS = {
    "congruent_segments": slice(None), "equal_length": slice(None), "midpoint": slice(0, 1),
    "on_segment": slice(0, 1), "bisects_segment": slice(1, 2), "chord": slice(0, 1),
    "diameter": slice(0, 1), "radius": slice(0, 1),
}
_TRIANGLE_KINDS = ("congruent_triangles", "similar_triangles", "isosceles", "equilateral", "right_triangle")


def _fact_names(f: Fact) -> tuple[set[str], list[str]]:
    """(the point names a fact uses, the items it can't place)."""
    names: set[str] = set()
    bad: list[str] = []
    for x in f.items:
        x = x.strip()
        if f.kind == "numbered_angle" and x.isdigit():
            continue
        if re.fullmatch(r"\d+", x) and f.kind in (
                "congruent_angles", "vertical_angles", "linear_pair", "supplementary", "complementary",
                "angle_measure", "right_angle", *PAIRS):
            continue  # ∠1: a numbered angle, placed by its numbered_angle fact
        if _is_line_name(x) and not split_names(x):
            continue
        n = split_names(x)
        if not n:
            bad.append(x)
        names |= set(n)
    for p in (f.point, f.circle):
        if p:
            n = split_names(p)
            if len(n) != 1:
                bad.append(p)
            names |= set(n)
    return names, bad


def read_card(raw: Any) -> tuple[FigureFacts | None, list[str]]:
    """(the card, []) or (None, why it can't be held to). Plain code; the
    card the AI wrote is never trusted further than this checks. Anything
    unexpected (a crash included) refuses the card: fail closed."""
    try:
        return _read_card(raw)
    except Exception as e:  # noqa: BLE001 — a card code can't read is refused, never used
        return None, [f"the fact card couldn't be read ({type(e).__name__})"]


# What a fact must carry for its phrase to say it in full.
_MIN_ITEMS = {
    "parallel": 2, "perpendicular": 2, "congruent_segments": 2, "congruent_angles": 2, "congruent_triangles": 2,
    "similar_triangles": 2, "bisects_segment": 2, "bisects_angle": 2, "numbered_angle": 2, "intersect": 2,
    "transversal": 2, "opposite_rays": 2, "vertical_angles": 2, "linear_pair": 2, "supplementary": 2,
    "complementary": 2, "collinear": 3, **{k: 2 for k in PAIRS},
}
# Its phrase states only the first two items (a ⊥ b ⊥ c says nothing clear).
_EXACT_ITEMS = {"perpendicular": 2, "bisects_segment": 2, "bisects_angle": 2, "numbered_angle": 2}
_NEEDS_POINT = ("midpoint", "on_segment", "on_line", "intersect", "perpendicular")
_NEEDS_CIRCLE = ("on_circle", "tangent", "chord", "diameter", "radius", "central_angle", "inscribed_angle")
_LENGTH_KINDS = ("equal_length", "chord", "diameter", "radius")
_MIN_LENGTH = 0.01
# The shape of each item, per kind, so a phrase never reads backwards
# ("∠1 is labeled ∠ABC") or names a segment where a point goes.
_POINT_ITEMS = ("collinear", "on_circle")
_SEGMENT_KINDS = ("congruent_segments", "equal_length", "midpoint", "on_segment", "chord", "diameter", "radius")
_ANGLE_ITEM_KINDS = ("congruent_angles", "angle_measure", "right_angle", "vertical_angles", "linear_pair",
                     "supplementary", "complementary", "central_angle", "inscribed_angle", *PAIRS)
_STRAIGHT_KINDS = ("parallel", "perpendicular", "intersect", "transversal", "tangent", "opposite_rays")
_EXPR = re.compile(r"[0-9a-z+\-*/(). ]{1,40}")


def _is_angle_item(x: str) -> bool:
    return x.isdigit() or len(split_names(x)) in (1, 3)


def _is_straight_item(x: str) -> bool:
    return len(split_names(x)) == 2 or (_is_line_name(x) and not split_names(x))


def _bad_shape(f: Fact) -> bool:
    """An item that isn't the kind of part the fact's phrase says it is."""
    it = [x.strip() for x in f.items]
    k = f.kind
    if k in _POINT_ITEMS:
        return any(len(split_names(x)) != 1 for x in it)
    if k in _SEGMENT_KINDS:
        return any(len(split_names(x)) != 2 for x in it)
    if k in _ANGLE_ITEM_KINDS:
        return not all(_is_angle_item(x) for x in it)
    if k in _TRIANGLE_KINDS:
        return any(len(split_names(x)) != 3 for x in it)
    if k in _STRAIGHT_KINDS:
        return not all(_is_straight_item(x) for x in it)
    if k in SHAPES:
        return len(it) != 1 or len(split_names(it[0])) != 4
    if k == "bisects_segment":
        return len(it) != 2 or not _is_straight_item(it[0]) or len(split_names(it[1])) != 2
    if k == "bisects_angle":
        return len(it) != 2 or not _is_straight_item(it[0]) or not _is_angle_item(it[1]) or it[1].isdigit()
    if k == "numbered_angle":
        return len(it) != 2 or not it[0].isdigit() or len(split_names(it[1])) != 3
    return False
_ANGLE_KINDS = ("angle_measure", "central_angle", "inscribed_angle")
_MAX_LENGTH = 10_000.0


_TWO_LINE_KINDS = ("bisects_segment", "perpendicular", "intersect", "parallel")


def _same_line(f: Fact, it: list[str]) -> bool:
    """The fact's two lines are one line, so its sentence is nonsense (Eval 1:
    "MB bisects AB at M", with M on AB, is AB bisecting itself). Two lines
    sharing two points are one line; the fact's point lies on both; parallel
    lines share no point; an angle bisector isn't one of the angle's sides."""
    if f.kind in _TWO_LINE_KINDS and len(it) >= 2:
        p = {(f.point or "").strip()} - {""}
        a, b = set(split_names(it[0])) | p, set(split_names(it[1])) | p
        if len(a) < 2 or len(b) < 2:
            return False
        return len(a & b) >= (1 if f.kind == "parallel" else 2)
    if f.kind == "bisects_angle" and len(it) >= 2:
        ray, angle = split_names(it[0]), split_names(it[1])
        return len(ray) == 2 and len(angle) == 3 and ray[0] == angle[1] and ray[1] in (angle[0], angle[2])
    return False


def _incomplete(f: Fact) -> list[str]:
    """Why a fact can't be phrased in full (empty when it can)."""
    out: list[str] = []
    it = [x.strip() for x in f.items]
    if len(it) < _MIN_ITEMS.get(f.kind, 1) or (f.kind in _EXACT_ITEMS and len(it) != _EXACT_ITEMS[f.kind]):
        out.append(f"a fact has the wrong number of parts: {f.kind} {f.items}")
    if any(len(set(split_names(x))) != len(split_names(x)) for x in it):
        out.append(f"a fact names a part with a repeated point: {f.kind} {f.items}")
    if not out and _bad_shape(f):
        out.append(f"a fact's parts aren't the kind its sentence names: {f.kind} {f.items}")
    if f.expr is not None and not _EXPR.fullmatch(f.expr.strip()):
        out.append(f"a fact's expression isn't plain arithmetic: {f.kind} {f.expr!r}")
    if f.kind == "isosceles" and f.point and it and f.point.strip() not in split_names(it[0]):
        out.append(f"an isosceles triangle's apex isn't one of its vertices: {f.items} {f.point}")
    if f.kind in _NEEDS_POINT and not (f.point or "").strip():
        out.append(f"a fact needs its point: {f.kind} {f.items}")
    if f.kind in ("midpoint", "on_segment") and it and (f.point or "").strip() in split_names(it[0]):
        # "B is the midpoint of BD" (Eval 1 set1): a point is never inside a
        # segment it ends.
        out.append(f"a fact puts a point inside a segment it ends: {f.kind} {f.items} {f.point}")
    if not out and _same_line(f, it):
        out.append(f"a fact relates a line to itself: {f.kind} {f.items}")
    if f.kind in _NEEDS_CIRCLE and not (f.circle or "").strip():
        out.append(f"a fact needs its circle: {f.kind} {f.items}")
    if (f.kind == "angle_measure" or (f.kind == "equal_length" and len(it) == 1)) \
            and f.value is None and not (f.expr or "").strip():
        out.append(f"a fact needs its measure: {f.kind} {f.items}")
    if f.value is not None:
        v = float(f.value)
        if f.kind in _LENGTH_KINDS and not (math.isfinite(v) and _MIN_LENGTH <= v <= _MAX_LENGTH):
            out.append(f"a length must be a positive number: {f.kind} {f.items} = {f.value}")
        if f.kind in _ANGLE_KINDS and not (math.isfinite(v) and 0 < v < 360):
            out.append(f"an angle must be between 0° and 360°: {f.kind} {f.items} = {f.value}")
    return out


class _Classes:
    """Union-find: which keys the givens make equal."""

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


class _Measures:
    """What a card's givens state outright: the angles and lengths a given
    names itself, with a value. A find is refused only when a given states
    that very quantity; one written differently but the same is the same:

    - Rays: a ray is its vertex and a point on it. Every point the card puts
      on the same ray from a vertex (on_segment, midpoint, collinear in its
      listed order) maps to one representative, so ∠ABD is ∠ABC when D is on
      BC, and ∠CBA is ∠ABC.
    - A numbered angle is the angle it labels.
    - ∠B is ∠ABC only when the card has exactly one angle at B, counting
      the angles its shapes make there (two sides of a triangle, two
      segments or rays from B), the angles its statements name, and the
      asked angle; with two (∠ABD and ∠DBC) ∠B is only itself. Counting the
      asked angle too keeps the check symmetric: "m∠B given, find m∠ABC" and
      "m∠ABC given, find m∠B" get the same answer.
    - Values: a number on the fact (angle_measure, equal_length, radius…), or
      fixed with no number (a right angle, ⊥ at its point, a right
      triangle's right angle, an equilateral's 60°, a square's or
      rectangle's corners).

    Deliberately NOT here: equality reasoning (∠ABC ≅ ∠DEF with m∠DEF given;
    an equilateral's other side; a midpoint's other half). Finding those is
    one step, an exercise in its own right, not an answer the givens show."""

    def __init__(self, card: FigureFacts) -> None:
        every = [*card.givens, *card.prove, *card.constructs]
        self.labels = {f.items[0].strip(): f.items[1].strip() for f in every
                       if f.kind == "numbered_angle" and len(f.items) == 2}
        self.rays = _Classes()
        for f in [*card.givens, *card.constructs]:
            for a, m, b in _betweens(f):
                self.rays.union((a, m), (a, b))
                self.rays.union((b, m), (b, a))
        named: dict[str, set[Any]] = {}
        for x in [*_named_angles(card), *(t.item for t in card.find if t.kind == "angle")]:
            k = self._three(x)
            if k is not None:
                named.setdefault(k[1], set()).add(k)
        for k in self._drawn_angles(card):
            named.setdefault(k[1], set()).add(k)
        self.only = {v: next(iter(ks)) for v, ks in named.items() if len(ks) == 1}
        self.angle_values: dict[Any, set[float]] = {}
        self.known_segments: set[frozenset[str]] = set()
        for f in card.givens:
            it = [x.strip() for x in f.items]
            if f.value is not None and f.kind in _ANGLE_KINDS:
                for x in it:
                    self.angle_values.setdefault(self.angle(x), set()).add(float(f.value))
            if f.value is not None and f.kind in _LENGTH_KINDS:
                self.known_segments |= {frozenset(split_names(x)) for x in it}
            for x, deg in _fixed_values(f):
                self.angle_values.setdefault(self.angle(x), set()).add(deg)
        self.known_angles = set(self.angle_values)

    def _drawn_angles(self, card: FigureFacts) -> list[tuple[str, str, frozenset[Any]]]:
        """The angles the card's shapes make: at each point, every two rays
        from it along a segment, ray, line or side through it."""
        rays: dict[str, set[Any]] = {}

        def ray(v: str, x: str) -> Any:
            r = self.rays.find((v, x))
            rays.setdefault(v, set()).add(r)
            return r
        for x in [*card.segments, *card.lines]:
            n = split_names(x)
            if len(n) == 2 and n[0] != n[1]:
                ray(n[0], n[1])
                ray(n[1], n[0])
        for x in card.rays:
            n = split_names(x)
            if len(n) == 2 and n[0] != n[1]:
                ray(n[0], n[1])
        for x in [*card.triangles, *card.polygons]:
            corners = split_names(x)
            for i in range(len(corners)):
                a, b = corners[i], corners[(i + 1) % len(corners)]
                if a != b:
                    ray(a, b)
                    ray(b, a)
        for f in [*card.givens, *card.constructs]:
            for a, m, b in _betweens(f):
                ray(m, a)
                ray(m, b)
        out = []
        for v, rs in rays.items():
            ordered = sorted(rs, key=repr)
            out += [("A", v, frozenset((r1, r2))) for i, r1 in enumerate(ordered) for r2 in ordered[i + 1:]]
        return out

    def _three(self, x: str) -> tuple[str, str, frozenset[Any]] | None:
        n = split_names(self.labels.get(x.strip(), x.strip()))
        if len(n) != 3:
            return None
        v = n[1]
        return "A", v, frozenset((self.rays.find((v, n[0])), self.rays.find((v, n[2]))))

    def angle(self, x: str) -> Any:
        """One key per angle however it is written: ∠ABC as its vertex and
        two rays, ∠1 as the angle it labels, ∠B as the one angle the card
        names at B (else ∠B itself)."""
        k = self._three(x)
        if k is not None:
            return k
        x = self.labels.get(x.strip(), x.strip())
        n = split_names(x)
        if len(n) == 1:
            return self.only.get(n[0], ("V", n[0]))
        return "N", x

    def angle_known(self, x: str) -> bool:
        return self.angle(x) in self.known_angles

    def segment_known(self, x: str) -> bool:
        return frozenset(split_names(x)) in self.known_segments


def _named_angles(card: FigureFacts) -> list[str]:
    """Every three-letter angle the card's statements name (its givens,
    proves and constructs). A shape's corners come from its sides (see
    _Measures._drawn_angles)."""
    out: list[str] = []
    for f in [*card.givens, *card.prove, *card.constructs]:
        it = [x.strip() for x in f.items]
        if f.kind in _ANGLE_ITEM_KINDS:
            out += it
        if f.kind in ("bisects_angle", "numbered_angle") and len(it) == 2:
            out.append(it[1])
    return out


def _corners(poly: str) -> list[str]:
    """Each corner of a polygon as a three-letter angle, vertex in the middle."""
    v = split_names(poly)
    return ["".join((v[i - 1], v[i], v[(i + 1) % len(v)])) for i in range(len(v))] if len(v) >= 3 else []


def _betweens(f: Fact) -> list[tuple[str, str, str]]:
    """(a, m, b): m lies between a and b on one line, as the fact says."""
    it = [x.strip() for x in f.items]
    p = (f.point or "").strip()
    if f.kind in ("on_segment", "midpoint") and it and p and len(split_names(it[0])) == 2:
        a, b = split_names(it[0])
        return [(a, p, b)] if p not in (a, b) else []
    if f.kind == "collinear":
        pts = [x for x in it if len(split_names(x)) == 1]
        return [(pts[i], pts[j], pts[k]) for i in range(len(pts)) for j in range(i + 1, len(pts))
                for k in range(j + 1, len(pts))]
    return []


def _fixed_values(f: Fact) -> list[tuple[str, float]]:
    """The angles a fact fixes without a number, each with its degrees: a
    right angle, ⊥ at its point, a right triangle's right angle, a square's
    or rectangle's corners (90°), an equilateral triangle's corners (60°)."""
    it = [x.strip() for x in f.items]
    p = (f.point or "").strip()
    if f.kind == "right_angle":
        return [(x, 90.0) for x in it]
    if f.kind == "right_triangle" and it and p and p in split_names(it[0]) and len(set(split_names(it[0]))) == 3:
        t = split_names(it[0])
        a, b = (v for v in t if v != p)
        return [(a + p + b, 90.0)]
    if f.kind == "perpendicular" and len(it) == 2 and p:
        ends = [[q for q in split_names(x) if q != p] for x in it]
        return [(x, 90.0) for x in (["".join((a, p, b)) for a in ends[0] for b in ends[1]] or [p])]
    if f.kind in ("square", "rectangle") and it:
        return [(x, 90.0) for x in _corners(it[0])]
    if f.kind == "equilateral" and it:
        return [(x, 60.0) for x in _corners(it[0])]
    return []


def _fixed_angles(f: Fact) -> list[str]:
    """The angles a fact fixes without a number (see _fixed_values)."""
    return [x for x, _ in _fixed_values(f)]


# The kinds whose items are one polygon, the same however its name is
# rotated or reversed (△ABC is △BCA is △CBA).
_ONE_POLYGON = ("isosceles", "equilateral", "right_triangle", *SHAPES)
# The kinds whose items are in an order that matters: AB bisects CD is not
# CD bisects AB; ∠1 labels ∠ABC.
_ORDERED_KINDS = ("bisects_segment", "bisects_angle", "numbered_angle")
_CONGRUENT_KINDS = ("congruent_segments", "congruent_angles", "congruent_triangles")


def _polygon_key(x: str) -> tuple[str, ...]:
    """One name per polygon: the least of its rotations and reversals."""
    v = split_names(x)
    turns = [tuple(v[i:] + v[:i]) for i in range(len(v))]
    return min(turns + [tuple(reversed(t)) for t in turns]) if v else (x,)


def _item_key(m: _Measures, f: Fact, i: int, x: str) -> Any:
    """One key per item, by what the item is: an angle through the asks'
    canonicaliser, a segment by its ends, a polygon by its least name."""
    x = x.strip()
    if f.kind in _ANGLE_ITEM_KINDS or (f.kind in ("bisects_angle", "numbered_angle") and i == 1):
        return m.angle(x)
    if f.kind in _ONE_POLYGON:
        return _polygon_key(x)
    n = split_names(x)
    return frozenset(n) if len(n) == 2 else x


def _statement_key(m: _Measures, f: Fact) -> tuple[Any, ...]:
    """One key per statement however it is written. Congruent or similar
    triangles are their correspondence, a set of vertex pairs (△ABC ≅ △DEF
    is △BCA ≅ △EFD is △DEF ≅ △ABC); a transversal is its line and the set
    of lines it cuts; bisects_* and numbered_angle keep their order; every
    other kind's items are a set."""
    it = [x.strip() for x in f.items]
    body: Any
    if f.kind in ("congruent_triangles", "similar_triangles"):
        names = [split_names(x) for x in it]
        body = frozenset(frozenset(c) for c in zip(*names)) if names and len({len(n) for n in names}) == 1 \
            else tuple(it)
    elif f.kind == "transversal" and it:
        body = (_item_key(m, f, 0, it[0]), frozenset(_item_key(m, f, i, x) for i, x in enumerate(it) if i))
    else:
        items = [_item_key(m, f, i, x) for i, x in enumerate(it)]
        body = tuple(items) if f.kind in _ORDERED_KINDS else frozenset(items)
    return f.kind, body, (f.point or "").strip(), f.value, (f.expr or "").strip()


def _self_congruent(m: _Measures, f: Fact) -> bool:
    """A congruence of a part with itself (AB ≅ BA; ∠ABD ≅ ∠ABC with D on
    BC; △ABC ≅ △ABC): it says nothing."""
    if f.kind not in _CONGRUENT_KINDS or len(f.items) < 2:
        return False
    keys = [x.strip() for x in f.items] if f.kind == "congruent_triangles" \
        else [_item_key(m, f, i, x) for i, x in enumerate(f.items)]
    return len(set(keys)) < len(keys)


def _states_a_fixed_value(m: _Measures, f: Fact) -> bool:
    """A statement to prove that restates a value the givens fix, in other
    words: prove ∠ABC right (or m∠ABC = 90°, or AB ⊥ BC at B) when the
    givens already make ∠ABC 90°. The same value set as the finds."""
    if f.kind == "angle_measure" and f.value is not None:
        return all(float(f.value) in m.angle_values.get(m.angle(x), set()) for x in f.items)
    fixed = _fixed_values(f) if f.kind in ("right_angle", "perpendicular") else []
    return bool(fixed) and all(deg in m.angle_values.get(m.angle(x), set()) for x, deg in fixed)


def _already_given(card: FigureFacts) -> list[str]:
    """An ask a given states outright (see _Measures), or a statement to
    prove that is a given."""
    m = _Measures(card)
    givens = {_statement_key(m, g) for g in card.givens}
    out = [f"the card asks to prove a given: {f.kind} {f.items}" for f in card.prove
           if _statement_key(m, f) in givens or _states_a_fixed_value(m, f)]
    out += [f"the card says a part is congruent to itself: {f.kind} {f.items}"
            for f in [*card.givens, *card.prove] if _self_congruent(m, f)]
    for t in card.find:
        if t.kind == "segment" and m.segment_known(t.item):
            out.append(f"the card asks for a length it gives: {t.item!r}")
        if t.kind == "angle" and m.angle_known(t.item):
            out.append(f"the card asks for an angle it gives: {t.item!r}")
    return out


# Shapes whose words say which sides are parallel: both pairs of opposite
# sides. A trapezoid's words don't say which pair (its bases need their own
# parallel given), and a kite has none.
_PARALLEL_SIDED = ("parallelogram", "rectangle", "square", "rhombus")


def _piece(x: str) -> set[str]:
    """A straight piece as tokens: its points ("AB"), or its name ("~m")."""
    pts = split_names(x)
    if len(pts) >= 2:
        return set(pts)
    return {"~" + line_key(x)} if _is_line_name(x) else set()


def _line_groups(card: FigureFacts) -> list[set[str]]:
    """The points the card puts on one straight line: each segment, ray and
    line, grown by the facts that put a point on one (on_segment, midpoint,
    intersect, on_line m…). Pieces sharing two points, or a line's name
    ("~m"), are one line."""
    groups: list[set[str]] = []

    def same(g: set[str], h: set[str]) -> bool:
        return len(g & h) >= 2 or any(t.startswith("~") for t in g & h)

    def add(tokens: set[str]) -> None:
        if len(tokens) < 2 and not any(t.startswith("~") for t in tokens):
            return
        g = set(tokens)
        for h in [h for h in groups if same(g, h)]:
            groups.remove(h)
            g |= h
        groups.append(g)
        # The grown line may now meet another one it didn't before.
        for h in [h for h in groups if h is not g and same(g, h)]:
            groups.remove(g)
            groups.remove(h)
            add(g | h)
            return

    for x in (*card.segments, *card.rays, *card.lines, *card.named_lines):
        add(_piece(x))
    for f in [*card.givens, *card.prove, *card.constructs]:
        pt = {(f.point or "").strip()} - {""}
        if f.kind == "collinear":
            add({n for x in f.items for n in split_names(x)})
        elif f.kind in ("on_segment", "on_line", "on_ray", "midpoint") and f.items and pt:
            add(_piece(f.items[0]) | pt)
        elif f.kind in ("intersect", "bisects_segment", "perpendicular") and pt:
            for x in f.items:
                add(_piece(x) | pt)
        elif f.kind in ("parallel", "transversal", "congruent_segments"):
            for x in f.items:
                add(_piece(x))
    return groups


def _parallel_classes(card: FigureFacts, groups: list[set[str]]) -> list[list[set[str]]]:
    """The lines the card holds parallel, in classes: AB ∥ CD and CD ∥ EF put
    AB, CD and EF in one (#1003 review round 3). Each line is its group (or
    the bare piece when no group holds it)."""
    def line(tokens: set[str]) -> set[str]:
        return next((g for g in groups if tokens <= g), tokens)

    pairs: list[tuple[set[str], set[str]]] = []
    for f in [*card.givens, *card.prove]:
        if f.kind == "parallel" and len(f.items) == 2:
            x, y = (_piece(i) for i in f.items)
            if x and y:
                pairs.append((line(x), line(y)))
        elif f.kind in _PARALLEL_SIDED and f.items:
            q = split_names(f.items[0])
            if len(q) == 4:
                pairs += [(line({q[0], q[1]}), line({q[2], q[3]})), (line({q[1], q[2]}), line({q[3], q[0]}))]
    classes: list[list[set[str]]] = []
    for x, y in pairs:
        joined = [c for c in classes if any(m == x or m == y for m in c)]
        for c in joined:
            classes.remove(c)
        merged = [m for c in joined for m in c]
        merged += [m for m in (x, y) if not any(m == k for k in merged)]
        classes.append(merged)
    return classes


def _pair_on_its_parallels(card: FigureFacts, pair: Fact, groups: list[set[str]]) -> bool | None:
    """Whether the angle pair's own two lines (each angle's arm that doesn't
    run along the transversal, the line through the two vertices) are in
    one class of parallels the card gives, proves, or a parallel-sided shape
    gives. False only on evidence that they can't be; None when the names
    can't say (an angle by one letter or number, a point not placed)."""
    if len(pair.items) < 2 or any(len(split_names(a)) != 3 for a in pair.items[:2]):
        return None
    a1, a2 = (split_names(a) for a in pair.items[:2])

    def line(p: str, q: str) -> set[str]:
        return next((g for g in groups if {p, q} <= g), {p, q})

    trans = line(a1[1], a2[1])
    arms = []
    for a in (a1, a2):
        along = [e for e in (a[0], a[2]) if e in trans]
        if len(along) != 1:
            return None
        arms.append(line(a[1], a[2] if along[0] == a[0] else a[0]))
    l1, l2 = arms
    classes = _parallel_classes(card, groups)
    if any(l1 != l2 and any(m == l1 for m in c) and any(m == l2 for m in c) for c in classes):
        return True
    corners = [set(split_names(t)) for t in [*card.triangles, *card.polygons]]

    def apart(m: set[str], arm: set[str]) -> bool:
        """Known to be two lines: they share one point and three of their
        points are corners of one named triangle or polygon."""
        shared = m & arm
        return len(shared) == 1 and any(shared <= c and (m - shared) & c and (arm - shared) & c for c in corners)

    def known_off(arm: set[str], c: list[set[str]]) -> bool:
        return all(m != arm and apart(m, arm) for m in c)

    if classes and all(known_off(l1, c) or known_off(l2, c) for c in classes):
        return False
    return None


def pair_lines_unsaid(card: FigureFacts | dict[str, Any] | None) -> list[str]:
    """For a problem shipped with NO figure (the teacher's "the student
    draws it"): angle pairs named by points (∠JKM, ∠LMK) whose words don't
    put them on parallel lines the card gives (a parallel, a parallelogram's
    sides, a named line). With no drawing the student has only the words, so
    such a pair can't be used and the problem is refused (#1003 review).
    Numbered angles ("m ∥ n; ∠1 and ∠2 are alternate interior") are left to
    the words."""
    if card is None:
        return []
    if isinstance(card, dict):
        try:
            card = FigureFacts.model_validate(card)
        except ValidationError:
            return []
    groups = _line_groups(card)
    if not _parallel_classes(card, groups):
        return []
    return [f"no figure, and the words don't put {f.kind.replace('_', ' ')} {' and '.join(f.items[:2])} "
            f"on the parallel lines given"
            for f in card.givens
            if f.kind in PAIRS and len(f.items) >= 2 and all(len(split_names(a)) == 3 for a in f.items[:2])
            and _pair_on_its_parallels(card, f, groups) is not True]


def _pair_without_parallels(card: FigureFacts) -> list[str]:
    """An angle-pair given (alternate interior, corresponding…) only says
    where two angles sit; it says something about their sizes only when ITS
    two lines are the parallel ones. With no parallel lines given and none to
    prove, or with parallels on other lines ("∠JKM and ∠LMK are alternate
    interior; JM ∥ KL": #1003 review), a problem that leans on the pair can't
    be done, and its solution claims what the givens don't say (Eval 1 job
    bd113585 p5). Such a card is refused: the problem is replaced. A
    trapezoid gives no parallel here: its words don't say which sides."""
    out = []
    groups = _line_groups(card)
    for f in card.givens:
        if f.kind in PAIRS and _pair_on_its_parallels(card, f, groups) is False:
            out.append(f"an angle-pair given says nothing about sizes without parallel lines "
                       f"(its own two lines): {f.kind} {f.items}")
    if out or any(f.kind == "parallel" or f.kind in _PARALLEL_SIDED for f in [*card.givens, *card.prove]):
        return out
    return [f"an angle-pair given says nothing about sizes without parallel lines: {f.kind} {f.items}"
            for f in card.givens if f.kind in PAIRS]


def _blank_to_none(f: Any) -> Any:
    """A fact's empty optional field ("circle": "") read as absent; a
    perpendicular's missing point read from the one letter its two lines
    share (AB ⊥ BC meets at B). Else it stays missing, and is refused."""
    if not isinstance(f, dict):
        return f
    f = {k: (None if k in ("point", "circle", "expr", "value") and v == "" else v) for k, v in f.items()}
    items = f.get("items")
    if f.get("kind") == "perpendicular" and not f.get("point") and isinstance(items, list) and len(items) == 2 \
            and all(isinstance(x, str) for x in items):
        shared = set(split_names(items[0])) & set(split_names(items[1]))
        if len(shared) == 1 and all(len(split_names(x)) == 2 for x in items):
            f["point"] = shared.pop()
    return f


def _has_bool_value(raw: dict[str, Any]) -> bool:
    """A `true`/`false` where a number goes (pydantic would read it as 1/0)."""
    return any(isinstance(f, dict) and isinstance(f.get("value"), bool)
               for section in ("givens", "prove", "constructs") for f in (raw.get(section) or [])
               if isinstance(raw.get(section), list))


# The letters a written problem shows as variables: LaTeX commands and the
# m of m∠ taken out first.
def _shown_variables(texts: list[str], card: FigureFacts) -> set[str]:
    # Only inside the math: code's English ("is a right angle") has a's too.
    math_parts = " ".join(m for t in texts for m in re.findall(r"\$([^$]*)\$", t))
    joined = re.sub(r"m\\angle|\\[A-Za-z]+", " ", math_parts)
    named = {line_key(x) for x in card.named_lines}
    return {v for v in re.findall(r"(?<![A-Za-z])[a-z](?![A-Za-z])", joined)} - named


def _with_named_points(card: FigureFacts) -> FigureFacts:
    """The card's point list with every point its givens and parts name: the
    AI often names E and F in "BC ≅ EF" and leaves them off `points` (Eval 1:
    3 of 5 problems left out of the made-up sets). A named point is a point
    of the figure; the figure is still checked against every fact, so this
    never passes a wrong drawing. A point a construction step names is never
    added (only the student's construction makes it; a given that names it
    is still refused), nor one only a statement to prove names."""
    listed = [p.strip() for p in card.points]
    made: set[str] = set()
    for f in card.constructs:
        made |= _fact_names(f)[0]
    used: set[str] = set()
    for f in card.givens:
        names, bad = _fact_names(f)
        if not bad:
            used |= names
    for section in ("segments", "rays", "lines", "triangles", "polygons"):
        for x in getattr(card, section):
            used |= set(split_names(x))
    used |= {c.strip() for c in card.circles}
    missing = sorted(n for n in used - set(listed) - made if _NAME.fullmatch(n))
    return card.model_copy(update={"points": [*listed, *missing]}) if missing else card


def _read_card(raw: Any) -> tuple[FigureFacts | None, list[str]]:
    if not isinstance(raw, dict):
        return None, ["no fact card"]
    allowed = set(CARD_SCHEMA["properties"])
    extra = sorted(set(raw) - allowed)
    if extra:
        return None, [f"the fact card has fields it can't have: {', '.join(extra)}"]
    raw = {**raw, **{section: [_blank_to_none(f) for f in raw[section]]
                     for section in ("givens", "prove", "constructs") if isinstance(raw.get(section), list)}}
    if _has_bool_value(raw):
        return None, ["the fact card gives true/false where a number goes"]
    try:
        card = FigureFacts.model_validate({**raw, "source": "author", "requested": [], "dropped": []})
    except (ValidationError, ValueError) as e:
        return None, [f"the fact card is malformed ({str(e).splitlines()[0][:120]})"]
    card = _with_named_points(card)
    why: list[str] = []
    every = [*card.givens, *card.prove, *card.constructs]
    for f in every:
        if f.kind not in AUTHOR_KINDS:
            why.append(f"the fact card uses a kind the checker can't hold a figure to: {f.kind}")
    points = [p.strip() for p in card.points]
    if len(set(points)) != len(points) or any(not _NAME.fullmatch(p) for p in points):
        why.append("the fact card's points must each be one point name, listed once")
    shown = set(points)
    for section in ("segments", "rays", "lines", "triangles", "polygons"):
        for x in getattr(card, section):
            n = split_names(x)
            want = {"segments": 2, "rays": 2, "lines": 2, "triangles": 3}.get(section)
            if not n or (want and len(n) != want) or (section == "polygons" and len(n) < 4) \
                    or not set(n) <= shown or len(set(n)) != len(n):
                why.append(f"the fact card's {section[:-1]} {x!r} isn't made of its points")
    for c in card.circles:
        if c.strip() not in shown:
            why.append(f"the fact card's circle {c!r} isn't named by a center point it shows")
    named = {line_key(x) for x in card.named_lines}
    # Points only the student's construction makes: a statement to prove
    # may name them (it is about the construction), a given may not.
    made = made_points(card)
    for section, may_name in (("givens", shown), ("prove", shown | made)):
        for f in getattr(card, section):
            names, bad = _fact_names(f)
            if bad or not names <= may_name:
                why.append(f"a fact names a point the card doesn't show: {f.kind} {f.items}")
    for f in [*card.givens, *card.prove]:
        for x in f.items:
            if _is_line_name(x) and not split_names(x) and line_key(x) not in named:
                why.append(f"a fact names a line the card doesn't list: {x}")
        if f.circle is not None and f.circle.strip() not in {c.strip() for c in card.circles}:
            why.append(f"a fact names a circle the card doesn't list: {f.circle!r}")
        if not f.items:
            why.append(f"a fact names no part: {f.kind}")
    for f in card.constructs:
        names, bad = _fact_names(f)
        if bad or not f.items:
            why.append(f"a construction step names no part it can place: {f.kind} {f.items}")
        elif f.circle is not None and f.circle.strip() not in {c.strip() for c in card.circles}:
            why.append(f"a construction step names a circle the card doesn't list: {f.circle!r}")
        elif not (names - shown) and not any(
                _is_line_name(x) and not split_names(x) and line_key(x) not in named for x in f.items):
            # Everything it names is shown: the figure would show the
            # student's construction (or the step makes nothing).
            why.append(f"a construction step makes nothing the figure doesn't show: {f.kind} {f.items}")
    for f in every:
        why += _incomplete(f)
    numbers = {f.items[0].strip() for f in every if f.kind == "numbered_angle" and f.items}
    for f in every:
        if f.kind != "numbered_angle" and any(x.strip().isdigit() and x.strip() not in numbers for x in f.items):
            why.append(f"a fact names a numbered angle the card doesn't label: {f.kind} {f.items}")
    for t in card.find:
        if t.kind == "angle" and t.item.strip().isdigit() and t.item.strip() not in numbers:
            why.append(f"the card asks for an angle it doesn't label: {t.item!r}")
    why += _already_given(card)
    why += _pair_without_parallels(card)
    for t in card.find:
        if t.kind == "angle" and not (split_names(t.item) and set(split_names(t.item)) <= shown | made
                                      and len(split_names(t.item)) in (1, 3) or t.item.strip().isdigit()):
            why.append(f"the card asks for an angle it doesn't show: {t.item!r}")
        if t.kind == "segment" and not (len(split_names(t.item)) == 2 and set(split_names(t.item)) <= shown | made):
            why.append(f"the card asks for a segment it doesn't show: {t.item!r}")
        if t.kind == "other" and not _VARIABLE.fullmatch(t.item.strip()):
            why.append(f"the card asks for something code can't phrase: {t.item!r}")
    if not (card.prove or card.find or card.constructs):
        why.append("the fact card asks nothing: no prove, find or construct")
    if why:
        return None, list(dict.fromkeys(why))
    card = _with_shown_parts(card)
    card = card.model_copy(update={
        section: [f.model_copy(update={"quote": sentence(f, card)}) for f in getattr(card, section)]
        for section in ("givens", "prove", "constructs")
    })
    written = [f.quote for section in ("givens", "prove", "constructs") for f in getattr(card, section)]
    if any(re.search(r"\$\s*\$|=\s*\$|\{\s*\}", q) for q in written):
        return None, ["a fact's sentence came out incomplete"]
    # A variable to find must be in the givens: one only in a statement to
    # prove or a construction step leaves nothing to solve from.
    variables = _shown_variables([f.quote for f in card.givens], card)
    for t in card.find:
        if t.kind == "other" and t.item.strip() not in variables:
            # "Find x" with no x in the problem.
            why.append(f"the card asks for {t.item.strip()!r}, which its words never show")
    if why:
        return None, why
    cant = unverifiable(card)
    if cant:
        return None, [f"the checker can't verify “{c}”" for c in cant[:3]]
    impossible = impossible_measures(card)
    if impossible:
        return None, impossible[:2]
    return card, []


def _with_shown_parts(card: FigureFacts) -> FigureFacts:
    """The card with the triangles, polygons and segments its facts name
    added to its lists: a figure must draw what the problem's words name."""
    triangles, polygons, segments = list(card.triangles), list(card.polygons), list(card.segments)
    straight = {frozenset(split_names(x)) for x in (*card.lines, *card.rays)}
    made = made_points(card)

    def add(xs: list[str], x: str) -> None:
        if set(split_names(x)) & made:
            return  # a part of the student's construction: not shown
        if not any(set(split_names(y)) == set(split_names(x)) and len(split_names(y)) == len(split_names(x))
                   for y in xs):
            xs.append(x)

    for f in [*card.givens, *card.prove]:
        if f.kind in _TRIANGLE_KINDS:
            for x in f.items:
                if len(split_names(x)) == 3:
                    add(triangles, x)
        if f.kind in SHAPES and f.items:
            add(polygons, f.items[0])
        for x in f.items[_SEGMENT_ITEMS[f.kind]] if f.kind in _SEGMENT_ITEMS else []:
            if len(split_names(x)) == 2 and frozenset(split_names(x)) not in straight:
                add(segments, x)
        if f.kind in ("parallel", "perpendicular"):
            for x in f.items:
                if len(split_names(x)) == 2 and frozenset(split_names(x)) not in straight:
                    add(segments, x)
    return card.model_copy(update={"triangles": triangles, "polygons": polygons, "segments": segments})


def is_blank_card(raw: Any) -> bool:
    """A card with nothing in it (`{}`, or every field empty): no card at
    all, so a plain problem that came with one keeps its own words."""
    return isinstance(raw, dict) and all(v in (None, "", [], {}) for v in raw.values())


def unlisted_points(fig: Any, card: FigureFacts) -> list[str]:
    """Points the figure labels that the card doesn't list. The card lists
    every point the figure shows, so this catches the student's
    construction drawn under another letter (E at the bisector's foot)."""
    from api.core.geometry.dsl import is_hidden

    shown = {p.strip() for p in card.points}
    return [f"the figure draws {n}, which the problem doesn't have" for n in fig.points
            if n not in shown and not is_hidden(n)]


def made_points(card: FigureFacts) -> set[str]:
    """Points only the student's construction makes (never drawn)."""
    shown = {p.strip() for p in card.points}
    return set().union(*(_fact_names(f)[0] for f in card.constructs)) - shown if card.constructs else set()


def as_drawn(card: FigureFacts) -> FigureFacts:
    """The part of an author card the figure shows, which the checker holds
    it to: without what the student constructs, and without a statement to
    prove or a target about a part only the construction makes (it isn't
    drawn, so the figure can't show it true or false; the student proves it
    on their own drawing)."""
    made = made_points(card)
    if not made:
        return card

    def about_made(f: Fact) -> bool:
        return bool(_fact_names(f)[0] & made)

    def shown(xs: list[str]) -> list[str]:
        return [x for x in xs if not set(split_names(x)) & made]

    return card.model_copy(update={
        "prove": [f for f in card.prove if not about_made(f)],
        "find": [t for t in card.find if not set(split_names(t.item)) & made],
        **{k: shown(getattr(card, k)) for k in ("segments", "rays", "lines", "triangles", "polygons")},
    })


def student_constructs(card: FigureFacts | None) -> bool:
    """The card says the student constructs (draws) something."""
    return bool(card is not None and card.constructs)


def constructed_drawn(fig: Any, card: FigureFacts) -> list[str]:
    """Parts the student constructs that the figure draws anyway: a point
    only the construction makes, or a segment, ray or line a construction
    step names. Each is a reason the figure is not shown."""
    from api.core.geometry.dsl import is_hidden, split_points

    if not card.constructs:
        return []
    shown = {p.strip() for p in card.points}
    out: list[str] = []
    made: set[str] = set()
    pairs: set[frozenset[str]] = set()
    for f in card.constructs:
        names, _ = _fact_names(f)
        made |= names - shown
        for x in f.items:
            n = split_names(x)
            if len(n) == 2:
                pairs.add(frozenset(n))
    shown_pairs = {frozenset(split_names(x)) for x in (*card.segments, *card.rays, *card.lines)}
    for poly in (*card.triangles, *card.polygons):
        v = split_names(poly)
        shown_pairs |= {frozenset((v[i], v[(i + 1) % len(v)])) for i in range(len(v))}
    student_pairs = pairs - shown_pairs
    for name in sorted(made):
        if name in fig.points and not is_hidden(name):
            out.append(f"the figure draws {name}, which the student constructs")
    drawn = [split_points(s, 2) for s in fig.segments] + [split_points(r, 2) for r in fig.rays] + [
        tuple(ln.through) for ln in fig.lines]
    for a, b in drawn:
        if frozenset((a, b)) in student_pairs or ({a, b} & made):
            out.append(f"the figure draws {a}{b}, which the student constructs")
    return list(dict.fromkeys(out))


# ── Writing the problem from the card ──────────────────────────────────

def _pt(p: str) -> str:
    return p.strip()


def _line_tex(x: str) -> str:
    k = line_key(x)
    m = re.fullmatch(r"ell(\d*)", k)
    if m:
        return r"\ell" + (f"_{m.group(1)}" if m.group(1) else "")
    return k


def _straight(x: str, card: FigureFacts, *, default: str = "seg") -> str:
    """A straight part as the card shows it: a named line, a line, a ray or
    a segment."""
    if _is_line_name(x) and not split_names(x):
        return _line_tex(x)
    n = split_names(x)
    pair = frozenset(n)
    name = "".join(n)
    if any(frozenset(split_names(y)) == pair for y in card.lines):
        return rf"\overleftrightarrow{{{name}}}"
    if any(split_names(y) == n for y in card.rays) or default == "ray":
        return rf"\overrightarrow{{{name}}}"
    return rf"\overline{{{name}}}"


def _seg(x: str) -> str:
    return rf"\overline{{{''.join(split_names(x))}}}"


def _ang(x: str) -> str:
    x = x.strip()
    return rf"\angle {x}" if x.isdigit() else rf"\angle {''.join(split_names(x))}"


def _tri(x: str) -> str:
    return rf"\triangle {''.join(split_names(x))}"


def _num(v: float) -> str:
    return f"{v:g}"


def _unwrapped(expr: str) -> str:
    """An expression without one pair of parentheses around all of it: the
    AI writes "(3x + 5)" as often as "3x + 5", and the phrase adds its own
    pair, so the problem never reads "((3x + 5))°" (Eval 1 job bd113585 p2)."""
    e = expr.strip()
    if not (e.startswith("(") and e.endswith(")")):
        return e
    depth = 0
    for i, ch in enumerate(e):
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if depth == 0 and i < len(e) - 1:
            return e  # "(a) + (b)": the first pair closes early
    return e[1:-1].strip()


def _measure(f: Fact) -> str:
    if f.value is not None:
        return f"{_num(f.value)}^\\circ"
    return f"({_unwrapped(f.expr)})^\\circ" if f.expr else ""


def _length(f: Fact) -> str:
    if f.value is not None:
        return _num(f.value)
    return f.expr or ""


def _m(s: str) -> str:
    return f"${s}$"


def _and(parts: list[str]) -> str:
    if len(parts) <= 2:
        return " and ".join(parts)
    return ", ".join(parts[:-1]) + ", and " + parts[-1]


def _len_name(x: str) -> str:
    return "".join(split_names(x))


def sentence(f: Fact, card: FigureFacts) -> str:
    """One fixed phrase per fact kind, in the problem's LaTeX notation."""
    k, it, p = f.kind, [x.strip() for x in f.items], _pt(f.point or "")
    first = it[0] if it else ""
    circle = f"circle ${_pt(f.circle or '')}$"
    if k == "parallel":
        return _m(r" \parallel ".join(_straight(x, card) for x in it))
    if k == "perpendicular":
        at = f" at ${p}$" if p else ""
        return _m(r" \perp ".join(_straight(x, card) for x in it[:2])) + at
    if k == "congruent_segments":
        return _m(r" \cong ".join(_seg(x) for x in it))
    if k == "congruent_angles":
        return _m(r" \cong ".join(_ang(x) for x in it))
    if k == "equal_length":
        size = _length(f)
        return _m(" = ".join([*(_len_name(x) for x in it), *([size] if size else [])]))
    if k == "angle_measure":
        return _m(rf"m{_ang(first)} = {_measure(f)}")
    if k == "right_angle":
        return f"{_m(_ang(first))} is a right angle"
    if k == "midpoint":
        return f"${p}$ is the midpoint of {_m(_seg(first))}"
    if k == "on_segment":
        return f"${p}$ is on {_m(_seg(first))}"
    if k == "on_line":
        return f"${p}$ is on {_m(_straight(first, card))}" if not _is_line_name(first) or split_names(first) \
            else f"${p}$ is on line ${_line_tex(first)}$"
    if k == "collinear":
        return f"Points {_and([_m(x) for x in it])} are collinear"
    if k == "intersect":
        return f"{_and([_m(_straight(x, card)) for x in it])} intersect at ${p}$"
    if k == "bisects_segment":
        at = f" at ${p}$" if p else ""
        return f"{_m(_straight(first, card))} bisects {_m(_seg(it[1]))}{at}"
    if k == "bisects_angle":
        return f"{_m(_straight(first, card, default='ray'))} bisects {_m(_ang(it[1]))}"
    if k == "opposite_rays":
        return f"{_and([_m(_straight(x, card, default='ray')) for x in it])} are opposite rays"
    if k in ("vertical_angles", "linear_pair", "supplementary", "complementary"):
        what = {"vertical_angles": "are vertical angles", "linear_pair": "form a linear pair",
                "supplementary": "are supplementary", "complementary": "are complementary"}[k]
        return f"{_and([_m(_ang(x)) for x in it])} {what}"
    if k in PAIRS:
        return f"{_and([_m(_ang(x)) for x in it])} are {k.replace('_', ' ').replace('same side', 'same-side')} angles"
    if k == "congruent_triangles":
        return _m(r" \cong ".join(_tri(x) for x in it))
    if k == "similar_triangles":
        return _m(r" \sim ".join(_tri(x) for x in it))
    if k == "isosceles":
        t = split_names(first)
        if p and p in t:
            o1, o2 = (v for v in t if v != p)
            return f"{_m(_tri(first))} is isosceles with {_m(_seg(p + o1) + r' \cong ' + _seg(p + o2))}"
        return f"{_m(_tri(first))} is isosceles"
    if k == "equilateral":
        return f"{_m(_tri(first))} is equilateral"
    if k == "right_triangle":
        if p:
            return f"{_m(_tri(first))} has a right angle at ${p}$"
        return f"{_m(_tri(first))} is a right triangle"
    if k in SHAPES:
        name = k.replace("_", " ")
        return f"${''.join(split_names(first))}$ is {'an' if name[0] in 'aeiou' else 'a'} {name}"
    if k == "on_circle":
        lie = "lie" if len(it) > 1 else "lies"
        lead = "Points " if len(it) > 1 else "Point "
        return f"{lead}{_and([_m(x) for x in it])} {lie} on {circle}"
    if k == "tangent":
        at = f" at ${p}$" if p else ""
        return f"{_m(_straight(first, card, default='line'))} is tangent to {circle}{at}"
    if k in ("chord", "diameter", "radius"):
        size = f", and ${_len_name(first)} = {_length(f)}$" if (f.value is not None or f.expr) else ""
        return f"{_m(_seg(first))} is a {k} of {circle}{size}"
    if k in ("central_angle", "inscribed_angle"):
        size = f", and ${'m' + _ang(first)} = {_measure(f)}$" if (f.value is not None or f.expr) else ""
        what = "a central angle of" if k == "central_angle" else "inscribed in"
        return f"{_m(_ang(first))} is {what} {circle}{size}"
    if k == "numbered_angle":
        return f"{_m(_ang(it[1]))} is labeled {_m(_ang(first))}"
    if k == "transversal":
        return f"{_m(_straight(first, card, default='line'))} is a transversal of " \
               f"{_and([_m(_straight(x, card, default='line')) for x in it[1:]])}"
    raise ValueError(f"no phrase for {k}")


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s and not s.startswith("$") else s


def _target(t: Target) -> str:
    if t.kind == "angle":
        return _m("m" + _ang(t.item))
    if t.kind == "segment":
        return _m(_len_name(t.item))
    return _m(t.item.strip())


def _unnamed_shown(card: FigureFacts) -> list[str]:
    """The figure's parts no given, statement to prove or target names: the
    text points the student at them ("The figure shows △ABC and AD")."""
    said = " ".join(sentence(f, card) for f in [*card.givens, *card.prove]) + " " + " ".join(
        _target(t) for t in card.find)
    out: list[str] = []
    for t in card.triangles:
        if _tri(t) not in said:
            out.append(_m(_tri(t)))
    for poly in card.polygons:
        name = "".join(split_names(poly))
        if f"${name}$" not in said:
            out.append(f"quadrilateral ${name}$" if len(split_names(poly)) == 4 else f"polygon ${name}$")
    for x in card.segments:
        n = "".join(split_names(x))
        inside_polygon = any(
            frozenset(split_names(x)) in {frozenset((v[i], v[(i + 1) % len(v)])) for i in range(len(v))}
            for v in (split_names(q) for q in (*card.triangles, *card.polygons)))
        if not inside_polygon and n not in said and n[::-1] not in said:
            out.append(_m(_seg(x)))
    for x in card.rays:
        if "".join(split_names(x)) not in said:
            out.append(_m(rf"\overrightarrow{{{''.join(split_names(x))}}}"))
    for x in card.lines:
        if "".join(split_names(x)) not in said:
            out.append(_m(rf"\overleftrightarrow{{{''.join(split_names(x))}}}"))
    for c in card.circles:
        if f"circle ${c.strip()}$" not in said:
            out.append(f"circle ${c.strip()}$")
    return out


def _said_once(card: FigureFacts) -> list[str]:
    """The givens' sentences, each said once: a given another one already
    says is left out of the words (it stays on the card, so the figure is
    still checked against it). Eval 1 set4 read "△ABC is isosceles with
    AB ≅ AC, AB ≅ AC" and "M is the midpoint of BC, and M is on BC".
    Restated: the same sentence twice, a point on a segment it is the
    midpoint of, two segments an isosceles given already marks equal."""
    def seg(x: str) -> frozenset[str]:
        return frozenset(split_names(x.strip()))

    midpoints = {((f.point or "").strip(), seg(f.items[0])) for f in card.givens
                 if f.kind == "midpoint" and f.items}
    legs = set()
    for f in card.givens:
        t, apex = split_names(f.items[0]) if f.kind == "isosceles" and f.items else [], (f.point or "").strip()
        if apex and apex in t and len(t) == 3:
            legs.add(frozenset(frozenset((apex, v)) for v in t if v != apex))
    out: list[str] = []
    seen: list[object] = []
    for f in card.givens:
        if f.kind == "on_segment" and f.items and ((f.point or "").strip(), seg(f.items[0])) in midpoints:
            continue
        if f.kind == "congruent_segments" and len(f.items) == 2 and frozenset(seg(x) for x in f.items) in legs:
            continue
        # A segment by its two points, a named line by its name ("m ∥ n" and
        # "p ∥ q" are two givens: #1003 review).
        same = (f.kind, frozenset(lin(x) for x in f.items), (f.point or "").strip(), f.value, f.expr) \
            if f.kind in ("congruent_segments", "parallel") else sentence(f, card)
        if same not in seen:
            seen.append(same)
            out.append(sentence(f, card))
    return out


def card_text(card: FigureFacts, *, context: str = "", hint: str = "", figure: bool = True) -> str:
    """The problem the student reads: the context sentence (when kept), what
    the figure shows that no given names, the givens, the ask, the hint.
    With `figure` False (no figure goes with it: a teacher says the student
    draws it) the parts the figure would show are for the student to draw."""
    out: list[str] = []
    if context:
        out.append(context)
    shown = _unnamed_shown(card)
    if shown:
        out.append(f"The figure shows {_and(shown)}." if figure else f"Draw {_and(shown)}.")
    givens = _said_once(card)
    if card.prove and givens:
        out.append(f"Given: {_and(givens)}.")
    elif givens:
        out += [f"{_cap(g)}." for g in givens]
    if card.constructs:
        out.append(f"Make a construction so that {_and([sentence(f, card) for f in card.constructs])}.")
    if card.prove:
        out.append(f"Prove: {_and([sentence(f, card) for f in card.prove])}.")
    if card.find:
        out.append(f"Find {_and([_target(t) for t in card.find])}.")
    if hint:
        out.append(f"Hint: {hint}")
    return " ".join(out)


# The settings a problem may open with: a closed list (the schema's enum),
# kept by exact match, like HINTS. A free sentence can't be checked: any
# word list misses a form or a synonym ("perpendicularly", "plumb",
# "twin beams"), and a setting that says a number, a relation or a shape
# says what the card may not. Each of these says none.
CONTEXTS: tuple[str, ...] = (
    "A carpenter is building a roof frame.",
    "A city planner is laying out a park.",
    "An architect is designing a library.",
    "An engineer is designing a bridge.",
    "A gardener is planning a flower bed.",
    "A landscaper is planning a backyard.",
    "A surveyor is mapping a field.",
    "A builder is framing a house.",
    "A furniture maker is building a table.",
    "A designer is making a logo.",
    "An artist is painting a mural.",
    "A coach is laying out a practice field.",
    "A family is planning a garden.",
    "A crew is repairing a fence.",
    "A pilot is planning a flight.",
    "A hiker is reading a trail map.",
    "A team is building a set for a school play.",
    "A baker is decorating a cake.",
    "A student is planning a science fair booth.",
    "A town is planning a new playground.",
)
CONTEXT_FIELD["enum"] = ["", *CONTEXTS]


def _one_of(text: Any, choices: tuple[str, ...]) -> str:
    """The choice the text is, exactly (its final period optional), or ""."""
    s = " ".join(str(text or "").split())
    for c in choices:
        if s and (s == c or s == c.rstrip(".")):
            return c
    return ""


def clean_context(context: Any) -> tuple[str, str]:
    """(the context sentence to keep, why it was left out): one of CONTEXTS."""
    if not " ".join(str(context or "").split()):
        return "", ""
    kept = _one_of(context, CONTEXTS)
    return (kept, "") if kept else ("", "the context isn't one of the fixed settings")


# The hints a problem may carry: a closed list (the schema's enum), kept by
# membership. Each is a method that makes no claim about the figure: a
# theorem's name ("Use SAS.") claims the givens support it, which code can't
# check, so none is listed. Free text can't be checked at all.
HINTS: tuple[str, ...] = (
    "Work backward from what you need to prove.",
    "List what you know, then what you need.",
    "Look for a theorem that links the givens to what you need.",
)
HINT_FIELD["enum"] = ["", *HINTS]
_PROVE_HINTS = ("Work backward from what you need to prove.",)


def clean_hint(hint: Any, card: FigureFacts | None = None) -> tuple[str, str]:
    """(the hint to keep, why it was left out): one of HINTS, and one that
    speaks of proving only on a card with something to prove. Without the
    card such a hint isn't kept (fail closed)."""
    if not " ".join(str(hint or "").split()):
        return "", ""
    kept = _one_of(hint, HINTS)
    if not kept:
        return "", "the hint isn't one of the fixed method hints"
    if kept in _PROVE_HINTS and not (card is not None and card.prove):
        return "", "the hint speaks of proving, and the problem has nothing to prove"
    return kept, ""
