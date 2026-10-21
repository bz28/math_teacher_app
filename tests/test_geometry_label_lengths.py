"""Triangles whose measurements live only in their labels still draw.

Prod, 2026-10-18: the generator emitted `side_labels` like {"AC": "9",
"BC": "40"} with no `side_lengths`, so the solver saw "0 sides" and
dropped 6 of 7 triangle figures — the problems shipped saying "in the
figure below" with no figure. The fixtures are those specs, verbatim.
"""
from __future__ import annotations

import math
from typing import Any

import pytest

from api.core.geometry import render_figure_or_none
from api.core.geometry.dsl import FigureSpecError
from api.core.geometry.renderer import render_figure
from api.core.geometry.solver import _label_angle, _label_length


@pytest.mark.parametrize(("label", "length"), [
    ("9", 9.0), ("6.5", 6.5), ("13 cm", 13.0), ("$12$", 12.0),
    ("6√2", 6 * math.sqrt(2)), ("√34", math.sqrt(34)), ("2\\sqrt{13}", 2 * math.sqrt(13)),
])
def test_a_measurement_label_reads_as_a_length(label: str, length: float) -> None:
    got = _label_length(label)
    assert got is not None and math.isclose(got, length)


@pytest.mark.parametrize("label", ["?", "x", "2x + 1", "a", "h", "", "x cm"])
def test_an_unknown_label_is_not_a_length(label: str) -> None:
    assert _label_length(label) is None


def _tri(**kw: Any) -> dict[str, Any]:
    return {"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"], **kw}


PROD_SPECS = {
    "pythagorean legs 9 and 40": _tri(right_angle_at=["C"], side_labels={"AC": "9", "BC": "40", "AB": "?"}),
    "45-45-90 legs 6√2": _tri(right_angle_at=["C"], angles={"A": 45, "B": 45},
                              side_labels={"AC": "6√2", "BC": "6√2", "AB": "?"}),
    "30-60-90, angles only": _tri(right_angle_at=["C"], angles={"A": 30, "B": 60},
                                  side_labels={"BC": "?", "AC": "?", "AB": "?"}),
}


@pytest.mark.parametrize("name", PROD_SPECS)
def test_prod_specs_that_were_dropped_now_draw(name: str) -> None:
    assert render_figure_or_none(PROD_SPECS[name]) is not None


def test_a_label_that_contradicts_the_drawing_is_still_rejected() -> None:
    # 3-4-5 cannot have a hypotenuse labeled 7.
    with pytest.raises(FigureSpecError):
        render_figure(_tri(right_angle_at=["C"], side_labels={"AC": "3", "BC": "4", "AB": "7"}))


def test_an_explicit_length_beats_its_label() -> None:
    # The label is display text ("10 m"); the solver honours side_lengths.
    spec = _tri(right_angle_at=["C"], side_lengths={"AC": 3, "BC": 4}, side_labels={"AC": "10 m"})
    assert render_figure_or_none(spec) is not None


def test_one_length_and_a_right_angle_is_still_underdetermined() -> None:
    with pytest.raises(FigureSpecError, match="underdetermined"):
        render_figure(_tri(right_angle_at=["B"], side_labels={"AC": "13", "AB": "?", "BC": "?"}))


@pytest.mark.parametrize(("label", "deg"), [
    ("38°", 38.0), ("38", 38.0), ("$38^\\circ$", 38.0), ("38^{\\circ}", 38.0), ("72.5 degrees", 72.5),
])
def test_a_measurement_angle_label_reads_as_an_angle(label: str, deg: float) -> None:
    assert _label_angle(label) == deg


@pytest.mark.parametrize("label", ["6x − 12°", "x", "θ", "?", "(2x+5)°", ""])
def test_an_unknown_angle_label_is_not_an_angle(label: str) -> None:
    assert _label_angle(label) is None


def test_an_angle_label_that_contradicts_the_drawing_is_rejected() -> None:
    # Prod, 2026-10-21: an isosceles 5-5-4 triangle has ≈47° at A, not the 38° it was labeled.
    with pytest.raises(FigureSpecError, match="angle at A"):
        render_figure(_tri(side_lengths={"AB": 5, "AC": 5, "BC": 4},
                           angle_labels={"A": "38°", "B": "6x − 12°"}))


def test_an_angle_label_completes_an_underdetermined_triangle() -> None:
    # Two labeled sides and the labeled angle between them fix the triangle (SAS).
    spec = _tri(side_labels={"AB": "8", "AC": "6"}, angle_labels={"A": "50°"})
    assert render_figure_or_none(spec) is not None
