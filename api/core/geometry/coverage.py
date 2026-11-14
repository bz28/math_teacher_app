"""Coverage as an allowlist: does a reading account for everything the
problem says?

The problem's text is cut into tokens (point names, numbers, symbols,
words). Every token must be accounted for, or it is a gap and the problem
is refused (no figure can be trusted to show what was never read):

1. by a fact the checker verifies, when the token lies inside that fact's
   quote (an exact run of the text) and the fact uses it: a name the fact
   uses in that role ("at C": C is the fact's vertex), a number that is the
   fact's ("= 7": the fact's value), a word or symbol of the fact's own
   relation (∥ / "parallel" for a parallel fact). A quote holding more than
   its fact uses accounts for none of the rest;
2. by what is asked: the target phrase of a question ("m∠A", "the length
   of AB", "the shaded area"), nothing else in its sentence;
3. by what code reads itself: a shaded region ("△ABD is shaded"),
   coordinates ("A(0, 0)"), a part to draw that the reading lists ("draw
   AD"), a triangle, polygon or circle the reading lists, named as one
   ("In △ABC", "quadrilateral ABCD", "circle O"), and a triangle's angles
   adding up to 180° (always true); the words of a method ("by SAS");
4. by being INERT: a short reviewed list of words that state nothing about
   a figure (articles, "is", "of", "find" …) and punctuation.

A word that says something about a figure ("shaded", "longest", "part",
"opposite", "diameter", "middle", "on", "at" …) is never inert. A clause
that repeats an earlier one exactly is accounted for when that one is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from api.core.geometry.facts import (
    _ANGLE_SUM,
    _FRACTIONS,
    _LIST_MARK,
    Fact,
    FigureFacts,
    _angle_sum_of_triangle,
    _clauses,
    _closure,
    _fact_atoms,
    _fraction_value,
    _question_spans,
    _restated,
    line_key,
    seg,
    split_names,
)

# ── The allowlist ─────────────────────────────────────────────────────
# Words that state nothing about the figure. Keep this short: every word
# here is one the checker never has to see. Not here, on purpose: "on",
# "at", "between", "through" (they place points), and every shape,
# size, position or shading word.
INERT_WORDS = frozenset({
    # articles, linking verbs, conjunctions
    "a", "an", "the", "is", "are", "be", "has", "have", "and", "of", "in", "with", "that", "if", "then", "also",
    "its",
    # pointing at the problem's figure
    "given", "let", "figure", "diagram", "below", "above", "shown",
    # asking
    "find", "what", "determine", "calculate", "compute", "solve", "prove", "show", "verify", "write",
    # the type of a named part (the name itself must still be accounted for)
    "point", "points", "segment", "segments", "line", "lines", "ray", "rays", "side", "sides", "angle", "angles",
    "triangle", "triangles", "vertex", "vertices",
})
_QUESTION_VERBS = frozenset({"find", "determine", "calculate", "compute", "solve", "prove", "show", "verify"})
# Inside a question's target only: what is asked of the named part.
TARGET_WORDS = frozenset({
    "length", "lengths", "measure", "measures", "value", "values", "area", "perimeter", "circumference",
    "distance", "coordinates", "for",  # "solve for x"
})

# ── Each fact kind's own words and symbols ────────────────────────────
_EQ = "sym:="
_DEG = "sym:°"
_RIGHT = ("right", _DEG)
_MEASURE = ("measure", "measures", "equals", "degrees", "degree", "at", _DEG, _EQ)  # "the angle at A"
_LENGTH = ("length", "lengths", "long", "measures", "equals", "equal", "units", "unit", "cm", "mm", "ft", "feet",
           "inches", "meters", _EQ)
VOCAB: dict[str, frozenset[str]] = {k: frozenset(v) for k, v in {
    "parallel": ("parallel", "sym:parallel"),
    "perpendicular": ("perpendicular", "sym:perp", "altitude", "to", "at", *_RIGHT),
    "congruent_segments": ("congruent", "sym:cong", "equal", "same", *_LENGTH),
    "congruent_angles": ("congruent", "sym:cong", "equal", "same", *_MEASURE),
    "equal_length": ("equal", *_LENGTH),
    "angle_measure": _MEASURE,
    "midpoint": ("midpoint", _EQ),
    "on_segment": ("on", "lies", "lie", "between"),
    "on_line": ("on", "lies", "lie"),
    "collinear": ("collinear",),
    "intersect": ("intersect", "intersects", "intersection", "meet", "meets", "meeting", "at"),
    "bisects_segment": ("bisects", "bisect", "bisected", "bisector", "midpoint", "at"),
    "bisects_angle": ("bisects", "bisect", "bisected", "bisector"),
    "right_angle": ("perpendicular", "sym:perp", "at", *_RIGHT, *_MEASURE),
    "opposite_rays": ("opposite",),
    "vertical_angles": ("vertical",),
    "linear_pair": ("linear", "pair", "form", "forms"),
    "supplementary": ("supplementary", _EQ, _DEG, "sym:+"),
    "complementary": ("complementary", _EQ, _DEG, "sym:+"),
    "congruent_triangles": ("congruent", "sym:cong"),
    "similar_triangles": ("similar", "sym:sim"),
    "isosceles": ("isosceles", _EQ, "sym:cong"),
    "equilateral": ("equilateral",),
    "right_triangle": ("right", "at"),
    "parallelogram": ("parallelogram",),
    "rectangle": ("rectangle",),
    "square": ("square",),
    "rhombus": ("rhombus",),
    "trapezoid": ("trapezoid",),
    "isosceles_trapezoid": ("isosceles", "trapezoid"),
    "kite": ("kite",),
    "on_circle": ("on", "lie", "lies", "circle", "sym:odot"),
    "tangent": ("tangent", "to", "at"),
    "chord": ("chord",),
    "diameter": ("diameter", _EQ),
    "radius": ("radius", "radii", _EQ),
    "central_angle": ("central", *_MEASURE),
    "inscribed_angle": ("inscribed", *_MEASURE),
    "numbered_angle": (),
    "transversal": ("transversal", "cuts", "cut", "cutting", "intersects", "at", "by"),
    "alternate_interior": ("alternate", "interior"),
    "alternate_exterior": ("alternate", "exterior"),
    "corresponding": ("corresponding",),
    "same_side_interior": ("same-side", "same", "consecutive", "interior"),
    "interior_ray": ("interior", "lies"),
    "extension": ("extended", "extend", "extends", "extending", "beyond", "past", "through", "to"),
    "obtuse_angle": ("obtuse",),
    "acute_angle": ("acute",),
    "obtuse_triangle": ("obtuse",),
    "acute_triangle": ("acute",),
    "scalene": ("scalene",),
}.items()}
# Numbers a kind states without saying them: a right angle is 90°.
_IMPLIED = {"right_angle": 90.0, "perpendicular": 90.0, "rectangle": 90.0, "square": 90.0, "right_triangle": 90.0,
            "complementary": 90.0, "supplementary": 180.0, "linear_pair": 180.0}
# Kinds whose three-letter items are angles (vertex in the middle) or triangles.
_ANGLE_KINDS = frozenset({"angle_measure", "congruent_angles", "right_angle", "inscribed_angle", "central_angle",
                          "bisects_angle", "acute_angle", "obtuse_angle", "vertical_angles", "linear_pair",
                          "supplementary", "complementary", "alternate_interior", "alternate_exterior",
                          "corresponding", "same_side_interior", "numbered_angle", "interior_ray"})
_POLY_KINDS = frozenset({"congruent_triangles", "similar_triangles", "isosceles", "equilateral", "right_triangle",
                         "acute_triangle", "obtuse_triangle", "scalene", "parallelogram", "rectangle", "square",
                         "rhombus", "trapezoid", "isosceles_trapezoid", "kite"})
# Words that name a listed polygon by its number of corners.
_POLY_WORDS = {"quadrilateral": 4, "pentagon": 5, "hexagon": 6, "polygon": 0}
# A method's name, accounted for only from this list, matched whole
# (with the verb that applies it: "by", "using", "use", "apply"). Each
# name was reviewed against "does it assert anything about THIS figure?":
# only names that hold for any figure the rest of the problem states are
# here. Not here, on purpose, because applying them asserts a relation:
# the Alternate Interior / Corresponding Angles theorems (parallel lines),
# the Vertical Angles Theorem (vertical angles), the Base Angles and
# Isosceles Triangle theorems (isosceles), the Pythagorean Theorem (a
# right angle), the Exterior Angle Theorem, the Angle / Segment Addition
# postulates (a ray inside, a point between), HL (right triangles), SSA,
# "definition of midpoint / bisector / perpendicular", "properties of …".
METHOD_NAMES: tuple[tuple[str, str], ...] = (
    (r"(?:the )?(?:corollary to the )?triangle sum theorem", "any triangle's angles add to 180° (1c9d21ab, df891226)"),
    (r"(?:the )?reflexive property(?: of (?:congruence|equality))?", "a part equals itself (dd7ab4c1)"),
    (r"(?:the )?(?:transitive|substitution|symmetric) property(?: of (?:congruence|equality))?", "algebra"),
    (r"(?:the )?(?:SSS|SAS|ASA|AAS) (?:congruence )?(?:postulate|theorem)", "a congruence method (afee316c)"),
    (r"(?:SSS|SAS|ASA|AAS|AA|CPCTC|CPCF)\b", "a congruence / similarity method by its letters (589e4a97, dd5e6fa8)"),
    (r"(?:the )?parallel postulate", "Euclid's: one parallel through a point; nothing about this figure"),
    (r"(?:the )?definitions? of congruen(?:t|ce)(?: (?:segments|angles|triangles))?", "what ≅ means"),
)
_METHOD = re.compile(
    r"\b(?:(?:by|using|use|uses|apply|applying)\s+(?:the\s+)?)?(?:"
    + "|".join(rx.replace(" ", r"\s+") for rx, _ in METHOD_NAMES) + r")(?![A-Za-z])",
    re.IGNORECASE)
# A question that asserts nothing: "determine whether AB ∥ CD" (up to a
# condition, which is a statement: "…, given that the triangle is isosceles").
_WHETHER = re.compile(r"\bwhether\b[^.;?\n]*?(?=,|\s+(?:given|if|when|where|since|because|knowing)\b|[.;?\n]|$)",
                      re.IGNORECASE)
_NOT_NAMES = {"SAS", "ASA", "AAS", "SSS", "HL", "CPCTC", "AA", "SSA", "CPCF", "NOT"}  # never point names


@dataclass
class Tok:
    kind: str  # name | num | word | var | sym | punct
    norm: str
    a: int
    b: int
    wrap: str = ""  # angle | triangle | overline | overrightarrow | overleftrightarrow | odot
    value: float | None = None
    done: bool = field(default=False)


_TOKEN = re.compile(
    r"(?P<wrap>\\(?:overline|overrightarrow|overleftrightarrow|angle|triangle|odot)(?![A-Za-z]))"
    r"|(?P<ell>\\ell\s*(?:_\s*\{?\s*\d+\s*\}?|\d+)?)"
    r"|(?P<cmd>\\[A-Za-z]+)"
    r"|(?P<name>(?<![A-Za-z\\])(?:[A-Z][0-9]*'*)+(?![a-z]))"
    r"|(?P<num>\d+(?:\.\d+)?)"
    r"|(?P<word>[A-Za-z]+(?:-[A-Za-z]+)*)"
    r"|(?P<punct>[\s,.;:?!(){}\[\]|\"$*—–_]+)"
    r"|(?P<sym>.)",
    re.S,
)


_VULGAR = {"½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5,
           "⅘": 4 / 5, "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8}


def tokens(t: str, points: set[str] | None = None) -> list[Tok]:
    """The (cleaned) text as tokens. A wrapper (\\angle, \\overline …)
    is not a token: it types the name after it. A fraction or a mixed
    number is one number."""
    fracs: list[tuple[int, int, float]] = []
    for um in re.finditer(r"(?<![\d.])(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])", t):
        fracs.append((um.start(), um.end(), round(float(um[1] or 0) + _VULGAR[um[2]], 6)))
    for rx in _FRACTIONS:
        for fm in rx.finditer(t):
            v = _fraction_value(fm)
            if v is not None and not any(a < fm.end() and fm.start() < b for a, b, _ in fracs):
                fracs.append((fm.start(), fm.end(), v))
    out: list[Tok] = []
    wrap = ""
    i = 0
    while i < len(t):
        f = next((x for x in fracs if x[0] == i), None)
        if f:
            out.append(Tok("num", repr(round(f[2], 6)), f[0], f[1], value=f[2]))
            i, wrap = f[1], ""
            continue
        m = _TOKEN.match(t, i)
        if m is None:  # pragma: no cover - the pattern matches any character
            i += 1
            continue
        g, s = m.lastgroup, m.group(0)
        i = m.end()
        if g == "wrap":
            wrap = s[1:]
            if wrap == "odot":
                out.append(Tok("sym", "sym:odot", m.start(), m.end()))
            continue
        if g == "sym" and s in ("↔", "→", "⟷", "⟶"):  # a quote's "↔AB": the \overleftrightarrow{AB}
            wrap = "overleftrightarrow" if s in ("↔", "⟷") else "overrightarrow"
            continue
        if g == "punct":
            out.append(Tok("punct", s, m.start(), m.end()))
            if "{" not in s and "}" not in s and s.strip():
                wrap = ""
            continue
        if g == "num" and wrap == "angle":
            out.append(Tok("name", "∠" + s, m.start(), m.end(), wrap="angle"))
        elif g == "ell":
            out.append(Tok("name", line_key(s), m.start(), m.end(), wrap="line"))
        elif g == "name" and (s in _NOT_NAMES or (s in ("I", "A") and s not in (points or set()))):
            out.append(Tok("word", s.lower(), m.start(), m.end()))
        elif g == "name":
            out.append(Tok("name", s, m.start(), m.end(), wrap=wrap))
        elif g == "num":
            out.append(Tok("num", repr(round(float(s), 6)), m.start(), m.end(), value=float(s)))
        elif g == "word":
            w = s.lower()
            kind = "var" if len(s) == 1 and s.islower() and s != "a" else "word"
            out.append(Tok(kind, w, m.start(), m.end()))
        elif g == "cmd":
            out.append(Tok("sym", "sym:" + s[1:], m.start(), m.end()))
        else:  # the minus sign (U+2212) is the hyphen-minus a problem types
            out.append(Tok("sym", "sym:" + s.replace("\u2212", "-"), m.start(), m.end()))
        wrap = ""
    return out


def _key(k: Tok) -> tuple[str, str]:
    return (k.kind, k.norm)


def _find_runs(seq: list[Tok], quote: list[Tok]) -> list[list[Tok]]:
    """Each place the quote's tokens (punctuation aside) run in the text,
    exactly and contiguously."""
    q = [_key(k) for k in quote if k.kind != "punct"]
    s = [k for k in seq if k.kind != "punct"]
    if not q:
        return []
    keys = [_key(k) for k in s]
    return [s[i:i + len(q)] for i in range(len(s) - len(q) + 1) if keys[i:i + len(q)] == q]


# ── What a fact uses ──────────────────────────────────────────────────

def _cyc_adjacent(poly: list[str], pair: set[str]) -> bool:
    n = len(poly)
    return any({poly[i], poly[(i + 1) % n]} == pair for i in range(n))


def _neighbours(facts: FigureFacts, v: str) -> list[set[str]]:
    out = []
    for p in (*facts.triangles, *facts.polygons):
        ps = split_names(p)
        if v in ps:
            i = ps.index(v)
            out.append({ps[i - 1], ps[(i + 1) % len(ps)]})
    return out


def _uses_name(f: Fact, tok: Tok, facts: FigureFacts) -> bool:
    """The fact uses this name in the role the text gives it."""
    if tok.norm.startswith("∠"):
        return any(x == tok.norm[1:] for x in f.items)
    if tok.wrap == "line" or re.fullmatch(r"ell\d*", tok.norm):
        return any(line_key(x) == tok.norm for x in f.items)
    letters = split_names(tok.norm)
    if not letters:
        return False
    if len(letters) == 1 and letters[0] in (f.point, f.circle) and tok.wrap != "angle":
        return True
    # "RP extended beyond P": the end the side is extended past (RP's
    # second letter, the way the fact records it), not the other end.
    if f.kind == "extension" and f.items and len(letters) == 1 and not tok.wrap \
            and split_names(f.items[0])[-1:] == letters:
        return True
    for x in f.items:
        xs = split_names(x)
        if not xs:
            continue
        if len(xs) == 1:
            if letters == xs:
                return True
        elif len(xs) == 2:
            # A segment or line: its own name, not a single endpoint ("∠A"
            # is not AB's), except as the ends something lies between.
            if set(letters) == set(xs) and len(letters) == 2 and tok.wrap not in ("angle", "triangle"):
                return True
            # "D is between A and B": the segment's ends, one by one.
            if f.kind in ("on_segment", "collinear") and len(letters) == 1 and letters[0] in xs and not tok.wrap:
                return True
        elif len(xs) == 3 and f.kind in _ANGLE_KINDS:
            v, ends = xs[1], {xs[0], xs[2]}
            if len(letters) == 3 and letters[1] == v and {letters[0], letters[2]} == ends and tok.wrap != "triangle":
                return True
            if len(letters) == 2 and v in letters and (set(letters) - {v}) <= ends:
                return True
            # "∠C", "at C": the one angle at C, so its sides must be C's
            # neighbours in a listed triangle or polygon (or C in none).
            if len(letters) == 1 and letters[0] == v:
                nb = _neighbours(facts, v)
                if not nb or ends in nb:
                    return True
        else:  # a triangle or polygon, or a list of points
            if f.kind in _POLY_KINDS:
                if len(letters) == len(xs) and set(letters) == set(xs) and tok.wrap != "angle":
                    return True
                if len(letters) == 2 and _cyc_adjacent(xs, set(letters)):
                    # An isosceles fact's equal sides meet at its apex.
                    return not (f.kind == "isosceles" and f.point and f.point not in letters)
                if len(letters) == 1 and letters[0] in xs:
                    return True
            elif set(letters) <= set(xs) and len(letters) in (1, len(xs)):
                return True
    return False


def _numbers(f: Fact) -> set[float]:
    from api.core.geometry.figure_check import linear_expr

    out: set[float] = set()
    if f.value is not None:
        out.add(round(float(f.value), 6))
    for x in re.findall(r"\d+(?:\.\d+)?", f.expr or ""):
        out.add(round(float(x), 6))
    try:
        parsed = linear_expr(f.expr) if f.expr else None
    except (ValueError, ZeroDivisionError):
        parsed = None
    if parsed is not None:
        out |= {round(abs(parsed[0]), 6), round(abs(parsed[1]), 6)}
    if f.kind in _IMPLIED:
        out.add(_IMPLIED[f.kind])
    return out


def _vars(f: Fact) -> set[str]:
    return set(re.findall(r"(?<![A-Za-z])[a-z](?![A-Za-z])", f.expr or ""))


def _fact_accounts(f: Fact, run: list[Tok], facts: FigureFacts) -> list[Tok]:
    """The tokens of a quote's run that the fact uses; none at all when the
    run holds no word or symbol of the fact's own relation."""
    vocab = VOCAB.get(f.kind)
    if vocab is None:
        return []  # "other": the checker can't verify it, so it accounts for nothing
    nums, vs = _numbers(f), _vars(f)
    algebra = bool(f.expr)
    used: list[Tok] = []
    relation = not vocab  # a numbered angle's label has no relation word
    # A part named by its role, exactly ("each base angle", "the vertex
    # angle", "one acute angle … the other"): those words, and the part.
    role = _named_by_role(f, run, facts)
    named = bool(role)  # the quote names a part of the fact
    if f.kind == "perpendicular" and any(k.norm == "altitude" for k in run):
        vocab = vocab | {"drawn"}  # "altitude QS is drawn to PR"
    for k in run:
        if k.kind == "name":
            ok = _uses_name(f, k, facts) or id(k) in role
            named |= ok
        elif k.kind == "num":
            ok = k.value is not None and round(k.value, 6) in nums
        elif k.kind == "var":
            line = any(line_key(x) == k.norm for x in f.items)
            ok = k.norm in vs or line
            named |= line
        elif k.kind == "word":
            ok = k.norm in vocab or k.norm in INERT_WORDS or id(k) in role
            relation |= k.norm in vocab
        else:  # a symbol
            ok = k.norm in vocab or (algebra and k.norm in ("sym:+", "sym:-", "sym:/", "sym:^", "sym:=", _DEG))
            relation |= k.norm in vocab
        if ok:
            used.append(k)
    # "Equilateral △ABC has side length 6" read as AB = 6: when another
    # fact makes every side of the shape equal, "side" is any side, exactly.
    if not named and f.kind == "equal_length" and any(k.kind == "word" and k.norm == "side" for k in run):
        named = _a_side_of_an_equal_sided_shape(f, facts)
    # A quote that names none of the fact's parts ("the vertex angle
    # measures 40°" read as m∠B = 40°) says which part only by the
    # reading's choice, so it accounts for nothing.
    return used if relation and named else []


def _vertex(f: Fact) -> str:
    xs = split_names(f.items[0]) if f.items else []
    return xs[1] if len(xs) == 3 else xs[0] if len(xs) == 1 else ""


# ── Derived facts ─────────────────────────────────────────────────────
# A wording that needs more than one fact ("each base angle", "G and H
# respectively", "intersects PR at S") is accounted for only this way:
# code parses exactly those words with a fixed grammar, derives the
# fact(s) they state, and requires each derived fact to be in the agreed
# reading, in canonical form. The figure is then checked against the
# reading's facts like any other. A wording the grammar doesn't parse
# exactly, or that fits more than one part, is a gap.


def _given_atoms(facts: FigureFacts) -> set[Any]:
    out: set[Any] = set()
    for g in facts.givens:
        out |= _fact_atoms(g, facts)
    return _closure(out)


def _in_reading(derived: list[Fact], facts: FigureFacts) -> bool:
    have = _given_atoms(facts)
    for d in derived:
        a = _fact_atoms(d, facts)
        if not a or not a <= have or any(x[0] == "other" for x in a):
            return False
    return True


def _apex(tri: list[str], have: set[Any]) -> str | None:
    """The apex of a listed triangle, from its stated equal legs; none when
    no pair (or every pair: equilateral) of sides is stated equal."""
    if len(tri) != 3:
        return None
    apexes = [v for v in tri if ("eqlen", frozenset(seg(v + o) for o in tri if o != v)) in have]
    return apexes[0] if len(apexes) == 1 else None


def _triangle_tok(run: list[Tok], i: int) -> bool:
    k = run[i]
    return k.kind == "name" and len(split_names(k.norm)) == 3 and (
        k.wrap == "triangle" or (i > 0 and run[i - 1].kind == "word" and run[i - 1].norm == "triangle"))


def _the_triangle(run: list[Tok], at: int, facts: FigureFacts, fits: Any) -> tuple[list[str], list[Tok]] | None:
    """The triangle a role phrase is about: the one named right after it
    ("each base angle of △DEF"), else the only listed triangle that fits.
    With its name's token, if named."""
    j = at
    if j + 1 < len(run) and run[j].kind == "word" and run[j].norm == "of":
        if j + 2 < len(run) and run[j + 1].kind == "word" and run[j + 1].norm == "triangle":
            j += 1
        if j + 1 < len(run) and _triangle_tok(run, j + 1):
            tri = split_names(run[j + 1].norm)
            listed = any(set(split_names(x)) == set(tri) for x in facts.triangles)
            return (tri, [run[j], run[j + 1]]) if listed and fits(tri) else None
        return None
    cands = [split_names(x) for x in facts.triangles if fits(split_names(x))]
    return (cands[0], []) if len(cands) == 1 else None


def _seq(run: list[Tok], i: int, *norms: str) -> bool:
    return i + len(norms) <= len(run) and all(
        run[i + n].kind == "word" and run[i + n].norm in w.split("|") for n, w in enumerate(norms))


def _angle_at(tri: list[str], v: str) -> str:
    a, b = (x for x in tri if x != v)
    return a + v + b


def _named_by_role(f: Fact, run: list[Tok], facts: FigureFacts) -> set[int]:
    """The tokens (by id) of a role phrase that names the fact's angle
    exactly, or none. Each derives the angle(s) from the words:
    - "each / one base angle [of △DEF] measures …": the two base angles of
      that triangle (or of the only listed triangle with stated equal
      legs), taken from its stated equal legs, each with this measure;
    - "the vertex angle [of △DEF]": its apex;
    - "one acute angle measures … and the other measures …": the two acute
      angles of the problem's one listed triangle, by its stated right
      angle (with two triangles, "acute angle" could be either's);
    - "the exterior angle at P measures …": the angle between the stated
      extension past P and the triangle's other side at P."""
    if f.kind != "angle_measure" or not f.items:
        return set()
    have = _given_atoms(facts)

    def is_(derived: list[Fact]) -> bool:
        return _in_reading(derived, facts)

    def measure(angle: str) -> Fact:
        return Fact(kind="angle_measure", items=[angle], value=f.value, expr=f.expr)

    for i in range(len(run)):
        if _seq(run, i, "each|one", "base", "angle"):
            found = _the_triangle(run, i + 3, facts, lambda tr: _apex(tr, have) is not None)
            if found:
                tri, named = found
                apex = _apex(tri, have)
                if is_([measure(_angle_at(tri, b)) for b in tri if b != apex]):
                    return {id(run[i]), id(run[i + 1]), *map(id, named)}
            return set()
        if _seq(run, i, "vertex", "angle"):
            found = _the_triangle(run, i + 2, facts, lambda tr: _apex(tr, have) is not None)
            if found:
                tri, named = found
                apex = _apex(tri, have)
                if apex and is_([measure(_angle_at(tri, apex))]):
                    return {id(run[i]), *map(id, named)}
            return set()
        if _seq(run, i, "one", "acute", "angle") or _seq(run, i, "the", "other"):
            rights = [(tr, v) for tr in map(split_names, facts.triangles) if len(tr) == 3
                      for v in tr if ("measure", ("ang", v, frozenset(set(tr) - {v})), 90.0, None) in have]
            if len(rights) != 1 or len(facts.triangles) != 1:
                return set()
            tri, right = rights[0]
            acute = [x for x in tri if x != right]
            v = _vertex(f)
            if v not in acute:
                return set()
            other = _angle_at(tri, next(x for x in acute if x != v))
            first = run[i].norm == "one"
            # The partner fact: the other acute angle, said by the other half.
            partner = any(g.kind == "angle_measure" and g.items and _fact_atoms(g, facts) and any(
                a[1] == ("ang", other[1], frozenset((other[0], other[2]))) for a in _fact_atoms(g, facts))
                and re.search(r"\bthe other\b" if first else r"\bone acute angle\b", g.quote or "", re.I)
                for g in facts.givens)
            if partner and is_([measure(_angle_at(tri, v))]):
                return {id(run[i]), id(run[i + 1])}
            return set()
        if _seq(run, i, "exterior", "angle", "at") and i + 3 < len(run) and run[i + 3].kind == "name":
            p = run[i + 3].norm
            ext = _extensions_past(p, facts)
            if len(ext) == 1 and ext[0][2]:
                start, end, to, third = ext[0]
                if is_([measure(third + end + to)]):
                    return {id(run[i]), id(run[i + 1]), id(run[i + 2]), id(run[i + 3])}
            return set()
    return set()


def _extensions_past(p: str, facts: FigureFacts) -> list[tuple[str, str, str, str]]:
    """The stated extensions of a listed triangle's side past its vertex p:
    (start, end = p, the point past it or "", the triangle's third vertex)."""
    out = []
    for g in facts.givens:
        xs = split_names(g.items[0]) if g.kind == "extension" and g.items else []
        if len(xs) == 2 and xs[1] == p:
            for tr in map(split_names, facts.triangles):
                if set(xs) <= set(tr) and len(tr) == 3:
                    out.append((xs[0], p, g.point or "", next(c for c in tr if c not in xs)))
    return out


_EQUAL_SIDED = ("equilateral", "square", "rhombus")


def _a_side_of_an_equal_sided_shape(f: Fact, facts: FigureFacts) -> bool:
    if len(f.items) != 1 or len(split_names(f.items[0])) != 2:
        return False
    side = set(split_names(f.items[0]))
    return any(g.kind in _EQUAL_SIDED and g.items and _cyc_adjacent(split_names(g.items[0]), side)
               for g in facts.givens)


# ── Coverage ─────────────────────────────────────────────────────────

def coverage_gaps(text: str, facts: FigureFacts) -> list[str]:
    """What the text says that the reading doesn't account for (see the
    module docstring): a point name the reading lacks, then each run of
    unaccounted tokens, in the problem's own words."""
    from api.core.geometry.figure_check import _clean, _plain, _shading_statements, parse_problem

    t = _clean(text)
    gaps = [f"point {n}" for n in sorted(parse_problem(text).points - set(facts.points))]
    toks = tokens(t, set(facts.points))

    def mark(a: int, b: int, only: tuple[str, ...] = ()) -> None:
        for k in toks:
            if a <= k.a and k.b <= b and (not only or k.kind in only):
                k.done = True

    words = [k for k in toks if k.kind != "punct"]
    for i, k in enumerate(words):
        if k.kind == "word" and (k.norm in INERT_WORDS or (  # "… to find x": the question's own "to"
                k.norm == "to" and i + 1 < len(words) and words[i + 1].norm in _QUESTION_VERBS)):
            k.done = True
    for k in toks:
        if k.kind == "punct":
            k.done = True
    # 1. Facts the checker verifies, each over its own quote.
    for f in [*facts.givens, *facts.prove]:
        for piece in re.split(r"\s*…\s*|\.\.\.", f.quote or ""):
            for found in _find_runs(toks, tokens(_clean(piece), set(facts.points))):
                for k in _fact_accounts(f, found, facts):
                    k.done = True
    # 2. What is asked.
    _targets(t, toks, facts)
    # 3. What code reads itself.
    for m in _shading_statements(t):
        mark(*m.span())
    for m in re.finditer(r"(?<![A-Za-z\\])[A-Z][0-9]*'*\s*=?\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)",
                         t.replace("−", "-")):
        mark(*m.span())
    for m in re.finditer(_LIST_MARK, t, re.IGNORECASE):
        mark(*m.span())
    for rx in (_METHOD, _WHETHER):  # "by the Alternate Interior Angles Theorem"; "whether AB ∥ CD"
        for m in rx.finditer(t):
            mark(*m.span(), only=("word", "punct"))
    if facts.triangles or any(len(split_names(p)) == 3 for p in facts.polygons):
        for m in _ANGLE_SUM.finditer(t):
            if _angle_sum_of_triangle(m.group(0), facts):
                end = re.match(r"\s*(?:°|degrees?\b)?", t[m.end():])
                mark(m.start(), m.end() + (end.end() if end else 0))
    _named_parts(toks, facts)
    _hypotenuse_and_legs(toks, facts)
    _exact_rules(t, toks, facts)
    _draw(toks, facts)
    # A clause said again exactly is accounted for when the first saying is.
    clauses = _clauses(t)
    for ci, orig in sorted(_restated(t, clauses).items()):
        a, b = clauses[orig]
        if all(k.done for k in toks if a <= k.a and k.b <= b):
            mark(*clauses[ci])
    # The gaps: runs of tokens nothing accounts for, cut at sentence ends.
    run: list[Tok] = []
    runs: list[list[Tok]] = []
    for k in toks:
        if k.done and not (k.kind == "punct" and run and not re.search(r"[.;?!:\n]", k.norm)):
            if run:
                runs.append(run)
                run = []
            continue
        if k.kind == "punct":
            continue
        run.append(k)
    if run:
        runs.append(run)
    for r in runs:
        if len(r) == 1 and r[0].kind == "num":
            gaps.append(f"the number {r[0].norm.removesuffix('.0')}")
        else:
            said = re.sub(r"\\(?:overline|overrightarrow|overleftrightarrow)\s*", "", t[r[0].a:r[-1].b])
            gaps.append(f"“{_plain(said).strip()}”")
    return list(dict.fromkeys(gaps))


def _targets(t: str, toks: list[Tok], facts: FigureFacts) -> None:
    """A question's target tokens: its question word, what is asked
    ("length", "measure", "the shaded area") and the asked part's names."""
    asked_names: set[str] = set()
    asked_vars: set[str] = set()
    for tg in facts.find:
        # "x", "value of k"; "AB", "m∠C", "∠2" (the asked part itself).
        item = re.sub(r"^m?\s*∠\s*", "", tg.item.strip())
        var = re.fullmatch(r"(?:the\s+)?(?:value\s+of\s+)?([a-z])", item)
        if var:
            asked_vars.add(var[1])
        elif split_names(item) or re.fullmatch(r"\d+", item):
            asked_names.add(item)
    for a, b in _target_spans(t):
        inside = [k for k in toks if a <= k.a and k.b <= b]
        for i, k in enumerate(inside):
            nxt = next((x for x in inside[i + 1:] if x.kind != "punct"), None)
            if k.kind == "word" and (k.norm in TARGET_WORDS or k.norm == "region"
                                     or (k.norm == "shaded" and nxt is not None and nxt.norm in ("area", "region"))):
                k.done = True
            elif k.kind == "var" and k.norm in asked_vars:
                k.done = True
            elif k.kind == "name" and _asked(k, asked_names):
                k.done = True


# Where a question's targets end: a condition, or the end of the sentence.
# A list of targets ("Find QS, PQ, and QR", "find k and the length of YZ")
# runs on; only the target tokens themselves are exempt, so a statement in
# the list ("find k, and XY ⊥ YZ") still needs its fact.
_TARGETS_END = re.compile(
    r"\s+(?:in|inside|outside|with|without|if|given|where|when|whenever|knowing|whose|which|that|such|so|"
    r"using|by|assuming|since|because)\b|[(—–:;.?!\n]", re.IGNORECASE)


def _target_spans(t: str) -> list[tuple[int, int]]:
    out = []
    for a, _b in _question_spans(t):
        end = _TARGETS_END.search(t, a + 1)
        out.append((a, end.start() if end else len(t)))
    return out


def _asked(k: Tok, asked: set[str]) -> bool:
    if k.norm.startswith("∠"):
        return k.norm[1:] in asked
    letters = split_names(k.norm)
    for x in asked:
        xs = split_names(x)
        if not xs:
            continue
        if len(xs) == 1 and len(letters) == 1 and xs == letters:
            return True
        if len(xs) == 2 and set(xs) == set(letters):
            return True
        if len(xs) == 3 and len(letters) == 3 and xs[1] == letters[1] and {xs[0], xs[2]} == {letters[0], letters[2]}:
            return True
        if len(xs) == 3 and len(letters) == 1 and xs[1] == letters[0] and k.wrap == "angle":
            return True
    return False


def _named_parts(toks: list[Tok], facts: FigureFacts) -> None:
    """"In △ABC", "quadrilateral ABCD", "circle O": a part the reading
    lists, named as what it is (the figure is checked to draw it)."""
    tris = {frozenset(split_names(x)) for x in facts.triangles} | {
        frozenset(split_names(x)) for x in facts.polygons if len(split_names(x)) == 3}
    polys = [split_names(x) for x in facts.polygons]
    words = [k for k in toks if k.kind != "punct"]
    for i, k in enumerate(words):
        if k.kind != "name":
            continue
        letters = split_names(k.norm)
        prev = words[i - 1] if i else None
        if k.wrap == "triangle" and frozenset(letters) in tris and len(letters) == 3:
            k.done = True
        elif prev is not None and prev.kind == "word" and prev.norm in _POLY_WORDS and any(
                set(p) == set(letters) and len(p) == len(letters) for p in polys) and (
                _POLY_WORDS[prev.norm] in (0, len(letters))):
            k.done = prev.done = True
        elif len(letters) == 1 and letters[0] in facts.circles and prev is not None and (
                prev.norm in ("circle", "sym:odot")):
            k.done = prev.done = True


def _right_vertices(facts: FigureFacts) -> dict[frozenset[str], str]:
    """Each side pair of a right angle the reading states: {ends} → vertex."""
    out: dict[frozenset[str], str] = {}
    for f in facts.givens:
        xs = split_names(f.items[0]) if f.items else []
        if f.kind == "right_angle" and len(xs) == 3:
            out[frozenset((xs[0], xs[2]))] = xs[1]
        elif f.kind == "right_triangle" and len(xs) == 3 and f.point in xs:
            out[frozenset(v for v in xs if v != f.point)] = f.point
    return out


def _hypotenuse_and_legs(toks: list[Tok], facts: FigureFacts) -> None:
    """"hypotenuse AB", "legs AC and BC": the side opposite (or along) a
    right angle the reading states. The word is accounted for only then;
    the name still needs its own fact or target."""
    right = _right_vertices(facts)
    words = [k for k in toks if k.kind != "punct"]
    for i, k in enumerate(words):
        if not (k.kind == "word" and k.norm in ("hypotenuse", "leg", "legs")):
            continue
        j = i + 1
        while j < len(words) and words[j].kind == "word" and words[j].norm in (
                "the", "of", "length", "lengths", "measure", "measures"):
            j += 1
        names: list[Tok] = []
        while j < len(words) and words[j].kind == "name" and len(split_names(words[j].norm)) == 2:
            names.append(words[j])
            j += 1
            # "the legs measure AC = 9 and BC = 40": each leg's own length between
            if j + 1 < len(words) and words[j].norm == _EQ and words[j + 1].kind == "num":
                j += 2
            if k.norm == "legs" and j < len(words) and words[j].kind == "word" and words[j].norm == "and":
                j += 1
        if not names or (k.norm == "legs") != (len(names) == 2):
            continue
        sides = [frozenset(split_names(n.norm)) for n in names]
        if k.norm == "hypotenuse":
            ok = sides[0] in right
        else:
            ok = any(all(len(s & ends) == 1 and v in s for s in sides) for ends, v in right.items())
        if ok:
            k.done = True
            for w in words[i + 1:j]:
                if w.kind == "word" and w.norm in ("measure", "measures"):
                    w.done = True


# ── Instruction phrases: the exact wordings that state nothing ─────────
# Each is matched whole (spacing and letter case aside), never word by
# word: "statement", "proves", "set up" alone could say something. Every
# phrase is one seen in prod problems (question_bank_items, read
# 2026-11-12/13). A name or number inside a phrase still needs accounting.
INSTRUCTION_PHRASES: tuple[tuple[str, str], ...] = (
    # Proof format (2d01d709, 589e4a97, ee6a495e, dd7ab4c1, bac5ea12 …)
    (r"write (?:a|the) (?:complete )?(?:two-column )?proof", "Write a (complete) (two-column) proof"),
    (r"using a two-column proof", "Prove that … using a two-column proof (d9f94a62)"),
    (r"clearly state each statement and its corresponding reason", "d9f94a62"),
    (r"(?:then )?set up and solve an algebraic equation as part of your proof", "a hint's method (2d01d709)"),
    (r"you may use", "You may use <methods> (bac5ea12, 0511d648, dee52ce7, afee316c)"),
    # Naming the method used
    (r"state (?:which|the) (?:theorem|postulate|property) you used?"
     r"(?: to conclude the triangles are congruent)?", "State which theorem you used (21807dd6, 95c727b2, ee6a495e)"),
    (r"(?:and )?state the (?:theorem|property) that justifies (?:this|setting the expressions equal)",
     "2f44f46d, 18ce1004"),
    (r"name the congruence (?:postulate|theorem)(?: or (?:theorem|postulate))? that proves", "7450aa6e, e87bd653"),
    (r"(?:and )?write (?:a|the) (?:complete|full) congruence statement", "7450aa6e, e87bd653"),
    (r"by identifying the three pairs of congruent parts and naming the appropriate congruence postulate",
     "7ef5c01b"),
    (r"using the (?:information|givens) given|using the given information", "7ef5c01b"),
    (r"set up and solve a proportion using the similarity ratio", "12c77989"),
    (r"determine which congruence (?:theorem|postulate) \(\s*(?:SAS|ASA|AAS|SSS|HL)\s+or\s+(?:SAS|ASA|AAS|SSS|HL)"
     r"\s*\) can be used to prove", "099d8962"),
    (r"explain why the other (?:theorem|postulate) does not apply", "099d8962"),
    (r"explain why", "a question: what it asks about still needs its fact (2f44f46d)"),
    (r"first prove that", "a hint's step: the claim after it still needs its fact (589e4a97)"),
    (r"\bhint\s*\**\s*:", "the label of a hint; what the hint says is read like any text"),
    # Answer format
    (r"(?:leave|express) (?:your |each |all )?answers? in simplest radical form", "97b3010d, b7b1595b"),
    (r"the exact(?= (?:perimeter|length|area|value)\b)", "the exact perimeter / length (08e3224d, 584320a7)"),
    (r"using your value of(?= [a-z]\b)", "the unknown after it is accounted for only if asked (2f44f46d)"),
)
_PHRASES = [re.compile(r"\b" + rx.replace(" ", r"\s+"), re.IGNORECASE) for rx, _ in INSTRUCTION_PHRASES]
_ACR = r"(?:SAS|ASA|AAS|SSS|CPCTC|AA)"  # the method names above by their letters (no HL: right triangles)
_METHOD_LISTS = re.compile(  # "AAS or ASA congruence", "triangle congruence (SSS or SAS)"
    rf"\b(?:(?:using|by)\s+)?(?:triangle\s+congruence\s*\(\s*{_ACR}(?:\s+or\s+{_ACR})*\s*\)|{_ACR}(?:\s+or\s+{_ACR})+"
    rf"(?:\s+congruence)?)(?![A-Za-z])",
    re.IGNORECASE)
_SENT_END = re.compile(r"[.;?!\n]")


def _sentence_of(toks: list[Tok], i: int) -> tuple[int, int]:
    """The token index range of the sentence holding toks[i]."""
    a = i
    while a > 0 and not (toks[a - 1].kind == "punct" and _SENT_END.search(toks[a - 1].norm)):
        a -= 1
    b = i
    while b < len(toks) and not (toks[b].kind == "punct" and _SENT_END.search(toks[b].norm)):
        b += 1
    return a, b


def _exact_rules(t: str, toks: list[Tok], facts: FigureFacts) -> None:
    """Wordings accounted for by an exact rule: the instruction phrases and
    method lists, and the derived-fact rules (see "Derived facts")."""
    def mark(a: int, b: int, kinds: tuple[str, ...] = ("word",)) -> None:
        for k in toks:
            if a <= k.a and k.b <= b and k.kind in kinds:
                k.done = True

    asked_vars = {m[1] for tg in facts.find if (m := re.fullmatch(r"(?:the\s+)?(?:value\s+of\s+)?([a-z])",
                                                                    tg.item.strip()))}
    for rx in _PHRASES:
        for m in rx.finditer(t):
            mark(*m.span())
            var_m = re.match(r"\s+([a-z])\b", t[m.end():])
            if rx.pattern.endswith("value\\s+of(?=\\s+[a-z]\\b)") and var_m and var_m[1] in asked_vars:
                mark(m.end(), m.end() + var_m.end(), ("var",))
    for m in _METHOD_LISTS.finditer(t):
        mark(*m.span())
    words = [k for k in toks if k.kind != "punct"]
    pos = {id(k): i for i, k in enumerate(toks)}
    have = _given_atoms(facts)
    tris = [split_names(x) for x in facts.triangles if len(split_names(x)) == 3]

    def sentence_words(k: Tok) -> list[Tok]:
        a, b = _sentence_of(toks, pos[id(k)])
        return [x for x in toks[a:b] if x.kind != "punct"]

    def norm_seq(i: int, n: int) -> list[str]:
        return [w.norm for w in words[i:i + n]]

    def is_name(i: int, n: int | None = None) -> bool:
        return i < len(words) and words[i].kind == "name" and (n is None or len(split_names(words[i].norm)) == n)

    def done(*ws: Tok) -> None:
        for w in ws:
            w.done = True

    for i, k in enumerate(words):
        if k.kind != "word":
            continue
        # "the base angles satisfy m∠Q = … and m∠R = …": the angles named
        # after it are exactly the base angles of the listed triangle holding
        # them, by its stated equal legs; "the interior angles satisfy …":
        # all are angles of one listed triangle.
        if k.norm == "the" and norm_seq(i, 4)[1:] in (["base", "angles", "satisfy"], ["interior", "angles", "satisfy"]):
            sent = sentence_words(k)
            after = [w for w in sent[sent.index(k) + 4:] if w.kind == "name" and w.wrap == "angle"]
            vs = {split_names(w.norm)[1] if len(split_names(w.norm)) == 3 else w.norm for w in after}
            holding = [tr for tr in tris if vs <= set(tr)]
            if words[i + 1].norm == "base":
                ok = len(holding) == 1 and len(vs) == 2 and (apex := _apex(holding[0], have)) is not None \
                    and vs == set(holding[0]) - {apex}
            else:
                ok = bool(after) and len(holding) == 1
            if ok:
                done(*words[i + 1:i + 4])
        # "OA, OB, OC, and OD all share endpoint O": every part named before
        # it in the sentence is a ray named from O (so it starts at O by its
        # name), drawn as a listed ray. "△ABC and △ABD share side AB": every
        # part named before is a listed triangle whose name holds A and B.
        if k.norm == "share":
            j = i + 1
            while j < len(words) and words[j].norm in ("a", "the", "common"):
                j += 1
            if j + 1 < len(words) and words[j].norm in ("endpoint", "vertex", "side") and words[j + 1].kind == "name":
                what, x = words[j].norm, words[j + 1].norm
                sent = sentence_words(k)
                before = [w for w in sent[:sent.index(k)] if w.kind == "name"]
                if what == "endpoint":
                    ok = len(before) >= 2 and all(w.wrap == "overrightarrow" and w.norm in facts.rays
                                                  and split_names(w.norm)[0] == x for w in before)
                else:
                    tri_names = [w for w in before if w.wrap == "triangle"]
                    ok = len(tri_names) == len(before) >= 2 and all(
                        set(split_names(x)) <= set(split_names(w.norm)) and len(split_names(x)) == (
                            2 if what == "side" else 1) for w in tri_names) and all(
                        any(set(split_names(w.norm)) == set(tr) for tr in tris) for w in tri_names)
                if ok:
                    done(*before, *words[i:j + 2])
                    if i and words[i - 1].norm == "all":
                        done(words[i - 1])
        # "[subject] intersects PR at (point) S": S is on PR and on the
        # clause's subject: the name right before the verb ("EF intersects"),
        # past one clause set off by commas ("QS, the bisector, intersects"),
        # or, after "and", the name that starts the clause ("ray QS bisects
        # ∠PQR and intersects"; a clause set off by commas may stand before
        # the "and").
        if k.norm in ("intersects", "meets") and is_name(i + 1, 2):
            xy = words[i + 1].norm
            j = i + 2
            if j < len(words) and words[j].norm == "at":
                j += 1
                if j < len(words) and words[j].norm == "point":
                    j += 1
                subject = _subject_of(toks, pos[id(k)])
                if is_name(j, 1) and subject is not None:
                    pt = words[j].norm
                    derived = [Fact(kind="on_segment", items=[xy], point=pt)]
                    if pt not in split_names(subject.norm):
                        derived.append(Fact(kind="on_line", items=[subject.norm], point=pt))
                    if _in_reading(derived, facts):
                        done(*words[i:j + 1])
        # The exterior angle:
        # - "an exterior angle is formed at (vertex) P by extending (side) RP
        #   beyond P (to point T)": exactly the stated extension;
        # - "the exterior angle ∠ACD": the extension of the listed triangle's
        #   side BC past C to D;
        # - "the exterior angle at P" in a question: the one stated extension
        #   past P (with its measure, see _named_by_role).
        if k.norm == "exterior" and i + 1 < len(words) and words[i + 1].norm == "angle":
            j = i + 2
            if norm_seq(j, 2) == ["is", "formed"]:
                j += 2
                ok = False
                if j < len(words) and words[j].norm == "at":
                    j += 1 + (j + 1 < len(words) and words[j + 1].norm == "vertex")
                    if is_name(j, 1) and norm_seq(j + 1, 2) == ["by", "extending"]:
                        p = words[j].norm
                        sd = j + 3 + (j + 3 < len(words) and words[j + 3].norm == "side")
                        if is_name(sd, 2) and norm_seq(sd + 1, 1) == ["beyond"] and is_name(sd + 2, 1) \
                                and words[sd + 2].norm == p and p in split_names(words[sd].norm):
                            st = next(x for x in split_names(words[sd].norm) if x != p)
                            end = sd + 3
                            to = ""
                            if norm_seq(end, 1) == ["to"]:
                                q = end + 1 + (end + 1 < len(words) and words[end + 1].norm == "point")
                                if is_name(q, 1):
                                    to, end = words[q].norm, q + 1
                            ok = _in_reading([Fact(kind="extension", items=[st + p], point=to or None)], facts) \
                                and any({st, p} <= set(tr) for tr in tris)
                            if ok:
                                done(*words[i:end])
            elif is_name(j, 3) and words[j].wrap == "angle":
                x, v, y = split_names(words[j].norm)
                derived = [Fact(kind="extension", items=[c + v], point=d)
                           for e, d in ((x, y), (y, x)) for tr in tris if {e, v} <= set(tr) and d not in tr
                           for c in tr if c not in (e, v)]
                if len(derived) == 1 and _in_reading(derived, facts):
                    done(k, words[i + 1])
            elif norm_seq(j, 1) == ["at"] and is_name(j + 1, 1) and _in_target(t, k):
                ext = _extensions_past(words[j + 1].norm, facts)
                if len(ext) == 1:
                    done(k, words[i + 1], words[j], words[j + 1])
        # "altitude CD (is drawn to AB)": CD is perpendicular to the side
        # opposite C of the one listed triangle with corner C (not D).
        if k.norm == "altitude" and is_name(i + 1, 2):
            c, d = split_names(words[i + 1].norm)
            holding = [tr for tr in tris if c in tr and d not in tr]
            if len(holding) == 1:
                opposite = "".join(x for x in holding[0] if x != c)
                if _in_reading([Fact(kind="perpendicular", items=[c + d, opposite], point=d)], facts):
                    done(k)
        # "transversal EF cutting both lines at points G and H respectively":
        # the two lines named before EF in the sentence, in the order the
        # text names them; G is where EF meets the first, H the second.
        if k.norm == "respectively" and i >= 7 and words[i - 2].norm == "and" and is_name(i - 1, 1):
            j = i - 3
            if is_name(j, 1):
                g_, h_ = words[j].norm, words[i - 1].norm
                j -= 1 + (words[j - 1].norm == "points")
                if words[j].norm == "at" and norm_seq(j - 2, 2) == ["both", "lines"] \
                        and words[j - 3].norm in ("cutting", "cuts", "intersecting", "intersects", "meeting",
                                                  "meets") and is_name(j - 4, 2):
                    tl = words[j - 4]
                    sent = sentence_words(k)
                    lines_: list[str] = []
                    for w in sent[:sent.index(tl)]:
                        if w.kind == "name" and len(split_names(w.norm)) == 2 and \
                                set(split_names(w.norm)) != set(split_names(tl.norm)) and \
                                set(split_names(w.norm)) not in [set(split_names(x)) for x in lines_]:
                            lines_.append(w.norm)
                    if len(lines_) == 2 and _in_reading([
                            Fact(kind="intersect", items=[tl.norm, lines_[0]], point=g_),
                            Fact(kind="intersect", items=[tl.norm, lines_[1]], point=h_)], facts):
                        done(*words[j - 3:i + 1])
    # In a question: "the measure of each angle", "both angle measures"
    # (what is asked, stated of nothing); "each acute angle" when the one
    # listed triangle has a stated right angle; "arc AB" when A and B lie on
    # one stated circle (exactly one).
    rights = [tr for tr in tris for v in tr if ("measure", ("ang", v, frozenset(set(tr) - {v})), 90.0, None) in have]
    for a, b in _target_spans(t):
        inside = [w for w in words if a <= w.a and w.b <= b]
        for i, w in enumerate(inside):
            nxt = inside[i + 1:i + 3]
            if w.norm in ("each", "both") and nxt:
                acute = nxt[0].norm == "acute" and len(tris) == 1 and len(rights) == 1
                head = nxt[1] if acute and len(nxt) > 1 else nxt[0]
                if head.norm in ("angle", "angles", "measure", "measures", "side", "sides"):
                    w.done = True
                    if acute:
                        nxt[0].done = True
            if w.norm == "arc" and nxt and nxt[0].kind == "name" and len(split_names(nxt[0].norm)) == 2 \
                    and not (i and inside[i - 1].norm in ("major", "minor")):
                ends = split_names(nxt[0].norm)
                circles = {c for c in facts.circles if all(("on_circle", p, c) in have for p in ends)}
                if len(circles) == 1:
                    w.done = nxt[0].done = True


def _in_target(t: str, k: Tok) -> bool:
    return any(a <= k.a and k.b <= b for a, b in _target_spans(t))


def _subject_of(toks: list[Tok], at: int) -> Tok | None:
    """The subject of the verb at toks[at] (see the "intersects" rule)."""
    verb = toks[at]
    # Words and names, plus the punctuation that matters here: commas and
    # sentence ends ("$, " is a comma; " $" is nothing).
    sig = [k for k in toks if k.kind != "punct" or "," in k.norm or _SENT_END.search(k.norm)]
    at = next(n for n, k in enumerate(sig) if k is verb)

    def comma(i: int) -> bool:
        return 0 <= i and sig[i].kind == "punct" and "," in sig[i].norm and not _SENT_END.search(sig[i].norm)

    def stop(i: int) -> bool:
        return i < 0 or comma(i) or (sig[i].kind == "punct" and bool(_SENT_END.search(sig[i].norm)))

    def name2(k: Tok) -> bool:
        return k.kind == "name" and len(split_names(k.norm)) == 2

    i = at - 1
    after_and = i >= 0 and sig[i].kind == "word" and sig[i].norm == "and"
    if after_and:
        i -= 1
    if comma(i):  # one clause set off by commas
        i -= 1
        while not stop(i):
            i -= 1
        if not comma(i):
            return None
        i -= 1
    if i < 0:
        return None
    if not after_and:
        return sig[i] if name2(sig[i]) else None
    # The clause before "and": from the previous comma or the sentence's start.
    while not stop(i):
        i -= 1
    i += 1
    while i < at and sig[i].kind == "word" and sig[i].norm in ("ray", "line", "segment", "the"):
        i += 1
    return sig[i] if name2(sig[i]) else None


def _draw(toks: list[Tok], facts: FigureFacts) -> None:
    """"draw AD", "Draw ray AB and ray AC": each part the reading lists (so
    the figure is checked to draw it), and the word "draw" when all are."""
    words = [k for k in toks if k.kind != "punct"]
    for i, k in enumerate(words):
        if not (k.kind == "word" and k.norm == "draw"):
            continue
        parts: list[Tok] = []
        j = i + 1
        while j < len(words):
            w = words[j]
            if w.kind == "word" and w.norm in ("the", "and", "segment", "segments", "ray", "rays", "line", "lines"):
                j += 1
                continue
            if w.kind == "name" and len(split_names(w.norm)) == 2:
                parts.append(w)
                j += 1
                continue
            if w.done and parts == []:
                j += 1  # "draw altitude AD ⊥ BC": a word a fact already accounts for
                continue
            break
        listed = [p for p in parts if p.done or _listed(p, words, facts)]
        for p in listed:
            p.done = True
        if parts and len(listed) == len(parts):
            k.done = True
            for w in words[i + 1:j]:
                if w.kind == "word":
                    w.done = True


def _listed(p: Tok, words: list[Tok], facts: FigureFacts) -> bool:
    a, b = split_names(p.norm)
    i = words.index(p)
    said = words[i - 1].norm if i else ""
    kind = {"overrightarrow": "ray", "overleftrightarrow": "line"}.get(p.wrap, "")
    kind = kind or {"ray": "ray", "rays": "ray", "line": "line", "lines": "line"}.get(said, "segment")
    if kind == "ray":
        return any(split_names(x) == [a, b] for x in facts.rays)
    pool = facts.lines if kind == "line" else facts.segments
    return any(set(split_names(x)) == {a, b} for x in pool)
