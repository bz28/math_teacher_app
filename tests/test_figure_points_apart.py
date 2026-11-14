"""Two named points drawn too close to tell apart are refused.

Found by eye in the stacked generation PR's eval (#998, set1-p7): "∠ADB and
∠BCA are right angles, AD = 5 and BC = 5" drawn with C and D 2.03% of the
figure apart. Both right triangles were true in the drawing, but they lay on
top of each other and the C and D labels touched, so a student couldn't
tell them apart. The bar was 2% of the figure's size; it is now 5% (about
26 px at the rendered width), which refused no figure in the construction
eval or the adversarial cases.
"""

from __future__ import annotations

from typing import Any

from api.core.geometry.dsl import ConstructionFigure
from api.core.geometry.facts import Fact, FigureFacts, standard_reading
from api.core.geometry.figure_check import check_construction

TEXT = (r"In the figure below, $\angle ADB$ and $\angle BCA$ are right angles. $AD = 5$ and $BC = 5$. "
        r"Prove: $\triangle ADB \cong \triangle BCA$.")
FACTS = FigureFacts(points=list("ABCD"), triangles=["ADB", "BCA"], givens=[
    Fact(kind="right_angle", items=["ADB"], quote="∠ADB … right angles"),
    Fact(kind="right_angle", items=["BCA"], quote="∠BCA are right angles"),
    Fact(kind="equal_length", items=["AD"], value=5, quote="AD = 5"),
    Fact(kind="equal_length", items=["BC"], value=5, quote="BC = 5")],
    prove=[Fact(kind="congruent_triangles", items=["ADB", "BCA"], quote="△ADB ≅ △BCA")])


def fig(c: tuple[float, float], d: tuple[float, float], ab: float = 7.0) -> ConstructionFigure:
    spec: dict[str, Any] = {
        "type": "geometry", "shape": "construction",
        "points": {"A": (0.0, 0.0), "B": (ab, 0.0), "C": c, "D": d},
        "segments": ["AB", "AD", "DB", "BC", "CA"], "right_angles": ["ADB", "BCA"],
        "side_labels": {"AD": "5", "BC": "5"},
    }
    return ConstructionFigure.model_validate(spec)


def test_two_points_two_percent_apart_are_refused() -> None:
    """The figure from #998's eval: C and D 0.142 apart in a span of 7."""
    issues = check_construction(fig((3.429, 3.499), (3.571, 3.499)), TEXT, facts=standard_reading(FACTS))
    assert "points C and D are drawn on the same spot" in [i.message for i in issues]


def test_the_same_problem_drawn_with_room_passes_that_check() -> None:
    """AB isn't given: drawn 10 long instead of 7, C and D sit well apart."""
    import math

    # D on the circle with diameter AB (so ∠ADB is right) and AD = 5; C its mirror image.
    x = 25 / 10
    y = math.sqrt(25 - x * x)
    issues = check_construction(fig((10 - x, y), (x, y), ab=10.0), TEXT, facts=standard_reading(FACTS))
    assert not any("same spot" in i.message for i in issues)
