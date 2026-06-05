"""Geometry DSL + renderer.

LLMs emit a `FigureSpec` (constrained JSON describing geometric
relationships); the solver computes exact vertex coordinates from
those relationships; the renderer outputs SVG. The LLM never produces
pixels — coordinates are derived deterministically, so an angle
labeled 90° is drawn at exactly 90°.

v1 covers triangles only (point, segment, triangle, right-angle
marker, length/angle/vertex labels). Future PRs extend the DSL with
circles, polygons, transformations, and a `graph` figure-type for
function plots.

Public entry point: `render_figure(spec_dict) -> str` returns an SVG
string, or raises FigureSpecError on invalid input.
"""

from api.core.geometry.dsl import FigureSpec, FigureSpecError
from api.core.geometry.renderer import render_figure

__all__ = ["FigureSpec", "FigureSpecError", "render_figure"]
