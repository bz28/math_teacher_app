"""Review round 11 (the confirm round at 1a985ad3) of PR #989: the Corollary is off the method list.

After round 9 "the Corollary to the Triangle Sum Theorem" counted when the
problem's one listed triangle had its right angle stated. The reviewer's
script: "In △ABC, ∠ACB is a right angle and point D is on AB. m∠A = 30°.
Using the Corollary…, find m∠ACD." The corollary is applied to triangle
ACD, which the text never names; using it there asserts CD ⊥ AB, which no
fact states, so a drawing with D anywhere on AB passed. A method name can't
say which right triangle it is applied to, so the Corollary is not on the
list at all (coordinator, 2026-11-14), and 1c9d21ab is refused again.
"""

from __future__ import annotations

import math
from typing import Any

from api.core.construction_figures import trusted_reading
from api.core.geometry import coverage as cv
from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, Target, standard_reading
from api.core.geometry.figure_check import check_construction

TEXT = (r"In $\triangle ABC$, $\angle ACB$ is a right angle and point $D$ is on $\overline{AB}$. "
        r"$m\angle A = 30^\circ$. Using the Corollary to the Triangle Sum Theorem, find $m\angle ACD$.")


def F(kind: str, items: list[str], **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=items, **kw)


READING = FigureFacts(points=list("ABCD"), triangles=["ABC"], segments=["CD"], find=[Target(kind="angle", item="ACD")],
                      givens=[F("right_angle", ["ACB"], quote="∠ACB is a right angle"),
                              F("on_segment", ["AB"], point="D", quote="point D is on AB"),
                              F("angle_measure", ["A"], value=30, quote="m∠A = 30°")])


def test_the_corollary_on_an_unnamed_right_triangle_does_not_pass() -> None:
    """The reviewer's script c1.py: D the midpoint of AB, so CD is not ⊥ AB."""
    ab = 6 / math.cos(math.radians(30))
    c = (6 * math.cos(math.radians(30)), 6 * math.sin(math.radians(30)))
    wrong = ConstructionFigure.model_validate({
        "type": "geometry", "shape": "construction",
        "points": {"A": (0, 0), "B": (ab, 0), "C": c, "D": (ab / 2, 0)},
        "segments": ["AB", "BC", "CA", "CD"], "right_angles": ["ACB"], "angle_labels": {"BAC": "30°"}})
    assert any("Corollary" in g for g in cv.coverage(TEXT, standard_reading(READING))[0])
    trusted = trusted_reading(TEXT, READING, READING)[0]
    assert trusted is None or check_construction(wrong, TEXT, facts=trusted)


def test_the_corollary_is_on_no_method_list() -> None:
    assert not [rx for rx, _needs, _c in cv.METHOD_NAMES if "corollary" in rx.lower()]
