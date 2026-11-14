"""A figure's labels are plain text in the drawing.

#998's generation eval (v7, set2-p4) drew a checked figure whose angle
labels came out as "$(3x+14)°$": the AI wrote math markup in a label and
the renderer printed it as it was. A label's markup is now turned into its
characters, and markup that can't be shown as plain text makes the figure
malformed (so it is redrawn, or dropped), never shown raw.
"""
from __future__ import annotations

from typing import Any

import pytest

from api.core.geometry import render_figure
from api.core.geometry.dsl import ConstructionFigure, plain_label
from api.core.geometry.facts import Fact, FigureFacts
from api.core.question_bank_generation import _BASE_UNREADABLE, _check_figure

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
    ("$m\\angle C = 50^{\\circ}$", "m∠C = 50°"),
])
def test_a_label_is_shown_as_plain_text(label: str, shown: str) -> None:
    assert plain_label(label) == shown


def test_markup_that_cant_be_plain_text_makes_the_figure_malformed() -> None:
    with pytest.raises(ValueError, match="math markup"):
        ConstructionFigure.model_validate({**SPEC, "side_labels": {"AB": "$\\frac{1}{2}$"}})


def test_the_drawing_never_prints_a_dollar_sign() -> None:
    svg = render_figure(SPEC)
    assert "$" not in svg and "(3x+14)°" in svg and "(5x-10)°" in svg


# ── Review round 1 of the label fix (#989)

def F(kind: str, items: list[str], **kw: Any) -> Fact:  # noqa: N802
    return Fact(kind=kind, items=items, **kw)  # type: ignore[arg-type]


@pytest.mark.parametrize("label", [
    "$\\cdots$", "$\\triangleq$", "$\\triangleright$", "$\\circledast$", "$\\pin$", "$\\timesx$", "$\\congruent$",
    "$\\anglex$", "$\\degrees$",
])
def test_a_longer_command_is_refused_not_read_as_a_symbol(label: str) -> None:
    """"\\cdots" is not "\\cdot" + "s": each symbol ends at a non-letter."""
    with pytest.raises(ValueError, match="math markup"):
        plain_label(label)


@pytest.mark.parametrize(("label", "shown"), [
    ("$a_1$", "a₁"), ("$a_{1}$", "a₁"), ("$x^2$", "x²"), ("$x^{2}$", "x²"), ("$x_{12}$", "x₁₂"),
    ("$(x^2 + 3)$", "(x² + 3)"),
])
def test_a_digit_script_is_its_character(label: str, shown: str) -> None:
    """One rule for "_" and "^": a digit becomes its sub/superscript."""
    assert plain_label(label) == shown


@pytest.mark.parametrize("label", ["$x^n$", "$a_b$", "$x^{-1}$", "$a_{n+1}$", "a_", "x^"])
def test_any_other_script_is_refused(label: str) -> None:
    with pytest.raises(ValueError, match="math markup"):
        plain_label(label)


SEQ = r"In $\triangle ABC$, the side $\overline{BC}$ is $a_1$ and $AB = 5$. Find $a_1$."
SEQ_FACTS = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
    F("equal_length", ["AB"], value=5, quote="AB = 5")])
SEQ_FIG = {"type": "geometry", "shape": "construction", "points": {"A": [3, 4], "B": [0, 0], "C": [6, 0]},
           "segments": ["AB", "BC", "CA"]}


@pytest.mark.parametrize("problem", [SEQ, SEQ.replace("a_1", "a_{1}")])
@pytest.mark.parametrize("label", ["$a_1$", "$a_{1}$"])
def test_a_subscripted_name_the_problem_gives_passes_the_label_check(label: str, problem: str) -> None:
    """The label is drawn as "a₁"; the checker still finds it in the
    problem's "$a_1$" or "$a_{1}$", so the converted form isn't refused."""
    spec = {**SEQ_FIG, "side_labels": {"BC": label}}
    assert plain_label(label) == "a₁"
    _spec, svg, issues = _check_figure(spec, problem, facts=SEQ_FACTS)
    assert issues == [] and svg and "a₁" in svg
    other = {**SEQ_FIG, "side_labels": {"BC": "$a_2$"}}
    assert _check_figure(other, problem, facts=SEQ_FACTS)[2]  # a name the problem doesn't give


def test_a_superscript_label_is_the_problems_expression() -> None:
    """"(x^2 + 10)°" is drawn as "(x² + 10)°" and is still the problem's
    own expression for ∠B."""
    from api.core.geometry.figure_check import _same_algebra

    assert _same_algebra(plain_label("$(x^2 + 10)°$"), "(x^2 + 10)^\\circ")
    assert _same_algebra(plain_label("$(x^{2} + 10)°$"), "(x^{2}+10)°")
    assert not _same_algebra(plain_label("$(x^3 + 10)°$"), "(x^2 + 10)°")


AREA = r"In $\triangle ABC$, $AB = 5$, $AC = 5$, and $BC = 6$. Find the area of $\triangle ABC$."
AREA_FACTS = FigureFacts(points=list("ABC"), triangles=["ABC"], givens=[
    F("equal_length", ["AB"], value=5, quote="AB = 5"), F("equal_length", ["AC"], value=5, quote="AC = 5"),
    F("equal_length", ["BC"], value=6, quote="BC = 6")])
STEP = r"Draw the altitude $\overline{AD}$ to $\overline{BC}$."
BASE = {"type": "geometry", "shape": "construction", "points": {"A": [3, 4], "B": [0, 0], "C": [6, 0]},
        "segments": ["AB", "BC", "CA"]}
MOVED = {"type": "geometry", "shape": "construction",
         "points": {"A": [1, 6], "B": [0, 0], "C": [6, 0], "D": [1, 0]},
         "segments": ["AB", "BC", "CA", "AD"], "right_angles": ["ADC"]}


def test_a_step_figure_is_refused_when_the_questions_figure_cant_be_read() -> None:
    """Fail closed: a stored question figure whose label a later rule
    refuses ("$5\\text{ cm}$") can't be the step's base, so the step figure
    that moves A is refused, not passed unchecked."""
    unreadable = {**BASE, "side_labels": {"AB": "$5\\text{ cm}$"}}
    with pytest.raises(ValueError):
        ConstructionFigure.model_validate(unreadable)
    assert _check_figure(MOVED, AREA, step_text=STEP, base=BASE, facts=AREA_FACTS)[2]  # caught with a good base
    spec, svg, issues = _check_figure(MOVED, AREA, step_text=STEP, base=unreadable, facts=AREA_FACTS)
    assert (spec, svg, issues) == (None, None, [_BASE_UNREADABLE])
