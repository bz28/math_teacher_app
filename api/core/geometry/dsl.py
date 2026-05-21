"""JSON DSL for figure specs.

v1: triangles only. The shape is intentionally flat (one Pydantic
model, not a nested polymorphic shapes/constraints/labels tree)
because triangles have a small fixed surface and a flat model is
easier for the LLM to fill in correctly and easier to validate.

When circles + polygons land, the model grows a discriminated union
keyed on `shape`; the triangle case stays as-is. That migration is
additive — no breaking change to existing stored specs.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class FigureSpecError(ValueError):
    """Raised when a spec is structurally valid but underdetermined,
    overdetermined, or self-inconsistent (e.g. side lengths that
    violate the triangle inequality). The renderer entrypoint catches
    this and surfaces a clean error instead of an SVG."""


# Two-letter edge keys ("AB", "BC", "CA") — order doesn't matter for
# lookup; the solver normalizes via `_canonical_edge` so the LLM can
# emit either "AB" or "BA" and the constraint resolves the same way.
EdgeKey = str


class TriangleFigure(BaseModel):
    """A triangle with optional constraints + display labels.

    To draw a triangle, the solver needs enough constraints to fix
    its shape — three sides (SSS), two sides + included angle (SAS),
    two angles + one side (ASA / AAS), or one side + the right-angle
    flag + one other side (right-triangle SSS). Underdetermined or
    overdetermined specs raise FigureSpecError at solve time, not
    schema time, since "did the LLM give us enough" depends on the
    combination of fields, not any single field.
    """

    type: Literal["geometry"] = "geometry"
    shape: Literal["triangle"] = "triangle"
    vertices: list[str] = Field(min_length=3, max_length=3)

    # Measured constraints — drive the solver. Values are in the
    # natural units of the problem (lengths unitless; angles in
    # degrees). Empty dicts mean "no constraint of this kind."
    side_lengths: dict[EdgeKey, float] = Field(default_factory=dict)
    angles: dict[str, float] = Field(default_factory=dict)

    # Right-angle marker — both a constraint (forces 90° at this
    # vertex) and a display mark (the little square). Listed so a
    # spec can have multiple, though triangles can have at most one.
    right_angle_at: list[str] = Field(default_factory=list)

    # Display-only — what shows up on the drawing. Solver ignores
    # these; renderer reads them. Edge keys mirror side_lengths.
    side_labels: dict[EdgeKey, str] = Field(default_factory=dict)
    angle_labels: dict[str, str] = Field(default_factory=dict)
    # Vertex labels default to the vertex name (e.g. "A") — override
    # only when the problem uses a different label scheme.
    vertex_labels: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_references(self) -> TriangleFigure:
        names = set(self.vertices)
        if len(names) != 3:
            raise ValueError("vertices must be three distinct names")

        for v in self.right_angle_at:
            if v not in names:
                raise ValueError(f"right_angle_at references unknown vertex: {v}")
        if len(self.right_angle_at) > 1:
            raise ValueError("a triangle has at most one right angle")

        for vertex in self.angles:
            if vertex not in names:
                raise ValueError(f"angles references unknown vertex: {vertex}")
        for vertex in self.angle_labels:
            if vertex not in names:
                raise ValueError(f"angle_labels references unknown vertex: {vertex}")
        for vertex in self.vertex_labels:
            if vertex not in names:
                raise ValueError(f"vertex_labels references unknown vertex: {vertex}")

        for edge_key in [*self.side_lengths, *self.side_labels]:
            if len(edge_key) != 2 or not all(c in names for c in edge_key):
                raise ValueError(
                    f"edge key {edge_key!r} must be two vertex names from {sorted(names)}",
                )

        # Negative or zero lengths are nonsense, and constraint angles
        # must be in (0, 180) — a triangle vertex angle equals 0° or
        # 180° only in degenerate cases the renderer can't draw.
        for edge, length in self.side_lengths.items():
            if length <= 0:
                raise ValueError(f"side length {edge}={length} must be positive")
        for vertex, angle in self.angles.items():
            if not (0 < angle < 180):
                raise ValueError(
                    f"angle at {vertex}={angle} must be in (0, 180) degrees",
                )

        return self


# Top-level FigureSpec — kept as a TypeAlias for now since triangles
# are the only shape. When circles + polygons land, this becomes a
# discriminated union: FigureSpec = Annotated[Union[Triangle, Circle,
# ...], Field(discriminator="shape")].
FigureSpec = TriangleFigure
