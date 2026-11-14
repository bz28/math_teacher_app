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
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from api.core.geometry.dsl import ConstructionFigure, is_hidden, split_points
from api.core.geometry.facts import FACTS_TOOL, FigureFacts, as_facts, unnamed_requests
from api.core.geometry.figure_check import givens_marked, parse_problem
from api.core.llm_client import MODEL_REASON, call_claude_json
from api.core.llm_schemas import FIGURE_REDRAW_SCHEMA

logger = logging.getLogger(__name__)


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
   names, both sides of every angle it names, a ray as a `rays` entry
   starting at its endpoint ("AB" is the ray from A through B), a line
   through two points (line AB) as a `lines` entry through them, named lines
   (p, q, t, ell_1) as named `lines`, a transversal when there is one, and
   anything the teacher asks for. Draw nothing else.
4. Mark the givens as a textbook does: `tick_groups` on congruent segments
   (each congruent pair its own group), `arc_groups` on congruent angles,
   `right_angles` where lines are perpendicular, `parallel_groups` on
   parallel segments or lines. Each group lists at least two parts. NEVER
   mark the statement to prove — the student has to prove it.
5. Labels come only from the problem: numbered angles (∠1 →
   `angle_labels` {"AEB": "1"}), and measures or lengths the problem states.
   Never print an answer or any value the student has to find (nothing on
   the angle or segment the problem asks for); a variable the problem uses
   (x) may be shown. Every number on the figure must also
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
    facts: Any = None,
) -> dict[str, Any] | None:
    """The one retry: the same model and mode as the call that drew the
    figure, shown the checker's exact errors (and the facts it checks). Returns the new spec, or None
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
    reading = as_facts(facts)
    if reading is not None:
        parts.append(
            "The facts the figure is checked against:\n"
            + json.dumps(reading.model_dump(exclude_none=True, exclude={"dropped"}), sort_keys=True),
        )
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


# ── Reading the problem: two independent AI readings, checked by code ──

_FACTS_VOCAB = """Fact kinds (items as the problem names them; angles "ABC" with the vertex in the
middle, or "B", or "1"; segments, rays and two-point lines "AB"; named lines "m";
triangles "ABC"; polygons "ABCD" in order):
- parallel [l1, l2]; perpendicular [l1, l2] (point: where they meet, if stated)
- congruent_segments [s1, s2, ...]; congruent_angles [a1, a2, ...]
- equal_length [s] with value (a number) or expr; angle_measure [a] with value (degrees) or expr ("2x + 5")
- midpoint [s] with point; on_segment [s] with point; on_line [l] with point; collinear [P, Q, R, ...]
- intersect [l1, l2] with point; bisects_segment [bisector, s] (point if stated); bisects_angle [ray, angle]
- right_angle [a]; opposite_rays [r1, r2] (same endpoint first)
- vertical_angles / linear_pair / supplementary / complementary [a1, a2]
- congruent_triangles / similar_triangles [t1, t2] with vertices in the stated correspondence
- isosceles [t] (point: the apex, if the base, legs or vertex angle are stated); equilateral [t];
  right_triangle [t] (point: the right-angle vertex, if stated)
- parallelogram / rectangle / square / rhombus / trapezoid / isosceles_trapezoid / kite [polygon]
  (items [] when the shape has no name: "the rectangle below")
- on_circle [P, Q, ...] with circle (its center; "" if unnamed); tangent [l] with circle and point;
  chord / diameter / radius [s] with circle; central_angle / inscribed_angle [a] with circle (value if stated)
- numbered_angle ["1", angle it labels] when the problem says which angle ∠1 is
- transversal [t, l1, l2] (t "" when unnamed)
- alternate_interior / alternate_exterior / corresponding / same_side_interior [a1, a2]: two angles
  the problem says a transversal makes in that position (items [] when it doesn't name them)
- other: anything else stated about the figure (say it in quote)
Naming a figure ("In △ABC", "quadrilateral ABCD") is not a fact: list it under triangles or polygons.
Use only the names the problem itself uses; never invent one. When it names no points ("a
rectangle has a width of 7"), points is [] and facts have items []: rectangle [], right_triangle [],
equal_length [] with value for each length it gives (say which side in quote).
Points are letters ("A", "B'"); "∠1" is an angle, not a point.
Each fact's quote is the exact words of the problem it comes from."""

_FACTS_SYSTEM_A = f"""You read geometry problems for a figure checker. List what the problem STATES
about its figure — nothing you infer, derive or solve, and nothing from the solution.

{_FACTS_VOCAB}

Sections: points (every point named); segments, rays, lines, named_lines, triangles, polygons,
circles (every part the problem names); givens (what the problem gives); prove (each statement
the student must prove, show, explain or justify); find (each angle or segment the problem asks
for; kind "other" for anything else, such as "determine whether …"); requested (parts the
teacher's message asks to draw, by name)."""

_FACTS_SYSTEM_B = f"""You are auditing a geometry problem before a diagram is drawn for it. Go through
the problem one sentence at a time. For each sentence, record every relation it states as a fact
(stated facts only: no theorems applied, no values solved for, nothing from the answer).
Put a fact under prove when the sentence asks the student to prove / show / explain / justify /
verify it, and under givens otherwise. Then list: every point name; the segments, rays, lines,
named lines, triangles, polygons and circles the problem names; the angles and segments it asks
you to find (find; a question such as "determine whether …" is find kind "other", never a
fact); and the parts the teacher's message asks to have drawn, by name (requested).

{_FACTS_VOCAB}"""


async def _read_once(system: str, message: str, *, mode: str, user_id: str | None,
                     generation_job_id: str | None) -> Any:

    result = await call_claude_json(
        system, message, mode=mode, tool_schema=FACTS_TOOL, user_id=user_id, model=MODEL_REASON,
        max_tokens=4096, temperature=0.0, generation_job_id=generation_job_id,
    )
    # `dropped` is code's own log of what it set aside, never the reading's.
    return FigureFacts.model_validate(result).model_copy(update={"dropped": []})


async def read_figure_facts(
    problem_text: str,
    *,
    final_answer: str = "",
    request: str = "",
    mode: str,
    user_id: str | None,
    generation_job_id: str | None = None,
) -> tuple[Any, list[str]]:
    """(the agreed facts, []) or (None, [why the reading can't be trusted]).

    Two independent readings (different prompts, same model); code then
    requires that they agree, that they account for every point and every
    relation word in the text, and that each fact has a check."""
    import asyncio

    from api.core.geometry.facts import (
        coverage_gaps,
        described_in_words,
        disagreements,
        first_difference,
        grounded,
        impossible_measures,
        invented_points,
        merged,
        unverifiable,
    )

    message = f"Problem:\n{problem_text}"
    if final_answer:
        message += (
            "\n\nFinal answer (shown only so you know what is asked; take no points, parts or facts "
            f"from it):\n{final_answer}"
        )
    message += f"\n\nThe teacher's message:\n{request or '(none)'}"
    try:
        a, b = await asyncio.gather(
            _read_once(_FACTS_SYSTEM_A, message, mode=f"{mode}_facts_a", user_id=user_id,
                       generation_job_id=generation_job_id),
            _read_once(_FACTS_SYSTEM_B, message, mode=f"{mode}_facts_b", user_id=user_id,
                       generation_job_id=generation_job_id),
        )
    except Exception:
        logger.exception("figure facts reading failed")
        return None, ["the problem couldn't be read for checking"]
    a, b = grounded(a, f"{problem_text}\n{request}"), grounded(b, f"{problem_text}\n{request}")
    made_up = invented_points(a, f"{problem_text}\n{request}") + invented_points(b, f"{problem_text}\n{request}")
    if made_up:
        # Names the problem never writes: a reading labelled an unnamed figure.
        logger.warning("figure facts: a reading named points the problem doesn't: %s", sorted(set(made_up)))
        return None, [_IN_WORDS]
    if described_in_words(a) and described_in_words(b):
        return None, [_IN_WORDS]
    differ = disagreements(a, b)
    if differ:
        logger.warning("figure facts: the two readings differ: %s", differ)
        what = first_difference(a, b)
        about = f" about {what if what.startswith('which') else 'whether ' + what}" if what else ""
        return None, [f"two readings of the problem disagree{about}, so the figure can't be checked"]
    gaps = coverage_gaps(problem_text, a)
    if gaps:
        return None, [f"the reading of the problem missed {g}, so the figure can't be checked" for g in gaps[:3]]
    agreed = merged(a, b)
    if described_in_words(agreed):
        return None, [_IN_WORDS]
    cant = unverifiable(agreed)
    if cant:
        return None, [f"the checker can't verify “{c}” yet, so it can't confirm the figure" for c in cant[:3]]
    impossible = impossible_measures(agreed)
    if impossible:
        return None, impossible[:2]
    return agreed, []


_IN_WORDS = (
    "the problem describes its angles or shapes in words rather than naming them, so the figure can't be checked"
)


# ── What the teacher is told ───────────────────────────────────────────


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def figure_sentence(
    spec: dict[str, Any], request: str, *, updated: bool, problem_text: str = "", facts: Any = None,
) -> str:
    """One sentence about a figure that passed its check, written from what
    was drawn: its visible points, the parts the teacher asked about, and —
    only when every given with a textbook mark is marked — that the givens
    are marked."""
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
    reading = as_facts(facts)
    # "The givens are marked" is said only from the agreed reading.
    tail = "; the givens are marked." if reading is not None and givens_marked(fig, problem_text, reading) else "."
    # A part asked for by description can't be checked, so it isn't drawn:
    # the teacher is told, never left to think it was.
    unnamed = unnamed_requests(reading) if reading is not None else []
    if unnamed:
        tail += (
            f" I couldn't add {_join([f'“{u}”' for u in unnamed])}: a part can be checked only when it is named "
            "by its points, so please name it (for example, “altitude AD with D on BC”) and ask again."
        )
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
    r"\b(?:diagram|figure|drawing|drew|draw|drawn|sketch(?:ed)?|picture|illustration|image|visual"
    r"|labell?(?:ed|ing)?|labels?|ticks?|marks?|marked|marking|arrows?|box(?:es)?|shad(?:e|ed|es|ing)"
    r"|segments?|rays?|lines?|sides?|diagonals?|vertex|vertices|points?|angles?|triangles?|polygons?"
    r"|quadrilaterals?|squares?|rectangles?|circles?|arcs?|sectors?|radius|radii|diameters?|chords?|tangents?"
    r"|altitudes?|medians?|perpendiculars?|heights?|bisectors?|base|hypotenuse|legs?|transversals?"
    r"|parallel|midpoints?|foot|feet"
    r"|connect(?:s|ed|ing)?|join(?:s|ed|ing)?|includ(?:e|es|ed|ing)|show(?:s|n|ed|ing)?|add(?:s|ed|ing)?"
    r"|put(?:s|ting)?|plac(?:e|es|ed|ing)|drop(?:s|ped|ping)?|insert(?:s|ed|ing)?|construct(?:s|ed|ing)?"
    r"|extend(?:s|ed)?|split(?:s|ting)?|divid(?:e|es|ed|ing)|appears?)\b"
    r"|[∠△⊥∥≅]|\\(?:angle|triangle|overline|overrightarrow|overleftrightarrow|perp|parallel|cong)\b",
    re.IGNORECASE,
)
# What the model's own reply may still say beside code's figure sentence:
# only what it changed in the problem's words, answer or steps.
_ABOUT_TEXT = re.compile(
    r"\b(?:questions?|problems?|word(?:s|ed|ing)?|rework(?:ed)?|reword(?:ed)?|rewr(?:ote|itten|ite)|phras\w*"
    r"|text|answers?|solutions?|steps?|hints?|difficult\w*|easier|harder|typos?|spelling|grammar|choices?"
    r"|distractors?|units?|title|instructions?)\b",
    re.IGNORECASE,
)
# A point or part named by capitals: "B", "BD", "A'B'" (not "I", not the
# article "A").
_NAMED_PART = re.compile(r"(?<![A-Za-z])(?!I\b)(?!A\s+[a-z])[A-Z][0-9]*'*(?:[A-Z][0-9]*'*)*(?![a-z])")


def without_figure_talk(reply: str) -> str:
    """The model's reply with nothing about a figure — code writes that
    sentence from what was drawn. The model wrote its reply before anything
    was drawn, so whatever it says about the picture is intent, not the
    result. A sentence stays only when it is about the problem's words,
    answer or steps (an allowlist) and names no figure part, no point, and
    no drawing verb ("I've dropped the perpendicular", "I put in the
    altitude" go)."""
    sentences = re.split(r"(?<=[.!?])\s+", reply.strip())
    return " ".join(
        s for s in sentences
        if s and _ABOUT_TEXT.search(s) and not _FIGURE_TALK.search(s) and not _NAMED_PART.search(s)
    ).strip()
