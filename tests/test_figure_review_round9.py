"""Review round 9 of PR #989: every point a rule derives keeps its part's written kind.

The reviewer at 44fefada found the "cuts both lines at points G and H
respectively" rule deriving G and H on LINE EF even when the text wrote
segment EF or ray EF, so a segment EF far from both lines (or a ray
pointing away) passed. The rule now derives each point on each part as the
text writes it (bar: segment, arrow: ray, double arrow or "line": line),
and a part written bare is a gap, as the "intersects" rule does.

The audit below lists every derivation rule in coverage.py and fails if
any derives a point on a line from a part written as a segment or a ray.
It also pins the reviewer's edge: a perpendicular whose sides share an
endpoint kept the right angle but dropped a stated foot elsewhere.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from api.core.construction_figures import trusted_reading
from api.core.geometry import coverage as cv
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, Target, disagreements, standard_reading
from api.core.geometry.figure_check import _clean, check_construction


def fig(**kw: Any) -> ConstructionFigure:
    return ConstructionFigure.model_validate({"type": "geometry", "shape": "construction", **kw})


def F(kind: str, items: tuple[str, ...] | list[str] = (), **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=list(items), **kw)  # type: ignore[arg-type]


def passes(text: str, facts: FigureFacts, figure: ConstructionFigure) -> bool:
    t = trusted_reading(text, facts, facts)[0]
    return t is not None and not check_construction(figure, text, facts=t)


Q = "EF cuts both lines at points G and H respectively"
_PTS = {"A": (0, 0), "B": (6, 0), "C": (0, 4), "D": (6, 4), "G": (3, 0), "H": (3, 4)}


def _resp(**parts: list[str]) -> FigureFacts:
    return FigureFacts(points=list("ABCDEFGH"), find=[Target(kind="segment", item="GH")], **parts, givens=[
        F("parallel", ["AB", "CD"], quote="AB ∥ CD"), F("intersect", ["EF", "AB"], point="G", quote=Q),
        F("intersect", ["EF", "CD"], point="H", quote=Q)])


SEG = (r"Given: $\overline{AB} \parallel \overline{CD}$, and $\overline{EF}$ cuts both lines at points $G$ and $H$ "
       r"respectively. Find $GH$.")
RAY = SEG.replace(r"\overline{EF}", r"\overrightarrow{EF}")


def test_respectively_puts_the_points_on_segment_ef() -> None:
    """Reviewer t2: segment EF wholly above CD, G and H on its line."""
    facts = _resp(segments=["AB", "CD", "EF"])
    above = fig(points={**_PTS, "E": (3, 5), "F": (3, 6)}, segments=["AB", "CD", "EF"], parallel_groups=[["AB", "CD"]])
    assert not passes(SEG, facts, above)
    across = fig(points={**_PTS, "E": (3, -1), "F": (3, 5)}, segments=["AB", "CD", "EF"],
                 parallel_groups=[["AB", "CD"]])
    assert passes(SEG, facts, across)


def test_respectively_puts_the_points_on_ray_ef() -> None:
    """Reviewer t3: ray EF pointing away from both lines."""
    facts = _resp(segments=["AB", "CD"], rays=["EF"])
    away = fig(points={**_PTS, "E": (3, 5), "F": (3, 6)}, segments=["AB", "CD"], rays=["EF"],
               parallel_groups=[["AB", "CD"]])
    assert not passes(RAY, facts, away)
    toward = fig(points={**_PTS, "E": (3, 5), "F": (3, 3)}, segments=["AB", "CD"], rays=["EF"],
                 parallel_groups=[["AB", "CD"]])
    assert passes(RAY, facts, toward)


def test_respectively_with_a_bare_name_is_a_gap() -> None:
    text = SEG.replace(r"$\overline{EF}$", "$EF$")
    assert cv.coverage(text, standard_reading(_resp(segments=["AB", "CD", "EF"])))[0] != []


# ── The audit: each rule that places a point keeps the written kind ──

_KIND = {"overline": "on_segment", "overrightarrow": "on_ray", "overleftrightarrow": "on_line"}

# One text per derivation rule that places a point, with every part written
# as a segment, then as a ray. (The other derivation rules place no point:
# "the base angles satisfy" derives equal legs, the exterior-angle rules an
# extension, "each / one / the vertex angle" a measure, "altitude CD" a
# perpendicular whose foot is on the opposite side's LINE by definition: an
# obtuse triangle's altitude meets that side extended. It reads the side
# from the triangle, never from a written part.)
PLACING = {
    "intersects": (r"In $\triangle PQR$, ray $\overrightarrow{QT}$ bisects $\angle PQR$ and intersects "
                   r"$\overline{PR}$ at $S$.",
                   FigureFacts(points=list("PQRST"), triangles=["PQR"], rays=["QT"], givens=[
                       F("bisects_angle", ["QT", "PQR"], quote="ray QT bisects ∠PQR"),
                       F("on_segment", ["PR"], point="S", quote="intersects PR at S"),
                       F("on_ray", ["QT"], point="S", quote="intersects PR at S")])),
    "respectively": (SEG, _resp(segments=["AB", "CD", "EF"])),
}


def _written(text: str) -> dict[str, str]:
    """Each part name's written kind in the text."""
    return {k.norm: _KIND[k.wrap] for k in cv.tokens(_clean(text)) if k.kind == "name" and k.wrap in _KIND}


@pytest.mark.parametrize("rule", sorted(PLACING))
@pytest.mark.parametrize("swap", [{}, {r"\overline": r"\overrightarrow"}, {r"\overrightarrow": r"\overline"}])
def test_every_derived_point_is_on_its_part_as_written(rule: str, swap: dict[str, str]) -> None:
    text, facts = PLACING[rule]
    for a, b in swap.items():
        text = text.replace(a, b)
    written = _written(text)
    derived = cv.coverage(text, standard_reading(facts))[1]
    placed = [(kind, x) for d in derived for kind, xs in (
        [("on_line", d.items)] if d.kind == "intersect" else [(d.kind, d.items)])
        if kind in ("on_segment", "on_ray", "on_line") for x in xs]
    assert placed, (rule, text)  # the rule fired
    for kind, x in placed:
        assert written.get(x) == kind, (rule, x, kind, written.get(x))


def test_no_rule_writes_a_points_kind_by_hand() -> None:
    """In coverage.py a derived point's kind comes from _on_kind (the
    written part) or from parts all written as lines; never a literal."""
    src = Path(cv.__file__).read_text()
    literal = [m.start() for m in re.finditer(r'Fact\(kind="(?:on_segment|on_ray|on_line|intersect)"', src)]
    assert len(literal) == 1  # lines meeting at a point, in "respectively"
    before = src[:literal[0]].rsplit("\n", 3)[-3:]
    assert any('set(kinds) == {"on_line"}' in line for line in before)


# ── A perpendicular at a shared endpoint keeps a stated foot ─────────

def test_a_perpendicular_with_a_shared_endpoint_keeps_its_foot() -> None:
    def reading(point: str | None) -> FigureFacts:
        return FigureFacts(points=list("ABCD"), segments=["AB", "BC"],
                           givens=[F("perpendicular", ["AB", "BC"], point=point, quote="AB ⊥ BC")])
    assert disagreements(reading("D"), reading(None)) != []
    assert disagreements(reading("B"), reading(None)) == []  # the shared corner says nothing more
