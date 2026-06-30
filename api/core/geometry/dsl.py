"""JSON DSL for figure specs.

Discriminated union keyed on `shape`. v1 covered triangles only; this
revision adds circles. Each shape is one flat Pydantic model — chosen
over a nested shapes/constraints/labels tree because the LLM produces
flat structures more reliably and because each shape's constraint
math is shape-specific (no real reuse between triangle SSS/SAS and
circle radius+chord).

Adding a new shape (polygon, coordinate plane, transformations, ...)
follows the circle pattern: define a new BaseModel with
`shape: Literal["..."]`, add it to FigureSpec's Annotated union, write
a solver, write a renderer function. No existing stored specs are
affected.
"""

from __future__ import annotations

from typing import Annotated, Literal

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


class TriangleCircleAnnotation(BaseModel):
    """An overlay circle attached to a TriangleFigure — either the
    incircle (inscribed in the triangle, tangent to each side) or the
    circumcircle (passes through every vertex). The renderer computes
    the center + radius from the triangle's own geometry — the LLM
    just opts in by setting the field, and optionally requests
    display affordances (center dot, labeled radius).

    Using compound primitives lets the AMC-classic "circle inscribed
    in a right triangle" render as ONE figure (triangle + overlay)
    rather than two separate shapes that the LLM would have to keep
    geometrically consistent by hand.
    """

    show_center: bool = False
    center_label: str = "O"
    # When set, draws a labeled radius from the center to the first
    # tangent point (incircle) or first vertex (circumcircle).
    radius_label: str | None = None
    # Incircle only: when true, mark the three tangent points where
    # the circle touches the sides. Ignored on circumcircles.
    show_tangent_points: bool = False


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

    # Compound annotations — overlay circles whose geometry is
    # derived from the triangle's own constraints. Both nullable; the
    # renderer computes incenter/circumcenter coordinates and radii
    # at draw time so they're guaranteed consistent with the triangle.
    inscribed_circle: TriangleCircleAnnotation | None = None
    circumscribed_circle: TriangleCircleAnnotation | None = None

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

        # show_tangent_points is only meaningful for the INSCRIBED
        # circle (the renderer marks where the incircle touches each
        # side). Setting it on circumscribed_circle is a silent no-op
        # at render time — surface the misuse explicitly so callers
        # know to put the flag on the right annotation.
        if (
            self.circumscribed_circle is not None
            and self.circumscribed_circle.show_tangent_points
        ):
            raise ValueError(
                "show_tangent_points is only valid on inscribed_circle "
                "(tangent points are the incircle's contact points with "
                "the triangle's sides); set it there instead.",
            )

        # Canonicalize edge keys so 'AB' and 'BA' resolve to the same
        # edge. We reject contradictory duplicates (LLM emits both
        # 'AB' and 'BA' with different values) rather than silently
        # picking one — that's a hidden inconsistency we'd rather
        # surface at validation time.
        def _canon(edge: str) -> str:
            return edge if edge[0] < edge[1] else edge[1] + edge[0]

        for field_name, mapping in (
            ("side_lengths", self.side_lengths),
            ("side_labels", self.side_labels),
        ):
            seen: dict[str, str] = {}
            for edge_key in mapping:
                if len(edge_key) != 2 or not all(c in names for c in edge_key):
                    raise ValueError(
                        f"edge key {edge_key!r} must be two vertex names from {sorted(names)}",
                    )
                canon = _canon(edge_key)
                if canon in seen and seen[canon] != edge_key:
                    raise ValueError(
                        f"{field_name} has both {seen[canon]!r} and {edge_key!r} — "
                        "these reference the same edge; emit one form only",
                    )
                seen[canon] = edge_key

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


class CircleLine(BaseModel):
    """One line used to locate an external point — either the tangent to
    the circle at a named on-circle point, or the secant/chord line
    through two named on-circle points. Exactly one of the two is set.

    Keeping a line *relational* (named points, not coordinates) is what
    lets the solver compute the external point exactly, the same way the
    rest of the engine derives geometry instead of trusting the LLM to
    invent (x, y)."""

    # Tangent to the circle at this named on-circle point.
    tangent_at: str | None = None
    # The line through these two named on-circle points (a secant/chord
    # extended). Order doesn't matter; the solver picks the far end to draw.
    secant_through: list[str] | None = None

    @model_validator(mode="after")
    def _validate(self) -> CircleLine:
        set_count = (self.tangent_at is not None) + (self.secant_through is not None)
        if set_count != 1:
            raise ValueError(
                "a circle line must set exactly one of tangent_at / secant_through",
            )
        if self.secant_through is not None and (
            len(self.secant_through) != 2
            or self.secant_through[0] == self.secant_through[1]
        ):
            raise ValueError("secant_through must list two distinct point names")
        return self


class ExternalPoint(BaseModel):
    """A point OUTSIDE the circle, located as the intersection of two
    lines (each a tangent or a secant defined by on-circle points). The
    solver computes its exact position and the renderer draws the point
    plus the segments from it to the circle.

    This is what makes the external-point Circle Theorems expressible
    without coordinate-guessing: tangent–secant angle (tangent × secant),
    secant–secant / power-of-a-point (secant × secant), and two-tangent
    (tangent × tangent) configurations."""

    line1: CircleLine
    line2: CircleLine
    # Optional display label; defaults to the dict key the point is under.
    label: str | None = None


class CircleFigure(BaseModel):
    """A circle with optional named points on the circumference, chords,
    labeled radii, and angle labels.

    The circle itself is determined by `radius` alone (we place its
    center at the origin internally; the renderer re-centers via the
    viewBox). Named points are positioned by their `angle_deg` —
    measured CCW from the positive x-axis. This is deliberately a
    *single* degree of freedom per point: the LLM doesn't have to
    invent (x, y) coordinates, just an angle, and the solver does the
    trig.

    Chords are unordered vertex pairs (`"AB"` ≡ `"BA"`). The renderer
    canonicalizes; the validator rejects duplicates.
    """

    type: Literal["geometry"] = "geometry"
    shape: Literal["circle"] = "circle"

    # Display label for the center (default "O" — the textbook
    # convention). Shown when show_center is True.
    center_label: str = "O"
    # Radius — drives everything else. Strictly positive.
    radius: float

    # Named points on the circumference, keyed by name, valued by
    # angle in degrees (CCW from positive x-axis).
    points: dict[str, float] = Field(default_factory=dict)
    # Two-character chord identifiers referring to points above. The
    # renderer draws a straight segment between the two named points.
    chords: list[str] = Field(default_factory=list)
    # Whether to draw a small dot + label at the center.
    show_center: bool = False
    # If set, draws a labeled radius to the FIRST named point with
    # the given label text (e.g. "r" or "5").
    radius_label: str | None = None
    # Per-chord display labels, keyed like chords.
    chord_labels: dict[str, str] = Field(default_factory=dict)
    # Display labels at named points (e.g. when the LLM wants point
    # A drawn with a different visible name).
    point_labels: dict[str, str] = Field(default_factory=dict)
    # Points OUTSIDE the circle, each defined as the intersection of two
    # tangent/secant lines. The solver computes their coordinates; the
    # renderer draws the point + the tangent/secant segments to the circle.
    external_points: dict[str, ExternalPoint] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate(self) -> CircleFigure:
        if self.radius <= 0:
            raise ValueError(f"radius must be positive (got {self.radius})")

        names = set(self.points)

        def _canon(edge: str) -> str:
            return edge if edge[0] < edge[1] else edge[1] + edge[0]

        seen_chord: dict[str, str] = {}
        for c in self.chords:
            if len(c) != 2 or not all(ch in names for ch in c):
                raise ValueError(
                    f"chord {c!r} must reference two named points from {sorted(names)}",
                )
            canon = _canon(c)
            if canon in seen_chord and seen_chord[canon] != c:
                raise ValueError(
                    f"chords has both {seen_chord[canon]!r} and {c!r} — "
                    "these reference the same chord; emit one form only",
                )
            seen_chord[canon] = c

        # Tolerate (drop) label keys that don't match a declared chord/point
        # rather than rejecting the whole figure. The LLM routinely keys a
        # label off geometry it never declared structurally — a tangent
        # segment like "TA", or an external point "P" that the circumference-
        # only `points` map can't even express. The renderer already drives
        # entirely off `chords`/`points` and ignores unmatched label keys
        # (`chord_labels.get(chord)`, `point_labels.get(name, name)`), so the
        # strict raise bought nothing — it only turned a harmless unused label
        # into a dropped diagram (the figure never rendered at all). Filtering
        # keeps every valid label and silently discards the stray ones.
        self.chord_labels = {
            k: v for k, v in self.chord_labels.items()
            if k in self.chords or k[::-1] in self.chords
        }
        self.point_labels = {
            k: v for k, v in self.point_labels.items() if k in names
        }

        # External points: names must not collide with circumference points,
        # and every line they reference must point at declared on-circle
        # points. (The geometric checks — lines actually intersect, and the
        # result lies OUTSIDE the circle — need coordinates, so the solver
        # enforces them and raises FigureSpecError.)
        for ext_name, ext in self.external_points.items():
            if ext_name in names:
                raise ValueError(
                    f"external point {ext_name!r} collides with a circumference point name",
                )
            for line in (ext.line1, ext.line2):
                refs = [line.tangent_at] if line.tangent_at else (line.secant_through or [])
                for p in refs:
                    if p not in names:
                        raise ValueError(
                            f"external point {ext_name!r} references unknown circle point {p!r}",
                        )

        return self


class PolygonFigure(BaseModel):
    """A polygon — regular (square, pentagon, hexagon, n-gon) or
    irregular (explicit vertex positions).

    Two modes, distinguished by which fields are set:
    - **Regular mode**: set `n_sides` (and optionally `side_length`).
      Vertices auto-place evenly on a circle. Default vertex naming
      is A, B, C, ... but you can override with `vertex_names`.
    - **Irregular mode**: set `vertex_positions` as a list of
      [x, y] pairs. Names default to A, B, C, ... matching the
      order of vertex_positions; override with `vertex_names`.

    Triangles already have their own shape (TriangleFigure) with full
    SSS/SAS/ASA solving — DON'T use PolygonFigure for triangles
    (n_sides=3 is rejected at validation time to prevent that path).
    """

    type: Literal["geometry"] = "geometry"
    shape: Literal["polygon"] = "polygon"

    # Regular-mode fields.
    n_sides: int | None = None
    side_length: float = 1.0

    # Irregular-mode fields.
    vertex_positions: list[tuple[float, float]] | None = None

    # Display: applies to both modes.
    vertex_names: list[str] | None = None
    side_labels: dict[EdgeKey, str] = Field(default_factory=dict)
    # Per-vertex angle label (text shown inside the corner) — keyed
    # by the vertex's name (A, B, C, ... or whatever vertex_names says).
    angle_labels: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate(self) -> PolygonFigure:
        regular = self.n_sides is not None
        irregular = self.vertex_positions is not None
        if regular == irregular:
            raise ValueError(
                "polygon must set EITHER n_sides (regular) OR "
                "vertex_positions (irregular), not both or neither",
            )

        if regular:
            assert self.n_sides is not None  # for type checkers
            if self.n_sides < 4:
                raise ValueError(
                    "polygon n_sides must be >= 4; use shape='triangle' "
                    "for 3-vertex shapes (the triangle path has the "
                    "constraint solver — polygon mode is for shapes "
                    "the LLM specifies by side count or position list)",
                )
            if self.n_sides > 20:
                raise ValueError(
                    "polygon n_sides capped at 20 — beyond that the "
                    "renderer is making circles, not polygons",
                )
            if self.side_length <= 0:
                raise ValueError(f"side_length must be positive (got {self.side_length})")
            count = self.n_sides
        else:
            assert self.vertex_positions is not None
            count = len(self.vertex_positions)
            if count < 4:
                raise ValueError(
                    "irregular polygon needs at least 4 vertices",
                )

        if self.vertex_names is not None:
            if len(self.vertex_names) != count:
                raise ValueError(
                    f"vertex_names length {len(self.vertex_names)} != "
                    f"vertex count {count}",
                )
            if len(set(self.vertex_names)) != len(self.vertex_names):
                raise ValueError("vertex_names must be distinct")
            # Single-char enforcement: side_labels uses two-character
            # edge keys ("AB"); supporting multi-char names ("P1")
            # would require restructuring side_labels into a list of
            # (vertex_a, vertex_b, label) tuples. v1 stays string-keyed
            # for LLM simplicity, so vertex_names must be one char each.
            for name in self.vertex_names:
                if len(name) != 1:
                    raise ValueError(
                        f"vertex_names entries must be single characters (got {name!r}); "
                        "multi-char names break the two-character edge-key format "
                        "used by side_labels",
                    )

        # Default vertex names: A, B, C, ... — must align with edge
        # keys and angle_labels referencing them.
        names = self.vertex_names or [chr(ord("A") + i) for i in range(count)]
        name_set = set(names)
        for v in self.angle_labels:
            if v not in name_set:
                raise ValueError(f"angle_labels references unknown vertex: {v}")

        # side_labels: single-char vertex keys, canonicalize order
        # (AB ≡ BA), require adjacency (the edge must connect two
        # CONSECUTIVE vertices in drawing order — labeling a diagonal
        # would render in the wrong place because the renderer
        # midpoint-positions labels assuming a side, not a diagonal).
        adjacent_pairs: set[str] = set()
        for i, v in enumerate(names):
            nxt = names[(i + 1) % count]
            adjacent_pairs.add(v + nxt if v < nxt else nxt + v)

        def _canon(edge: str) -> str:
            return edge if edge[0] < edge[1] else edge[1] + edge[0]

        seen_edges: dict[str, str] = {}
        for edge in self.side_labels:
            if len(edge) != 2 or not all(c in name_set for c in edge):
                raise ValueError(
                    f"side_labels edge key {edge!r} must reference two vertex names",
                )
            canon = _canon(edge)
            if canon not in adjacent_pairs:
                raise ValueError(
                    f"side_labels edge {edge!r} is not a polygon side — "
                    "it connects two non-adjacent vertices (a diagonal). "
                    "Side labels can only annotate the polygon's edges.",
                )
            if canon in seen_edges and seen_edges[canon] != edge:
                raise ValueError(
                    f"side_labels has both {seen_edges[canon]!r} and {edge!r} — "
                    "these reference the same edge; emit one form only",
                )
            seen_edges[canon] = edge

        return self


# Discriminated union over the supported shapes. Pydantic uses the
# `shape` field to dispatch validation; the JSON schema generated by
# Pydantic includes a properly-typed oneOf branch per shape so the
# LLM tool-use validator picks up shape-specific required fields.
FigureSpec = Annotated[
    TriangleFigure | CircleFigure | PolygonFigure,
    Field(discriminator="shape"),
]
