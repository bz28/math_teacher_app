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
    "description": (
        "Optional, only with figure_facts: one plain sentence of setting before the givens ('A carpenter "
        "is building a roof truss.'). No point names, no numbers, no math, no relation (parallel, equal, "
        "right…): the givens say all of that. Omit when there is none."
    ),
}
HINT_FIELD: dict[str, Any] = {
    "type": "string",
    "description": (
        "Optional, only with figure_facts: a hint on method or theorem ('Look for a pair of congruent "
        "triangles.'). No point names, no numbers, no math, and no instruction to draw or construct."
    ),
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
_NEEDS_POINT = ("midpoint", "on_segment", "on_line", "intersect")
_NEEDS_CIRCLE = ("on_circle", "tangent", "chord", "diameter", "radius", "central_angle", "inscribed_angle")
_LENGTH_KINDS = ("equal_length", "chord", "diameter", "radius")
_ANGLE_KINDS = ("angle_measure", "central_angle", "inscribed_angle")
_MAX_LENGTH = 10_000.0


def _incomplete(f: Fact) -> list[str]:
    """Why a fact can't be phrased in full (empty when it can)."""
    out: list[str] = []
    it = [x.strip() for x in f.items]
    if len(it) < _MIN_ITEMS.get(f.kind, 1) or (f.kind in _EXACT_ITEMS and len(it) != _EXACT_ITEMS[f.kind]):
        out.append(f"a fact has the wrong number of parts: {f.kind} {f.items}")
    if any(len(set(split_names(x))) != len(split_names(x)) for x in it):
        out.append(f"a fact names a part with a repeated point: {f.kind} {f.items}")
    if f.kind in _NEEDS_POINT and not (f.point or "").strip():
        out.append(f"a fact needs its point: {f.kind} {f.items}")
    if f.kind in _NEEDS_CIRCLE and not (f.circle or "").strip():
        out.append(f"a fact needs its circle: {f.kind} {f.items}")
    if (f.kind == "angle_measure" or (f.kind == "equal_length" and len(it) == 1)) \
            and f.value is None and not (f.expr or "").strip():
        out.append(f"a fact needs its measure: {f.kind} {f.items}")
    if f.value is not None:
        v = float(f.value)
        if f.kind in _LENGTH_KINDS and not (math.isfinite(v) and 0 < v <= _MAX_LENGTH):
            out.append(f"a length must be a positive number: {f.kind} {f.items} = {f.value}")
        if f.kind in _ANGLE_KINDS and not (math.isfinite(v) and 0 < v < 360):
            out.append(f"an angle must be between 0° and 360°: {f.kind} {f.items} = {f.value}")
    return out


def _has_bool_value(raw: dict[str, Any]) -> bool:
    """A `true`/`false` where a number goes (pydantic would read it as 1/0)."""
    return any(isinstance(f, dict) and isinstance(f.get("value"), bool)
               for section in ("givens", "prove", "constructs") for f in (raw.get(section) or [])
               if isinstance(raw.get(section), list))


# The letters a written problem shows as variables: LaTeX commands and the
# m of m∠ taken out first.
def _shown_variables(texts: list[str], card: FigureFacts) -> set[str]:
    joined = re.sub(r"m\\angle|\\[A-Za-z]+", " ", " ".join(texts))
    named = {line_key(x) for x in card.named_lines}
    return {v for v in re.findall(r"(?<![A-Za-z])[a-z](?![A-Za-z])", joined)} - named


def _read_card(raw: Any) -> tuple[FigureFacts | None, list[str]]:
    if not isinstance(raw, dict):
        return None, ["no fact card"]
    allowed = set(CARD_SCHEMA["properties"])
    extra = sorted(set(raw) - allowed)
    if extra:
        return None, [f"the fact card has fields it can't have: {', '.join(extra)}"]
    if _has_bool_value(raw):
        return None, ["the fact card gives true/false where a number goes"]
    try:
        card = FigureFacts.model_validate({**raw, "source": "author", "requested": [], "dropped": []})
    except (ValidationError, ValueError) as e:
        return None, [f"the fact card is malformed ({str(e).splitlines()[0][:120]})"]
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
    variables = _shown_variables(written, card)
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


def _measure(f: Fact) -> str:
    if f.value is not None:
        return f"{_num(f.value)}^\\circ"
    return f"({f.expr})^\\circ" if f.expr else ""


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
    givens = [sentence(f, card) for f in card.givens]
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


# A word or symbol that states something about a figure: kept out of the
# context and the hint, which code can't check.
_STATES = re.compile(
    r"[=≅∥⊥∼≈°$\\∠△⊙]|\d"
    r"|\b(?:parallel|perpendicular|congruent|equal|same|bisect\w*|midpoint|degrees?|right|acute|obtuse|"
    r"isosceles|equilateral|scalene|square|rectangle|rhomb\w*|trapez\w*|kite|parallelogram|tangent|chord|"
    r"diameter|radius|radii|inscribed|central|half|twice|double|longer|shorter|shortest|longest|vertical|"
    r"supplementary|complementary|similar|straight|collinear|meet\w*|cross\w*|intersect\w*|\w*angular|circular|round|oval|curved)\b",
    re.IGNORECASE,
)
_DRAWS = re.compile(r"\b(?:draw\w*|construct\w*|sketch\w*|graph\w*|plot\w*|shade\w*)\b", re.IGNORECASE)


def _names_a_point(s: str) -> bool:
    """A capital that is a name, not a sentence's first word or 'I'."""
    for m in re.finditer(r"(?<![A-Za-z\\])[A-Z][0-9]*'*(?![a-z])", s):
        if m.group(0) in ("A", "I") and re.match(r"[A-Z]\s+[a-z]", s[m.start():]):
            continue
        return True
    return False


def clean_context(context: Any) -> tuple[str, str]:
    """(the context sentence to keep, why it was left out)."""
    s = " ".join(str(context or "").split())
    if not s:
        return "", ""
    if _names_a_point(s) or _STATES.search(s):
        return "", "the context named a point or stated something about the figure"
    if not s.endswith((".", "!", "?")):
        s += "."
    return s, ""


def clean_hint(hint: Any) -> tuple[str, str]:
    """(the hint to keep, why it was left out)."""
    s = " ".join(str(hint or "").split())
    if not s:
        return "", ""
    if _names_a_point(s) or re.search(r"[=≅∥⊥∼≈°$\\∠△⊙]|\d", s):
        return "", "the hint named a point or gave a number"
    if _DRAWS.search(s):
        return "", "the hint asked the student to draw"
    if not s.endswith((".", "!", "?")):
        s += "."
    return s, ""
