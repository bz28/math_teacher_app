"""A problem that refers to a figure, in any wording, needs one.

Cold review round 1 of the stacked generation PR (#998) found
`_FIGURE_REFERENCE` missed "The figure shows…", "Look at the diagram:" and
"In the given figure…", so such a problem could ship pointing at a figure
it doesn't have. It now matches any reference to a figure, diagram,
picture, drawing, sketch or illustration. Erring wide only makes more
problems need a figure; it can't let a wrong figure pass.
"""

from __future__ import annotations

import pytest

from api.core.question_bank_generation import _FIGURE_REFERENCE, _lacks_figure


@pytest.mark.parametrize("text", [
    "The figure shows a triangle with AB = 5. Find BC.",
    "Look at the diagram: find x.",
    "In the given figure, find x.",
    "In the figure below, find x.",
    "Use the diagram to find m∠A.",
    "In this diagram, AB = 5.",
    "The accompanying figure shows two parallel lines.",
    "As shown, AB = 5 and BC = 7.",
    "The quadrilateral pictured has two right angles.",
    "The sketch at right shows a lot ABCD.",
    "Points A and B are shown below.",
    "The triangle shown has AB = 4.",
    "Find x in the drawing below.",
    "Refer to Figure 2.",
    "The illustration shows a ramp.",
])
def test_a_reference_to_a_figure_needs_one(text: str) -> None:
    assert _FIGURE_REFERENCE.search(text), text
    assert _lacks_figure({"text": text})
    assert not _lacks_figure({"text": text, "figure_svg": "<svg/>"})


@pytest.mark.parametrize("text", [
    "A figure skater spins at 3 revolutions per second.",
    "Use the graph paper to plot y = 2x.",
    "A plane flies 300 feet above the ground.",
    "The data are as shown in the table.",
    "Figure out how many apples are left.",
    "Round the answer to 3 significant figures.",
    "Solve 2x + 3 = 11.",
])
def test_words_that_point_at_nothing(text: str) -> None:
    assert not _FIGURE_REFERENCE.search(text), text
