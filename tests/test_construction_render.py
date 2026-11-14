"""Construction figures: the spec format (dsl.py) and the drawing
(construction_render.py), plus the guarantee that the old triangle /
circle / polygon figures draw exactly as before."""

from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from typing import Any

import pytest
from pydantic import ValidationError

from api.core.geometry.dsl import ConstructionFigure, split_points
from api.core.geometry.renderer import figure_point_names, render_figure


def spec(**kw: Any) -> dict[str, Any]:
    return {"type": "geometry", "shape": "construction", **kw}


EVERYTHING = spec(
    points={
        "A": [0, 0], "B": [6, 0], "C": [6, 4], "D": [0, 4], "M": [3, 0], "O": [3, 2],
        "_h": [8, 2], "E": [9, 4],
    },
    segments=["AB", "BC", "CD", "DA", "AC"],
    rays=["OE"],
    lines=[{"name": "ell_1", "through": ["D", "_h"]}],
    circles=[{"center": "O", "radius": 1}],
    arcs=[{"center": "A", "endpoints": ["M", "D"]}],
    sectors=[{"center": "B", "endpoints": ["C", "M"]}],
    shaded=[{"polygon": ["A", "M", "O"]}],
    tick_groups=[["AM", "MB"]],
    arc_groups=[["BAC", "DCA"]],
    right_angles=["DAB"],
    parallel_groups=[["AB", "DC"]],
    angle_labels={"BCA": "x"},
    side_labels={"BC": "4"},
)


# ── Sanitizer-safe output ──────────────────────────────────────────────

# web/src/lib/sanitize-svg.ts: ADD_TAGS, and ADD_ATTR plus what DOMPurify's
# svg profile and ARIA defaults already allow.
_ALLOWED_TAGS = {"svg", "path", "circle", "rect", "line", "polyline", "polygon", "text", "g", "defs", "marker", "tspan"}
_ALLOWED_ATTRS = {
    "viewBox", "d", "cx", "cy", "r", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "fill",
    "stroke", "stroke-width", "font-size", "text-anchor", "transform", "points", "marker-end",
    "marker-start", "xmlns", "role", "aria-label", "preserveAspectRatio", "fill-opacity",
    "stroke-linecap", "stroke-linejoin", "font-family", "font-style", "font-weight", "opacity",
    # The existing renderer's text helper sets it; DOMPurify drops it, which
    # only nudges a label (pre-existing, same as the triangle figures).
    "dominant-baseline",
}


def _elements(svg: str) -> list[ET.Element]:
    return list(ET.fromstring(svg).iter())


def test_output_uses_only_sanitizer_allowed_tags_and_attributes() -> None:
    svg = render_figure(EVERYTHING)
    for el in _elements(svg):
        tag = el.tag.split("}")[-1]
        assert tag in _ALLOWED_TAGS, tag
        assert set(el.attrib) <= _ALLOWED_ATTRS, (tag, set(el.attrib) - _ALLOWED_ATTRS)


def test_no_background_rect_and_theme_colour() -> None:
    svg = render_figure(EVERYTHING)
    assert "<rect" not in svg
    assert "currentColor" in svg
    assert not re.search(r'(?:fill|stroke)="#', svg)


def test_drawing_is_deterministic() -> None:
    assert render_figure(EVERYTHING) == render_figure(EVERYTHING)


def test_every_part_is_drawn() -> None:
    svg = render_figure(EVERYTHING)
    tags = [el.tag.split("}")[-1] for el in _elements(svg)]
    assert tags.count("circle") >= 1 + 7  # the circle + a dot per visible point
    assert 'fill-opacity="0.15"' in svg  # shading
    assert "polyline" in tags  # right-angle box, chevrons
    texts = [el.text for el in _elements(svg) if el.tag.endswith("text")]
    assert {"A", "B", "C", "D", "M", "O", "E", "x", "4", "ℓ1"} <= set(texts)


def test_hidden_points_are_not_drawn_or_labelled() -> None:
    svg = render_figure(EVERYTHING)
    texts = [el.text for el in _elements(svg) if el.tag.endswith("text")]
    assert "_h" not in texts and "h" not in texts
    dots = [el for el in _elements(svg) if el.tag.endswith("circle")]
    assert len(texts) == len(set(texts))
    assert len(dots) == 1 + 7  # one circle + A B C D M O E; no dot for _h
    assert set(figure_point_names(EVERYTHING)) == {"A", "B", "C", "D", "M", "O", "E"}


def test_whole_angle_label_gets_its_own_arc() -> None:
    """∠JKL split by the bisector KM: the label for the whole angle sits by
    a wide arc across it, not on the bisector ray."""
    base = spec(
        points={"J": [1, 6], "K": [0, 0], "L": [6, 0], "M": [4.6, 3.86]},
        rays=["KJ", "KM", "KL"],
    )
    plain = render_figure(base)
    labelled = render_figure({**base, "angle_labels": {"JKL": "10x - 4"}})
    assert labelled.count("<path") == plain.count("<path") + 1
    # Wide, not the small arc a measure label on an unsplit angle gets.
    unsplit = render_figure({**base, "rays": ["KJ", "KL"], "angle_labels": {"JKL": "10x - 4"}})
    assert max(_arc_radii(labelled)) > 3 * max(_arc_radii(unsplit))


def _arc_radii(svg: str) -> list[float]:
    return [float(r) for r in re.findall(r" A([0-9.]+),", svg)]


def test_measure_label_gets_an_arc_but_angle_name_does_not() -> None:
    base = spec(points={"A": [4, 3], "B": [0, 0], "C": [5, 0]}, segments=["BA", "BC"])
    plain = render_figure(base).count("<path")
    assert render_figure({**base, "angle_labels": {"ABC": "37°"}}).count("<path") == plain + 1
    assert render_figure({**base, "angle_labels": {"ABC": "1"}}).count("<path") == plain


# ── Old shapes: byte-identical to main ─────────────────────────────────

# sha256 of each figure rendered by origin/main before this change.
_OLD = [
    ({"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"],
      "side_lengths": {"AB": 3, "BC": 4, "CA": 5}, "show_right_angle": True},
     "480663bc7552be915e975d4db46b79dd9a2dffcf50302a2a821445ca450d4c0b"),
    ({"type": "geometry", "shape": "triangle", "vertices": ["P", "Q", "R"], "side_lengths": {"PQ": 7},
      "angles": {"P": 40, "Q": 65}, "labels": {"PQ": "7"}},
     "8e3245ac15f6cce4a6195379575938419fc38f2a7149930eb1fe018ad2b2b50b"),
    ({"type": "geometry", "shape": "circle", "radius": 5, "points": {"A": 0, "B": 90, "C": 200}, "chords": ["AB"]},
     "08673a16a4db8068bbca189a2bb278bc39a5455a0e5b70d0b2054decdd728902"),
    ({"type": "geometry", "shape": "polygon", "vertices": ["A", "B", "C", "D"], "n_sides": 6},
     "8bba22ad1d808e9d4f9af737db704505c244921669ed09d4712130b7eea733aa"),
]


@pytest.mark.parametrize(("old", "digest"), _OLD, ids=["sss", "asa", "circle", "polygon"])
def test_old_shapes_render_byte_identically(old: dict[str, Any], digest: str) -> None:
    assert hashlib.sha256(render_figure(old).encode()).hexdigest() == digest


# ── The spec format ────────────────────────────────────────────────────


def test_split_points() -> None:
    assert split_points("AB", 2) == ("A", "B")
    assert split_points("A'B'", 2) == ("A'", "B'")
    assert split_points("A_p1B", 3) == ("A", "_p1", "B")
    assert split_points("X1Y2", 2) == ("X1", "Y2")
    with pytest.raises(ValueError):
        split_points("ABC", 2)


@pytest.mark.parametrize(
    ("bad", "why"),
    [
        ({"points": {"a": [0, 0], "B": [1, 0]}, "segments": ["aB"]}, "point name"),
        ({"points": {"_P": [0, 0], "B": [1, 0]}}, "point name"),
        ({"points": {"A": [0, 0], "B": [1, 0]}, "segments": ["AC"]}, "C"),
        ({"points": {"A": [0, 0], "B": [0, 0]}, "segments": ["AB"]}, "same spot"),
        ({"points": {"A": [0, 0], "B": [float("inf"), 0]}}, "finite"),
        ({"points": {"A": [0, 0], "B": [1, 0]}, "circles": [{"center": "A"}]}, "exactly one"),
        ({"points": {"A": [0, 0], "B": [1, 0]}, "circles": [{"center": "A", "radius": 1, "through": "B"}]},
         "exactly one"),
        ({"points": {"A": [0, 0], "B": [1, 0]}, "circles": [{"center": "A", "radius": -1}]}, "positive"),
        ({"points": {"A": [0, 0], "B": [1, 0], "C": [0, 1]}, "shaded": [{}]}, "exactly one"),
        ({"points": {f"P{i}": [i, 0] for i in range(41)}}, "40"),
    ],
)
def test_invalid_specs_rejected(bad: dict[str, Any], why: str) -> None:
    with pytest.raises(ValidationError, match=re.escape(why)):
        ConstructionFigure.model_validate(spec(**bad))


def test_labels_of_nearby_points_dont_overlap() -> None:
    """Found by eye in the round-1 eval (12c77989): B and D two units apart
    had their labels drawn on top of each other."""
    svg = render_figure(spec(
        points={"A": [0, 0], "B": [12, 0], "C": [3.896, 3.894], "D": [14, 0], "E": [22, 0], "F": [16.597, 2.596]},
        segments=["AB", "BC", "CA", "DE", "EF", "FD"],
    ))
    at = {
        t.text: (float(t.get("x") or 0), float(t.get("y") or 0))
        for t in ET.fromstring(svg).iter("{http://www.w3.org/2000/svg}text")
    }
    (bx, by), (dx, dy) = at["B"], at["D"]
    font = 0.28  # the vertex labels' font size in the canonical frame
    assert abs(bx - dx) > font or abs(by - dy) > font, (at["B"], at["D"])
