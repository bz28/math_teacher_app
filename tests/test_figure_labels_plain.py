"""A figure's labels are plain text in the drawing.

#998's generation eval (v7, set2-p4) drew a checked figure whose angle
labels came out as "$(3x+14)°$": the AI wrote math markup in a label and
the renderer printed it as it was. A label's markup is now turned into its
characters, and markup that can't be shown as plain text makes the figure
malformed (so it is redrawn, or dropped), never shown raw.
"""
from __future__ import annotations

import pytest

from api.core.geometry import render_figure
from api.core.geometry.dsl import ConstructionFigure, plain_label

SPEC = {
    "type": "geometry", "shape": "construction",
    "points": {"A": [0, 6], "B": [8, 6], "C": [8, 2], "D": [0, 2], "E": [3, 6], "F": [6.357, 2],
               "P": [0.482, 9], "Q": [8.875, -1]},
    "lines": [{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["P", "Q"]}],
    "parallel_groups": [["AB", "CD"]],
    "angle_labels": {"BEF": "$(3x+14)°$", "DFE": "$(5x-10)^\\circ$"},
}


@pytest.mark.parametrize(("label", "shown"), [
    ("$(3x+14)°$", "(3x+14)°"),
    ("$(5x-10)^\\circ$", "(5x-10)°"),
    ("$112^{\\circ}$", "112°"),
    ("$3\\sqrt{2}$", "3√2"),
    ("$5\\pi$", "5π"),
    ("40°", "40°"),
])
def test_a_label_is_shown_as_plain_text(label: str, shown: str) -> None:
    assert plain_label(label) == shown


def test_markup_that_cant_be_plain_text_makes_the_figure_malformed() -> None:
    with pytest.raises(ValueError, match="math markup"):
        ConstructionFigure.model_validate({**SPEC, "side_labels": {"AB": "$\\frac{1}{2}$"}})


def test_the_drawing_never_prints_a_dollar_sign() -> None:
    svg = render_figure(SPEC)
    assert "$" not in svg and "(3x+14)°" in svg and "(5x-10)°" in svg
