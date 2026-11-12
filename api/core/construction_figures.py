"""Construction figures: the prompt rules, the one retry, and the
teacher-facing sentence about a figure.

The flow (see the design doc linked in the PR): the AI describes a figure as
named points at coordinates plus what to draw and mark; code draws it
(geometry/construction_render.py) and checks it against the problem
(geometry/figure_check.py). A figure that fails gets ONE retry with the
checker's exact errors; a second failure saves no figure and records why.
In the workshop chat the sentence about the figure is written here, from
what was actually drawn — the model's reply is written before anything is
drawn, so it can't be trusted to describe the result.

All of it sits behind `settings.geometry_construction_figures`; off restores
the triangle / circle / polygon prompts and schemas.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from api.config import settings
from api.core.geometry.dsl import ConstructionFigure, is_hidden, split_points
from api.core.geometry.figure_check import parse_problem
from api.core.llm_client import MODEL_REASON, call_claude_json
from api.core.llm_schemas import FIGURE_REDRAW_SCHEMA

logger = logging.getLogger(__name__)


def construction_on() -> bool:
    return settings.geometry_construction_figures


CONSTRUCTION_FIGURE_RULES = """\
A figure (`figure_spec`) is a construction: you place named points at exact
coordinates and list what to draw and mark. Code draws it and CHECKS it
against the problem before anyone sees it; a figure that fails the check is
not shown. Use `"type": "geometry", "shape": "construction"`.

Rules:
1. Include every point the problem names, with exactly those names (A, B,
   A', M). A point needed only to place a line or an angle gets a hidden
   name: "_" then lowercase letters or digits only ("_p1", "_q"; never
   "_P" or "_mR"); it is never drawn or labelled.
2. Choose coordinates so EVERY given is exactly true: parallel lines have the
   same slope, perpendicular lines meet at 90°, a midpoint is exactly
   halfway, a point "on" a segment lies on it, congruent segments have equal
   lengths, congruent angles are equal, a bisector splits its angle exactly,
   an angle stated as 50° measures 50°, lengths are in the stated
   proportions. The statement to prove must be true in the drawing too.
   Use a typical textbook layout about 6-10 units wide; x to the right,
   y up. COMPUTE coordinates, never estimate them:
   - an angle of k° at V: one arm along a direction you choose, the other
     point at V + r·(cos(θ+k°), sin(θ+k°));
   - a right angle at A opposite BC: put A on the circle with diameter BC;
   - a point on segment AB: A + t·(B − A); a midpoint: the average;
   - a bisector of ∠AVB: the ray at the average of the two arm directions;
   - congruent or similar triangles: copy the first triangle's coordinates,
     scaled by the ratio and moved (shift, and rotate if needed), so every
     angle matches;
   - stated lengths: place them at those lengths, or all scaled by one factor.
   Give coordinates to 3 decimals.
3. Draw every segment the problem names, every side of every triangle it
   names, both sides of every angle it names, rays as `rays`, named lines
   (p, q, t, ell_1) as named `lines`, a transversal when there is one, and
   anything the teacher asks for. Draw nothing else.
4. Mark the givens as a textbook does: `tick_groups` on congruent segments
   (each congruent pair its own group), `arc_groups` on congruent angles,
   `right_angles` where lines are perpendicular, `parallel_groups` on
   parallel segments or lines. NEVER mark the statement to prove — the
   student has to prove it.
5. Labels come only from the problem: numbered angles (∠1 →
   `angle_labels` {"AEB": "1"}), and measures or lengths the problem states.
   Never print an answer or any value the student has to find; a variable
   the problem uses (x) may be shown. Every number on the figure must also
   be in the problem text.
6. It cannot draw 3D solids, curves other than circles (graphs of
   functions, parabolas), coordinate grids, or pictures of real objects.
   For those, don't emit a figure and say plainly that the diagram tool
   can't draw it.

Example — "Given: $\\overline{PR}$ bisects $\\angle QPS$ and
$\\overline{PQ} \\cong \\overline{PS}$. Prove: $\\triangle PQR \\cong \\triangle PSR$":
{"type": "geometry", "shape": "construction",
 "points": {"P": [0, 0], "Q": [4, 3], "R": [8, 0], "S": [4, -3]},
 "segments": ["PQ", "QR", "RS", "SP", "PR"],
 "tick_groups": [["PQ", "PS"]],
 "arc_groups": [["QPR", "RPS"]]}"""


_REDRAW_THINKING = 6000

_REDRAW_SYSTEM = (
    "You draw exact geometry figures for a math teacher's problem. You don't "
    "draw pixels: you place named points at coordinates and list what to draw. "
    "Code renders the figure and checks it against the problem.\n\n"
    + CONSTRUCTION_FIGURE_RULES
)


async def redraw_figure(
    problem_text: str,
    previous_spec: dict[str, Any],
    issues: list[str],
    *,
    mode: str,
    user_id: str | None,
    request: str = "",
    step_text: str | None = None,
    base_spec: dict[str, Any] | None = None,
    generation_job_id: str | None = None,
) -> dict[str, Any] | None:
    """The one retry: the same model and mode as the call that drew the
    figure, shown the checker's exact errors. Returns the new spec, or None
    when the call fails or returns none (the caller then drops the figure)."""
    parts = [f"Problem:\n{problem_text}"]
    if request:
        parts.append(f"The teacher asked: {request}")
    if step_text is not None:
        parts.append(
            "This figure goes with ONE solution step. It must keep every point of the "
            "question's figure where it is and keep everything that figure draws; it "
            f"may add what this step introduces.\nStep: {step_text}",
        )
        if base_spec is not None:
            parts.append(f"The question's figure:\n{json.dumps(base_spec, sort_keys=True)}")
    parts.append(f"Your previous figure:\n{json.dumps(previous_spec, sort_keys=True)}")
    parts.append("The checker found these problems:\n- " + "\n- ".join(issues))
    parts.append(
        "Return a corrected figure that fixes every problem listed. Work out each "
        "coordinate from the givens (trigonometry, midpoints, scaling) and check every "
        "given against your numbers before you answer.",
    )
    try:
        result = await call_claude_json(
            _REDRAW_SYSTEM,
            "\n\n".join(parts),
            mode=mode,
            tool_schema=FIGURE_REDRAW_SCHEMA,
            user_id=user_id,
            model=MODEL_REASON,
            # The retry gets room to work the coordinates out (the eval's
            # failures were estimated coordinates: C at (9, 5) where the
            # givens need 5.196); the first draw is part of a bigger reply.
            thinking_budget=_REDRAW_THINKING,
            max_tokens=_REDRAW_THINKING + 4096,
            generation_job_id=generation_job_id,
        )
    except Exception:
        logger.exception("figure redraw call failed")
        return None
    spec = result.get("figure_spec")
    return spec if isinstance(spec, dict) else None


# ── What the teacher is told ───────────────────────────────────────────


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def figure_sentence(spec: dict[str, Any], request: str, *, updated: bool) -> str:
    """One sentence about a figure that passed its check, written from what
    was drawn: its visible points, the parts the teacher asked about, and
    whether the givens are marked."""
    fig = ConstructionFigure.model_validate(spec)
    names = [n for n in fig.points if not is_hidden(n)]
    asked = parse_problem("", extra=request)
    drawn_pairs = {frozenset(_pair(s)) for s in fig.segments} | {frozenset(_pair(r)) for r in fig.rays}
    asked_segments = sorted("".join(sorted(s)) for s in asked.segments if s in drawn_pairs)
    if not asked_segments:
        # Otherwise name the segments drawn through the inside of the shape
        # (a diagonal such as AC) — the ones a teacher looks for first.
        asked_segments = _interior_segments(fig)
    labels = {re.sub(r"[^\w]", "", v) for v in fig.angle_labels.values()}
    asked_angles = sorted(f"∠{n}" for n in asked.numbered if n in labels)

    lead = "I've updated the diagram" if updated else "I've added a diagram"
    pts = f" with points {_join(names)}" if 0 < len(names) <= 10 else ""
    extras = []
    if asked_segments:
        extras.append(f"{_join(asked_segments)} drawn")
    if asked_angles:
        extras.append(f"{_join(asked_angles)} labelled")
    detail = f", with {' and '.join(extras)}" if extras else ""
    marked = fig.tick_groups or fig.arc_groups or fig.right_angles or fig.parallel_groups
    tail = "; the givens are marked." if marked else "."
    return f"{lead}{pts}{detail}{tail}"


def _pair(ref: str) -> tuple[str, ...]:
    return split_points(ref, 2)


def _interior_segments(fig: ConstructionFigure) -> list[str]:
    """Drawn segments between two visible points that are not on the outline
    (convex hull) of the visible points — diagonals and cevians. At most 3."""
    pts = {n: p for n, p in fig.points.items() if not is_hidden(n)}
    hull = _hull_edges(pts)
    out = []
    for seg in fig.segments:
        a, b = _pair(seg)
        if a in pts and b in pts and frozenset((a, b)) not in hull:
            out.append(seg)
    return out if 0 < len(out) <= 3 else []


def _hull_edges(pts: dict[str, tuple[float, float]]) -> set[frozenset[str]]:
    """Edges of the convex hull, as point-name pairs; collinear points on an
    edge are kept, so every piece of the outline counts as an edge."""
    names = sorted(pts, key=lambda n: pts[n])
    if len(names) < 3:
        return set()

    def cross(o: str, a: str, b: str) -> float:
        (ox, oy), (ax, ay), (bx, by) = pts[o], pts[a], pts[b]
        return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)

    def chain(seq: list[str]) -> list[str]:
        out: list[str] = []
        for n in seq:
            while len(out) >= 2 and cross(out[-2], out[-1], n) < -1e-9:
                out.pop()
            out.append(n)
        return out

    ring = chain(names)[:-1] + chain(names[::-1])[:-1]
    return {frozenset((ring[i], ring[(i + 1) % len(ring)])) for i in range(len(ring))}


def failure_sentence(issues: list[str], *, step: int | None = None) -> str:
    """Why a figure was not drawn, in plain words from the checker."""
    what = f"the diagram for step {step}" if step else "a correct diagram"
    reasons = "; ".join(issues[:4]) + ("; and more" if len(issues) > 4 else "")
    return f"I couldn't draw {what}: {reasons}."


_FIGURE_TALK = re.compile(
    r"\b(?:diagram|figure|drawing|drew|draw|drawn|sketch|picture|illustration"
    r"|labell?ed|labels?|tick|marks?|marked|segments?)\b",
    re.IGNORECASE,
)


def without_figure_talk(reply: str) -> str:
    """The model's reply minus any sentence about a figure — code writes
    that sentence from what was drawn."""
    sentences = re.split(r"(?<=[.!?])\s+", reply.strip())
    return " ".join(s for s in sentences if s and not _FIGURE_TALK.search(s)).strip()
