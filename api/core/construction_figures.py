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
from api.core.geometry.facts import FACTS_TOOL, FigureFacts, as_facts, as_prompt, unnamed_requests
from api.core.geometry.figure_check import givens_marked, parse_problem
from api.core.llm_client import MODEL_REASON, call_claude_json
from api.core.llm_schemas import FIGURE_REDRAW_SCHEMA
from api.core.prompts import load_prompt

logger = logging.getLogger(__name__)


CONSTRUCTION_FIGURE_RULES = load_prompt("construction_figure_rules")


_REDRAW_THINKING = 6000

_REDRAW_SYSTEM = load_prompt("figure_redraw_intro") + CONSTRUCTION_FIGURE_RULES


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
            + json.dumps(as_prompt(reading.model_dump(exclude_none=True, exclude={"dropped"})), sort_keys=True),
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


async def draw_figure(
    problem_text: str,
    card: FigureFacts,
    *,
    mode: str,
    user_id: str | None,
    generation_job_id: str | None = None,
) -> dict[str, Any] | None:
    """One fresh figure for a problem the AI wrote, from its fact card alone
    (no earlier figure to anchor on): the same model and room to work as the
    redraw. None when the call fails or returns none."""
    message = "\n\n".join((
        f"Problem:\n{problem_text}",
        "The facts the figure is checked against (its fact card):\n"
        + json.dumps(as_prompt(card.model_dump(exclude_none=True, exclude={"dropped"})), sort_keys=True),
        "Draw the figure for this problem: every point and part on the card, every given exactly true, "
        "nothing under constructs. Work out each coordinate from the givens (trigonometry, midpoints, "
        "scaling) and check every given against your numbers before you answer.",
    ))
    try:
        result = await call_claude_json(
            _REDRAW_SYSTEM, message, mode=mode, tool_schema=FIGURE_REDRAW_SCHEMA, user_id=user_id,
            model=MODEL_REASON, thinking_budget=_REDRAW_THINKING, max_tokens=_REDRAW_THINKING + 4096,
            generation_job_id=generation_job_id,
        )
    except Exception:
        logger.exception("fresh figure call failed")
        return None
    spec = result.get("figure_spec")
    return spec if isinstance(spec, dict) else None


# ── Reading the problem: two independent AI readings, checked by code ──

_FACTS_VOCAB = load_prompt("figure_facts_vocab")

_FACTS_SYSTEM_A = load_prompt("figure_facts_system_a").format(facts_vocab=_FACTS_VOCAB)

_FACTS_SYSTEM_B = load_prompt("figure_facts_system_b").format(facts_vocab=_FACTS_VOCAB)


async def _read_once(system: str, message: str, *, mode: str, user_id: str | None,
                     generation_job_id: str | None) -> Any:

    result = await call_claude_json(
        system, message, mode=mode, tool_schema=FACTS_TOOL, user_id=user_id, model=MODEL_REASON,
        max_tokens=4096, temperature=0.0, generation_job_id=generation_job_id,
    )
    # `dropped` is code's own log of what it set aside, never the reading's.
    return FigureFacts.model_validate(result).model_copy(update={"dropped": [], "source": "reading", "constructs": []})


async def read_figure_facts(
    problem_text: str,
    *,
    final_answer: str = "",
    request: str = "",
    mode: str,
    user_id: str | None,
    generation_job_id: str | None = None,
    step_of: str | None = None,
) -> tuple[Any, list[str]]:
    """(the agreed facts, []) or (None, [why the reading can't be trusted]).

    Two independent readings (different prompts, same model); code then
    requires that they agree, that they account for every point and every
    relation word in the text, and that each fact has a check.

    With `step_of` (the question), `problem_text` is one step of its
    solution, read by the same rule: what the step states about the figure,
    quoted from the step. The question lends only its point names."""
    import asyncio


    message = f"Problem:\n{problem_text}"
    if step_of is not None:
        message += (
            "\n\nThis text is one step of the solution to the problem below. Read the step as the "
            "problem: list what the step states about the figure, quoting the step's own words. The "
            f"problem is shown only for its point names; take no facts from it.\nThe problem:\n{step_of}"
        )
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
    return trusted_reading(problem_text, a, b, request=request, step_of=step_of)


def trusted_reading(problem_text: str, a: FigureFacts, b: FigureFacts, *, request: str = "",
                    step_of: str | None = None) -> tuple[FigureFacts | None, list[str]]:
    """Plain code on the two readings: standard form, agreement, coverage
    (with the facts code derives from the words), verifiers. The agreed
    facts the drawing is checked against, or why there are none."""
    from api.core.geometry.coverage import coverage
    from api.core.geometry.facts import (
        derived_conflicts,
        described_in_words,
        disagreements,
        first_difference,
        grounded,
        impossible_measures,
        invented_points,
        merged,
        standard_reading,
        unverifiable,
        with_derived,
        without_other,
    )

    a, b = grounded(a, f"{problem_text}\n{request}"), grounded(b, f"{problem_text}\n{request}")
    a, b = standard_reading(a), standard_reading(b)
    names = f"{problem_text}\n{request}\n{step_of or ''}"
    made_up = invented_points(a, names) + invented_points(b, names)
    if made_up:
        # Names the problem never writes: a reading labelled an unnamed figure.
        logger.warning("figure facts: a reading named points the problem doesn't: %s", sorted(set(made_up)))
        return None, [_IN_WORDS]
    if described_in_words(a) and described_in_words(b):
        return None, [_IN_WORDS]
    # (After "described in words", which reads the "other" facts' items.)
    a, b = without_other(a), without_other(b)
    # The facts code derives from the problem's own words ("each base
    # angle", "intersects PR at S", "altitude CD") are checked on the
    # drawing whatever the readings say, so each reading is compared with
    # them added: one that left out a foot the words state agrees with one
    # that wrote it.
    # Coverage runs on both readings; the derived facts come from the
    # text's own words and parts, so both must derive the same ones. They
    # are worked out once, then added to both readings (and so to the
    # checked facts).
    gaps, derived = coverage(problem_text, a, step_of or "")
    gaps_b, derived_b = coverage(problem_text, b, step_of or "")
    gaps = list(dict.fromkeys([*gaps, *gaps_b]))

    def said(ds: list[Any]) -> set[tuple[Any, ...]]:
        return {(d.kind, tuple(d.items), d.point, d.value, d.expr, d.circle) for d in ds}

    if said(derived) != said(derived_b):
        logger.warning("figure facts: the readings derive different facts from the words: %s",
                       sorted(map(str, said(derived) ^ said(derived_b))))
        return None, ["two readings of the problem disagree about what its words state, so the figure can't be "
                      "checked"]
    clash = derived_conflicts(a, derived) or derived_conflicts(b, derived)
    a, b = with_derived(a, derived), with_derived(b, derived)
    differ = disagreements(a, b)
    if differ:
        logger.warning("figure facts: the two readings differ: %s", differ)
        what = first_difference(a, b)
        about = f" about {what if what.startswith('which') else 'whether ' + what}" if what else ""
        return None, [f"two readings of the problem disagree{about}, so the figure can't be checked"]
    if gaps:
        return None, [f"the reading of the problem missed {g}, so the figure can't be checked" for g in gaps[:3]]
    if clash:  # a reading measures a part the words measure otherwise
        logger.warning("figure facts: a reading contradicts the problem's words: %s", clash)
        return None, [f"the reading of the problem contradicts its words about {clash[0]}, so the figure can't be "
                      "checked"]
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
    "this problem describes the figure in words without naming its points; add point names "
    "(e.g. 'lines AB and CD meet at E') and I can draw it"
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

