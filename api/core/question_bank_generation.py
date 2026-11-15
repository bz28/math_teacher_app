"""Question bank generation orchestrator.

Wraps the existing assignment_generation pipeline (which already does
question generation + parallel solution decomposition via Claude Vision)
and persists results into question_bank_items + tracks progress on
question_bank_generation_jobs.

Runs as a fire-and-forget asyncio task scheduled by the routes layer.
The task uses its own DB session — the request session is closed by
the time the task is awaited.
"""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.assignment_generation import (
    FACT_CARD_RULES,
    WHEN_TO_DRAW,
    generate_questions,
    generate_solutions,
)
from api.core.construction_figures import CONSTRUCTION_FIGURE_RULES, draw_figure, read_figure_facts, redraw_figure
from api.core.document_vision import (
    MAX_TOTAL_SOURCE_B64_BYTES,
    MAX_VISION_IMAGES,
    build_attachment_metadata,
    build_vision_content,
    fetch_source_documents,
)
from api.core.drawing_requirement import combine_requires_drawing
from api.core.geometry import FigureSpecError, figure_point_names, render_figure, render_figure_or_none
from api.core.geometry.dsl import ConstructionFigure, split_points
from api.core.geometry.fact_card import (
    as_drawn,
    card_text,
    clean_context,
    clean_hint,
    constructed_drawn,
    is_blank_card,
    pair_lines_unsaid,
    read_card,
    student_constructs,
    unlisted_points,
)
from api.core.geometry.facts import FigureFacts, as_facts
from api.core.geometry.figure_check import check_construction, unbacked_marks, with_arc_sides
from api.core.image_utils import to_content_block
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import (
    GENERATE_QUESTIONS_SCHEMA,
    REGENERATE_QA_CONSTRUCTION_SCHEMA,
)
from api.core.part_labels import PRACTICE_SINGLE_ANSWER_RULE, is_multi_part
from api.core.practice import generate_distractors
from api.core.subjects import get_config
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import (
    FORMAT_FRQ,
    FORMAT_MCQ,
    QuestionBankGenerationJob,
    QuestionBankItem,
)
from api.models.unit import Unit

logger = logging.getLogger(__name__)


# Track in-flight tasks so they aren't garbage-collected mid-flight.
_inflight_jobs: set[asyncio.Task[None]] = set()

# Commit every N persisted questions during bulk generation so the
# frontend polling banner ticks visibly without N+1 transactions.
_PROGRESS_BATCH = 5

# The solver now and then writes a line break as the two characters
# backslash + n, which the student sees verbatim ("…51°)\n\n(b)…").
# Math is left alone: there the pair starts \neq, \nabla, \notin…
# Outside math, a run of two or more is always line breaks, and a single
# one is a line break unless a letter follows — then it may be a bare
# LaTeX command (\notin, \nRightarrow), so it is kept.
_MATH = re.compile(r"(\$\$.*?\$\$|(?<!\\)\$.*?(?<!\\)\$|\\\(.*?\\\)|\\\[.*?\\\])", re.DOTALL)
_LITERAL_NEWLINE = re.compile(r"(?<!\\)(?:(?:\\n){2,}|\\n(?![A-Za-z]))")


def real_newlines(text: str) -> str:
    """Turn literal backslash-n pairs outside math into line breaks."""
    if "\\n" not in text:
        return text
    return "".join(
        part if i % 2 else _LITERAL_NEWLINE.sub(lambda m: "\n" * (len(m.group()) // 2), part)
        for i, part in enumerate(_MATH.split(text))
    )


def _step_text(step: dict[str, Any]) -> str:
    return f"{step.get('title') or ''}: {step.get('description') or ''}"


def _step_statement(step: dict[str, Any]) -> str:
    """The words of a step that state something about the figure: its
    description, and its title too when the title names a point (a heading
    such as "Altitude" or "Find the angle" names none and states nothing)."""
    title = str(step.get("title") or "")
    if re.search(r"(?<![A-Za-z\\])[A-Z](?![a-z])", title):
        return _step_text(step)
    return str(step.get("description") or "")


_STEP_NOT_READ = "the step wasn't read for checking"


async def read_step_facts(
    steps: list[Any],
    *,
    question_text: str,
    facts: Any,
    mode: str,
    user_id: str | None,
    generation_job_id: str | None = None,
) -> dict[int, list[str]]:
    """Read each step that has a construction figure, by the question's own
    rule (two readings checked by code), and put on the step, as
    `figure_facts`, the facts its figure is checked against: the question's
    reading `facts` plus what this step and every earlier figured step
    state (a step's figure is the one before it plus what the step adds, so
    step 3 keeps step 2's altitude). A step whose reading can't be trusted
    gets none, so its figure fails closed; later steps build on the steps
    that were read. Returns, per 1-based step number, why it has none."""
    from api.core.geometry.facts import with_step

    question = as_facts(facts)
    drops: dict[int, list[str]] = {}
    work = [(i, s) for i, s in enumerate((s for s in steps if isinstance(s, dict)), start=1)]
    for _, s in work:
        s.pop("figure_facts", None)  # only code writes it, from the readings below
    todo = [(i, s) for i, s in work if _is_construction(s.get("figure_spec"))]
    if question is None:
        return {i: [_NOT_READ] for i, _ in todo}

    async def read(step: dict[str, Any]) -> tuple[FigureFacts | None, list[str]]:
        return await read_figure_facts(
            _step_statement(step), mode=mode, user_id=user_id, generation_job_id=generation_job_id,
            step_of=question_text,
        )

    readings = await asyncio.gather(*(read(s) for _, s in todo))
    so_far = question
    for (i, step), (reading, why) in zip(todo, readings):
        if reading is None:
            drops[i] = [w.replace("the problem", "the step") for w in why]
        else:
            so_far = with_step(so_far, reading)
            step["figure_facts"] = so_far.model_dump()
    return drops


def _render_step_figures(
    steps: list[Any],
    *,
    question_text: str = "",
    question_spec: Any = None,
) -> list[dict[str, Any]]:
    """Check and render each step's figure_spec into figure_svg (the
    generation, chat and accept paths), so downstream readers never need to
    know about the geometry module.

    A step figure is a construction: checked (`_check_figure` with the
    step's text, against `question_text` and the question's figure
    `question_spec`) and dropped when it fails. It is checked against the
    step's own `figure_facts` (`read_step_facts`); a step without them
    can't be checked, so its figure is dropped. A step figure in the shape
    forms (triangle, circle, polygon) is dropped too: nothing checks it
    against the problem (prod 77195d48: a wrong triangle for a step).
    """
    out: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        rendered: dict[str, Any] = dict(step)
        spec = step.get("figure_spec")
        svg = None
        if _is_construction(spec):
            _, svg, _ = _check_figure(
                spec, question_text, step_text=_step_text(step), base=question_spec,
                facts=step.get("figure_facts"),
            )
        if svg:
            rendered["figure_svg"] = svg
        else:
            # No spec, or it failed to render — drop both keys so a
            # downstream reader never sees a spec without its svg.
            rendered.pop("figure_spec", None)
            rendered.pop("figure_svg", None)
            rendered.pop("figure_facts", None)
        out.append(rendered)
    return out


# Points a problem names: \\overline{DE}, \\angle ADE, \\triangle A'B'C', ∠B,
# "point P", "points A and B", "$D$ lies on". Capital letters (with any
# primes) only — "line m" is a line.
_POINT = r"[A-Z]'*"
_NAMED_POINTS = re.compile(
    r"(?:\\overline|\\overleftrightarrow|\\overrightarrow|\\angle|\\triangle|∠|△)"
    rf"\s*\{{?\s*(?P<run>(?:{_POINT})+)(?![a-z])"
    rf"|\b[Pp]oints?\s+(?P<list>\$?{_POINT}\$?(?:\s*(?:,|and|,\s*and)\s*\$?{_POINT}\$?)*)\b"
    rf"|\$(?P<on>{_POINT})\$\s+(?:lies|is)\s+on\b",
)


def _canon_point(name: str) -> str:
    """One spelling per point name: `A′`, `A’` and `$A'$` are all `A'`."""
    return name.replace("′", "'").replace("’", "'").replace("$", "").strip()


def _named_points(text: str) -> set[str]:
    names: set[str] = set()
    for m in _NAMED_POINTS.finditer(_canon_point(text)):
        names.update(re.findall(_POINT, m["run"] or m["list"] or m["on"]))
    return names


_BASE_UNREADABLE = "the question's figure can't be read, so the step's figure can't be checked against it"


def _is_construction(spec: Any) -> bool:
    return isinstance(spec, dict) and spec.get("shape") == "construction"


def _check_figure(
    raw_spec: Any,
    text: str,
    *,
    final_answer: str = "",
    request: str = "",
    step_text: str | None = None,
    base: Any = None,
    facts: Any = None,
) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    """Validate, render and check a figure spec for the problem `text`.

    Returns (spec, svg, issues): spec and svg when the figure is kept,
    else (None, None, why). No spec at all is (None, None, []).

    Construction figures go through the checker (geometry/figure_check.py):
    the teacher's `request` names parts that must be drawn, `final_answer`
    catches an answer printed on the figure, and a step figure passes its
    `step_text` and the question's figure as `base`. The shape forms keep
    their own rule: drop a figure that leaves out a point the problem names
    — the model squeezing a figure the DSL can't draw into one it can (prod,
    2026-10-21: "DE ∥ BC, D on AB, E on AC" drawn as a bare triangle ABC).
    The spec is only returned alongside a successful svg so a persisted
    question never carries a spec without its rendering.

    A construction is checked against `facts`, the problem's agreed reading
    (`read_figure_facts`); without one it can't be checked, so it is dropped.
    """
    if not isinstance(raw_spec, dict):
        return None, None, []
    if not _is_construction(raw_spec) and facts is not None:
        # A problem written from a fact card is held to the card, which only
        # the construction form is checked against: a shape-form figure
        # ("triangle" with side labels) would skip it. Fail closed.
        author = as_facts(facts)
        if author is not None and author.source == "author":
            return None, None, [_NOT_CONSTRUCTION]
    if _is_construction(raw_spec):
        card = as_facts(facts)
        if card is None:
            return None, None, [_NOT_READ]
        # An author card is checked for what the figure shows; what the
        # student constructs is checked to be absent (below).
        facts = as_drawn(card) if card.source == "author" else card
        # The question's figure first: a step figure is checked against it,
        # so when it can't be read (a stored figure whose labels a later rule
        # refuses, say) the step's is refused, whatever it looks like, and
        # no redraw can help. Fail closed.
        base_fig = None
        if _is_construction(base):
            try:
                base_fig = ConstructionFigure.model_validate(base)
            except ValidationError:
                return None, None, [_BASE_UNREADABLE]
        raw_spec = with_arc_sides(_without_empty_mark_groups(raw_spec), f"{text}\n{request}\n{step_text or ''}")
        try:
            fig = ConstructionFigure.model_validate(raw_spec)
            if step_text is None:
                try:
                    raw_spec = _without_unbacked_marks(raw_spec, fig, text, facts)
                except Exception:
                    logger.exception("figure checker crashed on marks; spec=%r", raw_spec)
                    return None, None, [_CHECK_CRASHED]
                fig = ConstructionFigure.model_validate(raw_spec)
            svg = render_figure(raw_spec)
        except ValidationError as e:
            reasons = "; ".join(str(err["msg"]).removeprefix("Value error, ") for err in e.errors()[:3])
            return None, None, [f"the figure is malformed ({reasons})"]
        except Exception:
            logger.exception("unexpected error rendering construction figure; spec=%r", raw_spec)
            return None, None, ["the figure couldn't be drawn"]
        try:
            issues = [
                i.message for i in check_construction(
                    fig, text, final_answer=final_answer, request_text=request,
                    step_text=step_text, base=base_fig, facts=facts,
                )
            ]
            # Who draws what is on an author card: what the student
            # constructs is never in the figure.
            if card.source == "author":
                issues += constructed_drawn(fig, card) + unlisted_points(fig, card)
        except Exception:
            # A checker bug must never pass a figure, nor crash generation,
            # the chat or accept: the figure is dropped with a reason.
            logger.exception("figure checker crashed; spec=%r", raw_spec)
            issues = [_CHECK_CRASHED]
        if issues:
            logger.warning("construction figure dropped: %s", "; ".join(issues))
            return None, None, issues
        return raw_spec, svg, []
    shape_svg = render_figure_or_none(raw_spec, context="figure_spec")
    if not shape_svg:
        return None, None, [_figure_drop_reason(raw_spec, text)]
    missing = _named_points(text) - {_canon_point(n) for n in figure_point_names(raw_spec)}
    if missing:
        logger.warning("figure_spec dropped: problem names %s, which the figure doesn't draw", sorted(missing))
        return None, None, [_figure_drop_reason(raw_spec, text)]
    return raw_spec, shape_svg, []


def _without_empty_mark_groups(raw_spec: dict[str, Any]) -> dict[str, Any]:
    """Mark groups that tie fewer than two different parts ([], ["BD"],
    ["BD", "DB"]) claim nothing: they are dropped before the figure is
    validated (the model emits them; removing a mark never makes a figure
    false). The DSL rejects any that reach it."""
    out = dict(raw_spec)
    lines = {ln.get("name") for ln in raw_spec.get("lines") or [] if isinstance(ln, dict)}
    for name, size in (("tick_groups", 2), ("arc_groups", 3), ("parallel_groups", 2)):
        groups = raw_spec.get(name)
        if not isinstance(groups, list):
            continue
        kept = []
        for g in groups:
            if not isinstance(g, list):
                kept.append(g)
                continue
            try:
                firsts: dict[Any, Any] = {}  # one reference per part, the first given
                for ref in g:
                    if name == "parallel_groups" and ref in lines:
                        firsts.setdefault(ref, ref)
                        continue
                    pts = split_points(str(ref), size)
                    firsts.setdefault(frozenset(pts) if size == 2 else (pts[1], frozenset((pts[0], pts[2]))), ref)
            except ValueError:
                kept.append(g)  # malformed: validation says why
                continue
            if len(firsts) >= 2:
                kept.append(list(firsts.values()))
        if kept != groups:
            logger.info("construction figure: dropping %s that tie fewer than two parts", name)
            out[name] = kept
    return out


_CHECK_CRASHED = "the figure checker hit an error on this figure, so it can't confirm it"
_NOT_READ = "the problem wasn't read for checking, so the figure can't be confirmed"
_NOT_CONSTRUCTION = "a figure for a problem written from its fact card must be a construction, so it can be checked"


def _without_unbacked_marks(
    raw_spec: dict[str, Any], fig: ConstructionFigure, text: str, facts: Any = None,
) -> dict[str, Any]:
    """The question's figure minus marks no given backs (a derived fact
    marked would hand the student a step). A step's figure keeps its marks:
    showing what the step derives is its job."""
    drop = unbacked_marks(fig, text, facts)
    if not drop:
        return raw_spec
    logger.info("construction figure: dropping marks the problem doesn't give: %s", drop)
    out = dict(raw_spec)
    for name, indexes in drop.items():
        out[name] = [g for i, g in enumerate(raw_spec.get(name) or []) if i not in indexes]
    return out


def _resolve_figure(
    raw_spec: Any, text: str, *, final_answer: str = "", facts: Any = None,
) -> tuple[dict[str, Any] | None, str | None]:
    """(spec, svg) from `_check_figure`; both None when the figure is dropped."""
    spec, svg, _ = _check_figure(raw_spec, text, final_answer=final_answer, facts=facts)
    return spec, svg


async def _resolve_figure_with_retry(
    raw_spec: Any,
    text: str,
    *,
    mode: str,
    user_id: str | None,
    final_answer: str = "",
    request: str = "",
    step_text: str | None = None,
    base: Any = None,
    generation_job_id: str | None = None,
    facts: Any = None,
    fresh: bool = False,
) -> tuple[dict[str, Any] | None, str | None, list[str], FigureFacts | None]:
    """`_check_figure`, plus ONE retry for a construction figure that fails:
    the same model and mode are shown the checker's exact errors (the eval
    found most mistakes are fixed once named). A second failure keeps no
    figure and returns the second attempt's reasons.

    With `fresh` (a problem the AI wrote, with its fact card as `facts`),
    a figure that still fails, or was never drafted, gets one more try: a
    new drawing from the card alone, without the failed one to anchor on.

    A construction is checked against the problem's agreed reading: `facts`
    when the caller has it, else the problem is read here first (two AI
    readings checked by code). A reading that can't be trusted means no
    figure, and no retry (a redraw can't fix it). Returns the reading too,
    so it can be stored with the figure."""
    reading = as_facts(facts)
    if raw_spec is None and fresh and reading is not None:
        return await _draw_fresh(text, reading, [], mode=mode, user_id=user_id, final_answer=final_answer,
                                 generation_job_id=generation_job_id)
    if fresh and reading is not None and isinstance(raw_spec, dict) and not _is_construction(raw_spec):
        # A shape-form figure can't be held to the card (_check_figure
        # refuses it): the card's own fresh drawing instead.
        return await _draw_fresh(text, reading, [_NOT_CONSTRUCTION], mode=mode, user_id=user_id,
                                 final_answer=final_answer, generation_job_id=generation_job_id)
    if _is_construction(raw_spec) and reading is None:
        reading, why = await read_figure_facts(
            text, final_answer=final_answer, request=request, mode=mode, user_id=user_id,
            generation_job_id=generation_job_id,
        )
        if reading is None:
            logger.warning("construction figure dropped: %s", "; ".join(why))
            return None, None, why, None
    spec, svg, issues = _check_figure(
        raw_spec, text, final_answer=final_answer, request=request, step_text=step_text, base=base,
        facts=reading,
    )
    if not issues or not _is_construction(raw_spec) or all(_not_redrawable(i) for i in issues):
        return spec, svg, issues, reading
    redrawn = await redraw_figure(
        text, raw_spec, issues, mode=mode, user_id=user_id, request=request,
        step_text=step_text, base_spec=base if _is_construction(base) else None,
        generation_job_id=generation_job_id, facts=reading,
    )
    if redrawn is not None:
        spec, svg, issues = _check_figure(
            redrawn, text, final_answer=final_answer, request=request, step_text=step_text, base=base,
            facts=reading,
        )
    if svg or not fresh or reading is None or all(_not_redrawable(i) for i in issues):
        return spec, svg, issues, reading
    return await _draw_fresh(text, reading, issues, mode=mode, user_id=user_id, final_answer=final_answer,
                             generation_job_id=generation_job_id)


async def _draw_fresh(
    text: str, card: FigureFacts, issues: list[str], *, mode: str, user_id: str | None, final_answer: str = "",
    generation_job_id: str | None = None,
) -> tuple[dict[str, Any] | None, str | None, list[str], FigureFacts | None]:
    """The one fresh figure for a problem with a fact card: drawn from the
    card alone, checked like any figure. No figure when it fails too (with
    the earlier reasons when the call returns none)."""
    drawn = await draw_figure(text, card, mode=mode, user_id=user_id, generation_job_id=generation_job_id)
    if drawn is None:
        return None, None, issues or ["no figure was drawn"], card
    spec, svg, why = _check_figure(drawn, text, final_answer=final_answer, facts=card)
    return spec, svg, why, card


def _not_redrawable(issue: str) -> bool:
    """A reason no redraw can fix: the checker crashed, the problem wasn't
    read, the question's figure a step is checked against can't be read, or
    the problem itself can't be done (an angle pair off its parallel lines)."""
    return issue in (_CHECK_CRASHED, _NOT_READ, _BASE_UNREADABLE) or "not the parallel lines given" in issue


async def _render_step_figures_with_retry(
    steps: list[Any],
    *,
    question_text: str,
    question_spec: Any,
    mode: str,
    user_id: str | None,
    facts: Any = None,
    generation_job_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[int, list[str]], FigureFacts | None]:
    """Render steps; a construction step figure that fails its check gets
    the one retry, then the step is kept without a figure. Returns the
    steps, per 1-based step number why its figure was dropped, and the
    question's reading the step figures were checked against (read once
    here unless `facts` is given).

    TODO(fact cards): a step's own facts still come from reading its
    explanation (`with_step`), even when the question has an author card.
    Step diagrams written from a card (the AI writing each step's card,
    code checking it) are a follow-up; they don't fit cleanly here."""
    raw_steps = [s for s in steps if isinstance(s, dict)]
    drops: dict[int, list[str]] = {}
    reading = as_facts(facts)
    if reading is None and any(_is_construction(s.get("figure_spec")) for s in raw_steps):
        reading, why = await read_figure_facts(
            question_text, mode=mode, user_id=user_id, generation_job_id=generation_job_id,
        )
        if reading is None:
            for i, s in enumerate(raw_steps):
                if _is_construction(s.get("figure_spec")):
                    drops[i + 1] = why
    if reading is not None:
        drops.update(await read_step_facts(
            raw_steps, question_text=question_text, facts=reading, mode=mode, user_id=user_id,
            generation_job_id=generation_job_id,
        ))
    out = _render_step_figures(steps, question_text=question_text, question_spec=question_spec)
    # _render_step_figures keeps every dict step, in order.

    async def fix(i: int, raw: dict[str, Any]) -> None:
        spec, svg, issues, _ = await _resolve_figure_with_retry(
            raw["figure_spec"], question_text, mode=mode, user_id=user_id,
            step_text=_step_text(raw), base=question_spec, facts=raw["figure_facts"],
            generation_job_id=generation_job_id,
        )
        if svg:
            out[i] = {**out[i], "figure_spec": spec, "figure_svg": svg, "figure_facts": raw["figure_facts"]}
        else:
            drops[i + 1] = issues
            logger.warning("step %d figure dropped after its retry: %s", i + 1, "; ".join(issues))

    await asyncio.gather(*(
        fix(i, raw) for i, raw in enumerate(raw_steps)
        if _is_construction(raw.get("figure_spec")) and raw.get("figure_facts") and "figure_svg" not in out[i]
    ))
    return out, drops, reading


_CANT_DRAW = "The diagram tool can't draw this setup yet — it can draw one triangle, circle, or polygon."


def _figure_drop_reason(raw_spec: dict[str, Any], text: str) -> str:
    """Why `_resolve_figure` dropped `raw_spec` (or `_render_step_figures`,
    with text ""), as a sentence a teacher can read. Re-checks rather than
    threading a reason out of the render path: a drop is rare, rendering
    is cheap, and every other caller only wants (spec, svg)."""
    try:
        render_figure(raw_spec)
    except FigureSpecError as e:
        # dsl.PolygonFigure's own wording — the rejection teachers hit by
        # asking for a labeled diagonal (prod, 2026-11-01).
        if "(a diagonal)" in str(e):
            return "The diagram tool can't label a polygon's diagonals yet."
        return _CANT_DRAW
    except Exception:
        return _CANT_DRAW
    missing = _named_points(text) - {_canon_point(n) for n in figure_point_names(raw_spec)}
    if not missing:
        return _CANT_DRAW
    return (
        "The diagram tool can draw one triangle, circle, or polygon, and this problem "
        f"also needs point{'s' if len(missing) > 1 else ''} {', '.join(sorted(missing))}."
    )


# A problem that points at a figure, in any wording: "in the figure
# below", "The figure shows", "Look at the diagram:", "In the given
# figure", "as shown", "pictured", "the right triangle below", "Figure 2".
# Erring wide only makes more problems need a figure (never a false pass).
# Not bare "above"/"below" ("300 feet above the ground" points at
# nothing), not "the graph" ("use the graph paper"), not "as shown in the
# table", and not "the figure skater".
_PICTURE_WORDS = "figure|diagram|picture|drawing|sketch|illustration"
_PICTURE = rf"(?:{_PICTURE_WORDS})s?"
_FIGURE_REFERENCE = re.compile(
    rf"\b(?:the|this|that|these|each|following|given|accompanying|attached|adjacent)\s+{_PICTURE}\b"
    r"(?!\s+skat)"
    rf"|\b(?:{_PICTURE_WORDS}|triangle|circle|graph|quadrilateral|polygon|rectangle|trapezoid|parallelogram)s?"
    r"\s+(?:below|above|shown|shows|here|at (?:the )?(?:right|left)|to the (?:right|left))\b"
    r"|\b(?:shown|pictured|drawn|illustrated|depicted)\s+(?:below|above|here|at (?:the )?(?:right|left)"
    r"|to the (?:right|left))\b"
    r"|\b(?:as|is|are)\s+(?:shown|pictured|illustrated|depicted)\b(?!\s+in\s+(?:the|a|this)\s+(?:table|chart|list))"
    r"|\bpictured\b"
    r"|\b(?:fig\.|figure)\s*\d+\b",
    re.IGNORECASE,
)


def apply_card(q: dict[str, Any]) -> None:
    """Read the fact card the AI wrote with a problem (`figure_card`, from
    the generation call) and write the problem's text from it.

    A card that passes (api/core/geometry/fact_card.read_card) becomes the
    problem's `card` and its text is code's: the context and hint kept only
    when they name no point and state nothing, the givens and ask one fixed
    phrase per fact. Who draws it is the card's too: the student draws only
    what the card says they construct. A refused card leaves `card` None and
    the problem wanting a figure it can't have, so it is replaced (its text,
    if the AI wrote one anyway, is never shown with a figure). A problem
    without a card is left as it is."""
    if "figure_card" not in q:
        q.setdefault("card", None)
        if not str(q.get("text") or "").strip():
            # No words and no card (the prompt says leave the text empty for
            # a card): nothing to show, so it is replaced like a refused card.
            q["card_refused"] = ["the problem came with no words and no fact card"]
        return
    raw = q.pop("figure_card")
    context, hint = q.pop("context", ""), q.pop("hint", "")
    if isinstance(raw, dict) and ({"context", "hint"} & set(raw)):
        # The AI often nests the problem's own context or hint inside the
        # card (Eval 1: 27 cards refused for that alone). They are the
        # problem's fields, not the card's: lift them out, keeping a
        # top-level value when both are given, and they still go through
        # the closed lists below like any other context or hint.
        raw = dict(raw)
        nested_context, nested_hint = raw.pop("context", ""), raw.pop("hint", "")
        context = context or nested_context
        hint = hint or nested_hint
    card, why = read_card(raw)
    q["card"] = card
    if card is None:
        logger.warning("fact card refused: %s", "; ".join(why))
        q["card_refused"] = why
        return
    kept_context, why_context = clean_context(context)
    kept_hint, why_hint = clean_hint(hint, card)
    for w in (why_context, why_hint):
        if w:
            logger.info("fact card: %s, so it was left out", w)
    q["text"] = card_text(card, context=kept_context, hint=kept_hint)
    q["card_words"] = (kept_context, kept_hint)
    q["requires_drawing"] = student_constructs(card)


def _has_card(q: dict[str, Any]) -> bool:
    """The AI wrote a fact card for the problem (kept or refused)."""
    return q.get("card") is not None or bool(q.get("card_refused"))


async def _draw_figures(
    questions: list[dict[str, Any]], *, user_id: str | None, generation_job_id: str | None,
) -> None:
    """Render each question's figure in place. A problem the AI wrote a
    figure for is checked against its fact card (no readings of its words):
    one redraw on the checker's errors, then one fresh drawing from the
    card. A figure without a card can't be checked, so it is dropped. A spec
    that fails is dropped, so a question only ever carries a figure the
    student will actually see — and the solver is only shown that."""

    async def draw(q: dict[str, Any]) -> None:
        card = q.get("card")
        if not _has_card(q):
            # No card: the student's own drawing (the AI's flag, or the words:
            # "graph y = …", "construct …") is never drawn for them, and the
            # problem doesn't want a figure.
            _drop_unwanted_figure(q, generation_job_id, teacher_draws=combine_requires_drawing(
                q.get("text") or "", q.get("requires_drawing")))
        # The AI's own choice, kept after a failed check drops the spec.
        q["figure_wanted"] = bool(q.get("figure_spec")) or _has_card(q)
        if card is None and q.get("figure_spec"):
            # No card, or a refused one: nothing to hold the figure to (an
            # AI-written problem's words are never read back), so no figure.
            logger.warning("Job %s: a figure came without a fact card it can be checked against: %.80s",
                           generation_job_id, q.get("text"))
            q["figure_spec"] = None
        if card is None:
            # Every figure without a card was dropped above: none is shown.
            q["figure_spec"] = q["figure_svg"] = q["figure_facts"] = None
            return
        spec, svg, issues, _ = await _resolve_figure_with_retry(
            q.get("figure_spec"), q.get("text") or "", mode=LLMMode.GENERATE_QUESTIONS,
            user_id=user_id, generation_job_id=generation_job_id, facts=card, fresh=True,
        )
        q["figure_spec"], q["figure_svg"] = spec, svg
        q["figure_facts"] = card.model_dump() if svg else None
        if issues:
            logger.warning("Job %s: no checked figure for a fact-card problem (%s): %.80s",
                           generation_job_id, "; ".join(issues), q.get("text"))

    await asyncio.gather(*(draw(q) for q in questions))


def _drop_unwanted_figure(q: dict[str, Any], job_id: str | None = None, *, teacher_draws: bool | None = None) -> None:
    """Ben's rule: what the student draws or constructs is not in the
    figure. Who draws what is on the problem's fact card: the parts it lists
    are shown (an auxiliary line such as the median AD in "Draw the median
    AD. Prove …" included), what it says the student constructs is never
    drawn (the checker refuses a figure that draws it:
    fact_card.constructed_drawn). No guessing from the words.

    One choice stands over the card: a teacher's own "the student draws it"
    (`teacher_draws`, on regenerate) drops the drafted figure before it is
    drawn. A problem with no card (a shape-form figure) passes its stored
    flag as `teacher_draws`: what the student draws is never drawn for them.
    This only ever removes a figure, never makes one wrong."""
    if q.get("figure_spec") and teacher_draws is True:
        logger.info("Job %s: the teacher says the student draws this one, so its figure is dropped: %.80s",
                    job_id, q.get("text"))
        q["figure_spec"] = None


def _needs_figure(q: dict[str, Any]) -> bool:
    """The problem wants a figure: the generating AI drafted one for it
    (`figure_spec`, following the when-to-draw rule in its prompt;
    `figure_wanted` keeps that choice after a failed check drops the spec),
    or its text points at a figure ("in the figure below", "as shown"). The
    AI decides; code checks the figure, and holds a problem that points at a
    figure to having one. No guessing from the words."""
    if q.get("figure_wanted") or q.get("figure_spec"):
        return True
    return bool(_FIGURE_REFERENCE.search(q.get("text") or ""))


_ANGLE_NAME = re.compile(r"(?:\\angle|∠)\s*\{?\s*([0-9]+|[A-Z]{1,3})\b")


def answer_names_unseen_angles(text: str, answer: str) -> list[str]:
    """Angles the answer names that the problem never shows: a number the
    problem doesn't label (∠4), or a letter that isn't one of its points.
    With no figure, the student can't know which angle is ∠4, so the
    problem can't be answered as written. Only ever leaves a problem out."""
    # Any number in the text counts as shown ("angles 1 and 2", "∠3"), and
    # any capital (a sentence's first letter too): this leans toward keeping
    # a problem, never toward leaving one out wrongly.
    numbers = set(re.findall(r"[0-9]+", re.sub(r"\\[a-zA-Z]+", " ", text)))
    letters = set(re.findall(r"[A-Z]", re.sub(r"\\[a-zA-Z]+", " ", text)))
    out: list[str] = []
    for name in _ANGLE_NAME.findall(answer):
        unseen = name not in numbers if name.isdigit() else not set(name) <= letters
        if unseen and f"∠{name}" not in out:
            out.append(f"∠{name}")
    return out


def _lacks_figure(q: dict[str, Any]) -> bool:
    """Wants a figure (`_needs_figure`) but has no checked one to show."""
    return not q.get("figure_svg") and _needs_figure(q)


def schedule_generation_job(job_id: uuid.UUID) -> None:
    """Schedule a generation job to run as a fire-and-forget task.

    Called from the route handler after the job row is committed. The
    task picks up the job, runs Claude, writes results, and updates the
    job's status. Lost if the process restarts mid-task — acceptable
    for v1.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running event loop — cannot schedule generation job %s", job_id)
        return

    task = loop.create_task(_run_job(job_id))
    _inflight_jobs.add(task)
    task.add_done_callback(_inflight_jobs.discard)


async def _run_job(job_id: uuid.UUID) -> None:
    """The actual generation worker. Owns its own DB session."""
    factory = get_session_factory()
    async with factory() as db:
        job = (await db.execute(
            select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
        )).scalar_one_or_none()
        if not job:
            logger.error("Generation job %s not found", job_id)
            return

        try:
            await _run_generation(db, job)
        except Exception as e:
            logger.exception("Generation job %s failed", job_id)
            job.status = "failed"
            # error_message is rendered to the teacher verbatim. Only our
            # own copy is written for her — a provider error reads
            # "Claude Vision API error: Error code: 400 - {'type': ...}",
            # which tells her nothing and leaks our internals into a red
            # banner. The real text is in the log above.
            job.error_message = (
                str(e)[:1000]
                if isinstance(e, TeacherFacingGenerationError)
                else "Generation failed before any questions came back. "
                     "Try again — if it keeps failing on the same files, "
                     "try fewer or smaller ones."
            )
            job.updated_at = datetime.now(UTC)
            await db.commit()


_EXTRACT_WORKSHEET_TEMPLATE = """\
You are a {professor_role} extracting problems from a teacher's worksheet.

The teacher has uploaded pages of an existing worksheet or problem set
(photos or a PDF). Extract every individual problem exactly as written
— do NOT rewrite, simplify, or invent new problems. Preserve the
original wording and any LaTeX notation.

Rules:
- Extract each problem as a separate item
- Use LaTeX with $ delimiters for math expressions
- Use single backslashes for LaTeX commands (e.g. \\frac, \\sqrt)
- If a problem references a diagram or figure, describe it in brackets
  at the end of the problem text (same as image extraction rules)
- Skip headers, instructions, page numbers, and non-problem text
- If you cannot read something clearly, skip it rather than guessing
- Rate each problem's difficulty based on the content
- Extract at most 40 problems. If the worksheet has more, extract the
  first 40 and stop.
- DO NOT emit a `figure_spec` on any extracted problem. The
  extraction job's contract is "copy the textbook verbatim" — and
  the geometry DSL only covers triangles / circles / polygons, so
  any attempt to translate a textbook figure into a spec would
  either fail or produce a structurally-different diagram. Leave
  figure_spec null and rely on the bracket-described figure text in
  the problem itself. The teacher will see the original photo
  alongside the extracted problem on review.
"""


async def _extract_from_files(
    files: list[dict[str, str]],
    *,
    subject: str,
    user_id: str,
    constraint: str | None = None,
    call_metadata: dict[str, Any] | None = None,
    generation_job_id: str | None = None,
) -> list[dict[str, str]]:
    """Extract problems from worksheet pages (images or PDFs) via Claude.

    Returns list of {"title", "text", "difficulty"} — same shape as
    generate_questions() so the downstream pipeline is unchanged.

    `constraint` is an optional natural-language scope hint from the
    teacher (e.g. "Q1-13 odd"). When set, it's appended to the system
    prompt so the model only pulls problems matching it.
    """
    cfg = get_config(subject)
    system_prompt = _EXTRACT_WORKSHEET_TEMPLATE.format(
        professor_role=cfg["professor_role"],
    )

    scoped = (constraint or "").strip()
    if scoped:
        system_prompt += (
            "\n\nThe teacher specified which problems to pull — treat this "
            "as the source of truth and skip everything else:\n"
            f'"{scoped}"'
        )

    content: list[dict[str, Any]] = [
        to_content_block(f["media_type"], f["data"]) for f in files
    ]
    content.append({
        "type": "text",
        "text": (
            f"{system_prompt}\n\n"
            "Extract all problems from the worksheet pages above."
        ),
    })

    result = await call_claude_vision(
        content,
        mode=LLMMode.BANK_EXTRACT,
        tool_schema=GENERATE_QUESTIONS_SCHEMA,
        user_id=user_id,
        model=MODEL_REASON,
        max_tokens=4096,
        call_metadata=call_metadata,
        generation_job_id=generation_job_id,
    )

    questions: list[Any] = result.get("questions", [])  # type: ignore[assignment]
    normalized = []
    for q in questions:
        if not isinstance(q, dict) or "text" not in q:
            continue
        entry = {
            "title": str(q.get("title") or "")[:120],
            "text": str(q["text"]),
            "difficulty": str(q.get("difficulty", "medium")),
        }
        if isinstance(q.get("requires_drawing"), bool):
            entry["requires_drawing"] = q["requires_drawing"]
        normalized.append(entry)
    return normalized


class TeacherFacingGenerationError(RuntimeError):
    """A generation failure whose message is written for the teacher.

    `job.error_message` is rendered to her verbatim, so the type marks
    which failures are safe to show. Anything else — a provider 400, a
    parse failure, a timeout — carries wording aimed at us ("Claude
    Vision API error: Error code: 400 - {'type': ...}") and gets replaced
    before it reaches her.
    """


def _empty_result_message(docs_selected: int, docs_used: int) -> str:
    """What to tell the teacher when generation returns nothing.

    The old copy always blamed her instructions. When some of her source
    documents were left behind — over the per-call count or the request
    size budget — that is worth naming, because it's the part she can
    act on and she was never shown those limits. It's offered as a
    likely cause rather than the cause: the model can also return
    nothing on a selection that fit perfectly well, so the instructions
    hint stays.
    """
    raw_budget_mb = round(MAX_TOTAL_SOURCE_B64_BYTES * 3 / 4 / 1024 / 1024)
    if docs_used < docs_selected:
        skipped = docs_selected - docs_used
        return (
            f"The AI didn't return any questions. {skipped} of your "
            f"{docs_selected} source files weren't sent — a generation "
            f"carries {MAX_VISION_IMAGES} files, up to about "
            f"{raw_budget_mb}MB in total — which may be why. Try again "
            "with fewer or smaller files selected, or adjust your "
            "instructions."
        )
    return (
        "The AI didn't return any questions. Try adjusting your "
        "instructions or selecting different source documents."
    )


_REPLACEMENT_RULE = (
    "Every problem must be complete on its own. Follow the when-to-draw rule; a problem that "
    "gets a figure comes with its fact card (figure_facts) and a figure_spec that draws exactly "
    "the card's points and parts."
)


def shortfall_note(asked: int, kept: int) -> str:
    """The note the teacher gets when a set comes back short: a slot that
    didn't pass its checks (most often a diagram that couldn't be checked;
    also a repeat, or a replacement that didn't come) is left out, never
    filled with a problem off the topic's geometry."""
    left = asked - kept
    return (
        f"{kept} of {asked} problems are ready. {left} more didn't pass our checks (usually a diagram "
        f"that couldn't be confirmed), so {'it was' if left == 1 else 'they were'} left out — "
        "generate again for more."
    )


def job_notice(job: Any) -> str | None:
    """The note a finished job shows the teacher beside its problems, as its
    own field (not an error: the job is done): a generated set that came
    back short says how many were left out (`shortfall_note`)."""
    if job.status != "done" or job.mode == "upload":
        return None
    asked, kept = int(job.requested_count or 0), int(job.produced_count or 0)
    return shortfall_note(asked, kept) if 0 < asked and kept < asked else None


@dataclass(frozen=True)
class ProblemRequest:
    """What a generation job asks for: everything a call for problems takes
    but the count and the rule for that call."""

    unit_name: str
    course_name: str
    subject: str
    user_id: str
    images: list[dict[str, str]] | None = None
    constraint_text: str | None = None
    assignment_title: str | None = None
    params: dict[str, Any] | None = None
    call_metadata: dict[str, Any] | None = None
    job_id: str | None = None


def _normalized(text: Any) -> str:
    return " ".join(str(text or "").split()).casefold()


def _without_repeats(new: list[dict[str, Any]], kept: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`new` less any problem whose text (spacing and case aside) is already
    in `kept` or earlier in `new`."""
    seen = {_normalized(q.get("text")) for q in kept}
    out = []
    for q in new:
        key = _normalized(q.get("text"))
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out


async def _ask_for_problems(
    request: ProblemRequest, count: int, rule: str, kept: list[dict[str, Any]], *, failed: str,
) -> list[dict[str, Any]]:
    """`count` more problems under `rule`, told which problems the set
    already has so none comes back twice. A failed call returns none (logged
    as `failed`): the problems already kept still ship."""
    already = (
        "The set already has these problems; do not repeat any of them:\n"
        + "\n".join(f"- {q.get('text') or ''}" for q in kept)
    ) if kept else ""
    try:
        more = cast(list[dict[str, Any]], await generate_questions(
            unit_name=request.unit_name,
            count=count,
            course_name=request.course_name,
            subject=request.subject,
            user_id=request.user_id,
            images=request.images,
            extra_instructions="\n\n".join(t for t in (request.constraint_text, rule, already) if t),
            assignment_title=request.assignment_title,
            params=request.params,
            call_metadata=request.call_metadata,
            generation_job_id=request.job_id,
        ))
    except Exception:
        logger.exception("Job %s: %s", request.job_id, failed)
        return []
    for q in more:
        apply_card(q)
    return more


async def generate_checked_problems(
    request: ProblemRequest, *, count: int, docs_selected: int = 0,
) -> list[dict[str, Any]]:
    """Generate problems and draw each one's figure, checked against its fact
    card. A problem that wants a figure (`_needs_figure`: the AI wrote a card
    or drafted a figure, or it refers to one) and ends without a checked
    one (after its redraw and fresh drawing), or repeats another problem, is
    replaced once. A slot whose replacement has the same flaw is left out,
    never handed to the teacher broken nor filled with a problem that only
    tells the geometry as a story: the set comes back short, and the job
    tells the teacher (`job_notice`). Each call for more
    problems is told the ones already kept, and an exact repeat is dropped."""
    question_dicts: list[dict[str, Any]] = cast(list[dict[str, Any]], await generate_questions(
        unit_name=request.unit_name,
        count=count,
        course_name=request.course_name,
        subject=request.subject,
        user_id=request.user_id,
        images=request.images,
        extra_instructions=request.constraint_text,
        assignment_title=request.assignment_title,
        params=request.params,
        call_metadata=request.call_metadata,
        generation_job_id=request.job_id,
    ))
    if not question_dicts:
        # Reached only when the call SUCCEEDED and came back empty — a real
        # API failure propagates with its own cause rather than arriving
        # here disguised as "no questions".
        raise TeacherFacingGenerationError(_empty_result_message(docs_selected, len(request.images or [])))
    for q in question_dicts:
        apply_card(q)

    def lacks(q: dict[str, Any]) -> bool:
        return _lacks_figure(q)

    job_id, asked = request.job_id, len(question_dicts)
    question_dicts = _without_repeats(question_dicts, [])
    await _draw_figures(question_dicts, user_id=request.user_id, generation_job_id=job_id)
    kept = [q for q in question_dicts if not lacks(q)]
    missing = asked - len(kept)
    if not missing:
        return kept
    logger.warning(
        "Job %s: replacing %d problem(s) that need a figure they don't have, or repeat another", job_id, missing,
    )
    replacements = await _ask_for_problems(
        request, missing, _REPLACEMENT_RULE, kept, failed="replacement call failed; keeping the rest",
    )
    await _draw_figures(replacements, user_id=request.user_id, generation_job_id=job_id)
    kept += _without_repeats([q for q in replacements if not lacks(q)], kept)[:missing]
    if len(kept) < asked:
        logger.warning("Job %s: left out %d problem(s) with no figure that could be checked", job_id,
                       asked - len(kept))
    if not kept:
        raise TeacherFacingGenerationError(
            "Every generated problem needed a figure that couldn't be drawn. Try again."
        )
    return kept


async def solve_checked_problems(
    question_dicts: list[dict[str, Any]],
    *,
    subject: str,
    user_id: str,
    job_id: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Solve each problem, then, per problem in parallel: drop a figure that
    prints the answer (it was drawn before the problem was solved), and
    check each step's figure (read, checked against the problem's figure
    and facts, one redraw, else the step keeps no figure). A problem that
    needs a figure and lost it is left out (the set comes back short, with
    the job's note to the teacher). Returns the kept problems and their
    solutions."""
    solutions = await generate_solutions(
        question_dicts, subject=subject, user_id=user_id, generation_job_id=job_id,
    )
    sem = asyncio.Semaphore(5)

    async def check(q: dict[str, Any], s: dict[str, Any]) -> str | None:
        """Why the problem must be left out, or None."""
        if s.get("final_answer"):
            s["final_answer"] = real_newlines(s["final_answer"])
        lost = None
        wanted = _needs_figure(q)
        card = q.get("figure_facts")
        if _is_construction(q.get("figure_spec")):
            kept_spec, kept_svg, issues = _check_figure(
                q["figure_spec"], q.get("text") or "", final_answer=s.get("final_answer") or "",
                facts=q.get("figure_facts"),
            )
            if issues:
                logger.warning("Job %s: figure dropped after solving: %s", job_id, "; ".join(issues))
            q["figure_spec"], q["figure_svg"] = kept_spec, kept_svg
            if not kept_svg:
                q["figure_facts"] = None
            if issues and wanted and not kept_svg:
                lost = "; ".join(issues)
        if lost is None and wanted is False and not q.get("figure_svg"):
            unseen = answer_names_unseen_angles(q.get("text") or "", s.get("final_answer") or "")
            if unseen:
                # Eval 1 job 35f87339 p1: "Name one pair of alternate interior
                # angles" with no figure; the answer was "∠4 and ∠6".
                lost = f"the answer names angles the problem doesn't show: {', '.join(unseen)}"
        if lost is None and not q.get("figure_svg") and (unsaid := pair_lines_unsaid(card)):
            lost = "; ".join(unsaid)
        if lost is None and isinstance(s.get("steps"), list) and s["steps"]:
            async with sem:
                s["steps"], drops, _ = await _render_step_figures_with_retry(
                    s["steps"], question_text=q.get("text") or "", question_spec=q.get("figure_spec"),
                    mode=LLMMode.GENERATE_QUESTIONS, user_id=user_id, facts=q.get("figure_facts"),
                    generation_job_id=job_id,
                )
            for i, why in drops.items():
                logger.info("Job %s: step %d keeps no figure: %s", job_id, i, "; ".join(why))
        return lost

    lost = await asyncio.gather(*(check(q, s) for q, s in zip(question_dicts, solutions)))
    if not any(lost):
        return question_dicts, solutions
    logger.warning(
        "Job %s: left out %d problem(s) after solving: %s",
        job_id, sum(map(bool, lost)), " | ".join(w for w in lost if w),
    )
    kept_qs = [q for q, w in zip(question_dicts, lost) if not w]
    kept_sols = [s for s, w in zip(solutions, lost) if not w]
    if not kept_qs:
        raise TeacherFacingGenerationError(
            "Every generated problem was left out after solving: its figure gave away the answer, "
            "or it couldn't be answered as written. Try again."
        )
    return kept_qs, kept_sols


async def _run_generation(db: AsyncSession, job: QuestionBankGenerationJob) -> None:
    """Run the actual Claude calls and persist results.

    Status transitions: queued -> running -> done (or failed via _run_job).
    """
    job.status = "running"
    job.updated_at = datetime.now(UTC)
    await db.commit()

    # Course context for the prompt
    course = (await db.execute(
        select(Course).where(Course.id == job.course_id)
    )).scalar_one()

    # Unit name for the AI prompt. unit_id is required at the model
    # layer (Uncategorized was removed); a missing unit row would mean
    # an unrelated bug, so fall back to the course name without
    # masking the issue and let the prompt go out.
    unit = (await db.execute(
        select(Unit).where(Unit.id == job.unit_id)
    )).scalar_one_or_none()
    unit_name = unit.name if unit else course.name

    assignment_title, assignment_type = (await db.execute(
        select(Assignment.title, Assignment.type).where(Assignment.id == job.originating_assignment_id)
    )).one_or_none() or (None, None)
    is_practice = assignment_type == "practice"

    # 1. Get question texts — either extract from uploaded images or
    # generate via AI, depending on job mode.
    if job.mode == "upload":
        # Upload mode: extract problems from worksheet pages stored on
        # the job row. Files are [{data, media_type}] — JPEG, PNG, or PDF.
        raw_files = job.uploaded_images or []
        if not raw_files:
            raise RuntimeError("No files found on upload job")
        question_dicts = await _extract_from_files(
            raw_files,
            subject=course.subject,
            user_id=str(job.created_by_id),
            constraint=job.constraint,
            # Observability only: how many uploaded pages were fed to the
            # model. Upload pages carry no filename and aren't capped, so
            # this is a pure page count (selected == used).
            call_metadata=build_attachment_metadata(len(raw_files), raw_files),
            generation_job_id=str(job.id),
        )
        if not question_dicts:
            raise TeacherFacingGenerationError(
                "No problems could be extracted from the uploaded pages. "
                "Make sure the photos or PDF are clear and contain readable problems."
            )
        # Set requested_count to actual extracted count (was 0 at creation)
        job.requested_count = len(question_dicts)
    else:
        # Generate mode: AI invents new questions
        doc_ids = [uuid.UUID(d) for d in (job.source_doc_ids or [])]
        images = await fetch_source_documents(
            db, doc_ids, job.course_id, max_images=MAX_VISION_IMAGES,
        )
        # Observability only: record which docs (and how many of N
        # selected) actually reached the model, so the admin views can
        # flag a run the MAX_VISION_IMAGES cap silently truncated. Not
        # part of the prompt — the model's input is unchanged.
        doc_metadata = build_attachment_metadata(len(doc_ids), images) if doc_ids else None

        constraint_text = job.constraint
        if job.parent_question_id:
            parent = (await db.execute(
                select(QuestionBankItem).where(QuestionBankItem.id == job.parent_question_id)
            )).scalar_one_or_none()
            if not parent:
                raise TeacherFacingGenerationError(
                    "Parent question was deleted before its variations could be generated"
                )
            seed_block = (
                "Generate questions that are SIMILAR TO but DIFFERENT FROM "
                "this reference question. Match the same topic, difficulty, "
                "and pedagogical style, but use different numbers, contexts, "
                "or framing so each variation is its own problem.\n\n"
                f"Reference question:\n{parent.question}"
            )
            # If the parent has a structured figure, hand its spec to
            # the model so the variations stay figure-coherent (same
            # layout, different numbers). Without this, a
            # triangle-with-figure parent commonly spawned children
            # that either dropped the figure entirely or invented a
            # structurally different one — the variation tree was
            # figure-incoherent by construction.
            if parent.figure_spec:
                import json as _json
                seed_block += (
                    "\n\nThe reference question has a figure. Each "
                    "variation keeps the same layout and point names "
                    "and draws a new figure_spec for its own numbers.\n\n"
                    f"Reference figure_spec (for layout reference):\n"
                    f"{_json.dumps(parent.figure_spec, indent=2)}"
                )
            constraint_text = (
                f"{seed_block}\n\nAdditional constraint: {job.constraint}"
                if job.constraint else seed_block
            )
        if is_practice:
            # Practice is answered one value at a time (part_labels.py).
            # Last, so it reads as the final word over the teacher's brief
            # and any reference question. An upload is copied verbatim, so
            # it only gets the backstop.
            constraint_text = (
                f"{constraint_text}\n\n{PRACTICE_SINGLE_ANSWER_RULE}"
                if constraint_text else PRACTICE_SINGLE_ANSWER_RULE
            )

        # The set's title is often the only place its topic is named
        # (units are commonly just "Unit 3"). A variation already carries
        # its topic in the reference question, so it goes without.
        if job.parent_question_id:
            assignment_title = None

        request: ProblemRequest = ProblemRequest(
            unit_name=unit_name,
            course_name=course.name,
            subject=course.subject,
            user_id=str(job.created_by_id),
            images=images or None,
            constraint_text=constraint_text,
            assignment_title=assignment_title,
            params=job.params,
            call_metadata=doc_metadata,
            job_id=str(job.id),
        )
        question_dicts = await generate_checked_problems(
            request, count=job.requested_count, docs_selected=len(doc_ids),
        )

    # 2. Solve each question in parallel (capped concurrency inside), then
    # check what the answer and the steps add to each figure.
    question_dicts, solutions = await solve_checked_problems(
        question_dicts, subject=course.subject, user_id=str(job.created_by_id), job_id=str(job.id),
    )

    # 2b. Generate 3 MCQ distractors per question. Stored on the bank
    # item so the school-student practice loop can serve MCQs with
    # zero LLM calls per kid — the teacher pays for distractor
    # generation once at publish time. Capped concurrency mirrors the
    # solve step. On failure for any one item we keep an empty list
    # rather than blocking the whole job; the consuming endpoint can
    # decide how to render that case.
    distractors_sem = asyncio.Semaphore(5)

    async def make_distractors(idx: int, q: dict[str, Any], s: dict[str, Any]) -> list[str]:
        final = s.get("final_answer")
        if not final or final.startswith("(solution failed"):
            return []
        # A multi-part practice problem would be a give-away MCQ: its
        # wrong options answer one part, the right one answers all.
        if is_practice and is_multi_part(q["text"], final):
            return []
        async with distractors_sem:
            try:
                return await generate_distractors(
                    q["text"],
                    final,
                    user_id=str(job.created_by_id),
                    subject=course.subject,
                    generation_job_id=str(job.id),
                )
            except Exception:
                logger.warning("Distractor generation failed for question %d in job %s", idx, job.id)
                return []

    distractor_lists = await asyncio.gather(
        *[make_distractors(i, q, s) for i, (q, s) in enumerate(zip(question_dicts, solutions))]
    )

    # 3. Persist as bank items (status = pending). Commit in batches of
    # _PROGRESS_BATCH so the frontend's polling banner shows real progress
    # without N+1 transactions on every single question.
    source_doc_id_strs = (
        [str(d) for d in job.source_doc_ids] if job.source_doc_ids else None
    )
    # Provenance: upload → imported, generate-similar → practice, else generated
    if job.mode == "upload":
        item_source = "imported"
    elif job.parent_question_id:
        item_source = "practice"
    else:
        item_source = "generated"

    # Whether to mark each persisted item as MCQ. Only honors the
    # teacher's request when the item also has 3 successful distractors
    # — without them there's nothing to render as MCQ choices. The
    # frontend detects the requested-vs-persisted mismatch
    # (job.params.format='mcq' but item.format='frq') and surfaces a
    # retry banner; no DB-side error path needed.
    requested_mcq = bool(job.params and job.params.get("format") == FORMAT_MCQ)

    for idx, (q, s) in enumerate(zip(question_dicts, solutions), start=1):
        item_distractors = distractor_lists[idx - 1] or None
        item_format = (
            FORMAT_MCQ
            if requested_mcq and item_distractors and len(item_distractors) == 3
            else FORMAT_FRQ
        )
        # Render the figure if the model produced a spec. Failures
        # degrade gracefully — we drop the spec and keep the question
        # rather than failing the whole batch over one bad figure.
        # The teacher still sees the question in the workshop and
        # can regenerate or accept-as-text-only.
        # Generated figures were drawn above; an upload carries none.
        figure_spec, figure_svg = q.get("figure_spec"), q.get("figure_svg")

        item = QuestionBankItem(
            course_id=job.course_id,
            unit_id=job.unit_id,
            # Stamp every produced item with the job's originating HW.
            # This is how the HW detail banner filters pending items
            # and how approved items know which HW to auto-attach to.
            originating_assignment_id=job.originating_assignment_id,
            title=q.get("title") or None,
            question=q["text"],
            # The generation/extraction call's own answer (it wrote or read
            # the question — no extra call), OR'd with the regex.
            requires_drawing=combine_requires_drawing(q["text"], q.get("requires_drawing")),
            solution_steps=s.get("steps") or None,
            final_answer=s.get("final_answer") or "",
            distractors=item_distractors,
            difficulty=q.get("difficulty") or "medium",
            format=item_format,
            status="pending",
            source_doc_ids=source_doc_id_strs,
            generation_prompt=job.constraint,
            created_by_id=job.created_by_id,
            parent_question_id=job.parent_question_id,
            source=item_source,
            figure_spec=figure_spec,
            figure_svg=figure_svg,
            figure_facts=q.get("figure_facts") if figure_svg else None,
        )
        db.add(item)
        if idx % _PROGRESS_BATCH == 0:
            job.produced_count = idx
            job.updated_at = datetime.now(UTC)
            await db.commit()

    job.status = "done"
    job.produced_count = len(question_dicts)
    # A set that came back short says so (`job_notice`, read from the counts
    # by the API): not an error, the job is done.
    job.updated_at = datetime.now(UTC)
    await db.commit()
    logger.info("Generation job %s produced %d questions", job.id, len(question_dicts))


def snapshot_history(item: QuestionBankItem) -> None:
    """Capture the current state into the previous_* columns so the teacher
    has a one-level undo. Called by both manual edits and AI regenerations
    just before mutating the live fields."""
    item.previous_question = item.question
    item.previous_solution_steps = item.solution_steps
    item.previous_final_answer = item.final_answer
    item.previous_status = item.status
    # Figure-side undo so revert restores prose AND diagram together.
    item.previous_figure_spec = item.figure_spec
    item.previous_figure_svg = item.figure_svg
    item.previous_figure_facts = item.figure_facts
    item.previous_requires_drawing = item.requires_drawing


_REGENERATE_SYSTEM_TEMPLATE = """\
You are a {professor_role} revising a single problem for a teacher's question bank.

Return one question with its complete worked solution and final answer. The
solution must be step-by-step and pedagogically clear. Use LaTeX with $ delimiters
for math expressions. Use single backslashes for LaTeX commands (e.g. \\frac, \\sqrt,
\\begin{{pmatrix}}). Do not double-escape.

Each step must have a short title (2-5 words) and a full description.
"""


async def regenerate_one(
    db: AsyncSession,
    item: QuestionBankItem,
    course: Course,
    *,
    instructions: str | None,
    user_id: uuid.UUID,
) -> None:
    """Synchronously regenerate a single bank item with one Claude call.

    Behaviour:
    - One combined Claude call returns question + solution + final answer.
    - When instructions is empty, we DROP the "original question to revise"
      anchor entirely and ask for a fresh take on the same topic. When
      instructions is provided, we include the original so Claude can build
      on it.
    - Approved questions stay approved if the teacher is just polishing
      (status preservation). Pending questions stay pending.
    - The previous version is snapshotted to previous_* columns so the
      teacher can undo via /revert.
    """
    unit = (await db.execute(
        select(Unit).where(Unit.id == item.unit_id)
    )).scalar_one_or_none()
    unit_name = unit.name if unit else course.name

    doc_ids = [uuid.UUID(d) for d in (item.source_doc_ids or [])]
    images = await fetch_source_documents(
        db, doc_ids, item.course_id, max_images=MAX_VISION_IMAGES,
    )
    # Observability only: which attached docs (of N) reached the model.
    doc_metadata = build_attachment_metadata(len(doc_ids), images) if doc_ids else None

    cfg = get_config(course.subject)
    system_prompt = _REGENERATE_SYSTEM_TEMPLATE.format(professor_role=cfg["professor_role"])
    system_prompt += (
        "\n" + WHEN_TO_DRAW + "\nFollow the when-to-draw rule; a problem that gets a figure comes with its "
        "fact card (figure_facts) and a figure_spec that draws exactly the card's points and parts. Omit "
        "both otherwise.\n\n"
        + FACT_CARD_RULES + "\n" + CONSTRUCTION_FIGURE_RULES + "\n"
    )
    qa_schema = REGENERATE_QA_CONSTRUCTION_SCHEMA

    # User message: include the topic + original constraint always; only
    # include the original question + instructions when the teacher provided
    # specific instructions to revise it.
    parts: list[str] = [
        f"Course: {course.name}",
        f"Topic: {unit_name}",
    ]
    if item.generation_prompt:
        parts.append(f"Original generation constraint: {item.generation_prompt}")
    is_practice = (await db.execute(
        select(Assignment.type).where(Assignment.id == item.originating_assignment_id)
    )).scalar_one_or_none() == "practice"

    has_instructions = bool(instructions and instructions.strip())
    if has_instructions:
        parts.append(f"Original question:\n{item.question}")
        parts.append(f"Revise it according to these instructions:\n{instructions.strip()}")  # type: ignore[union-attr]
    else:
        parts.append(
            "Generate a fresh question on the same topic and constraint. "
            "Do not reuse the original question's wording."
        )
    if is_practice:
        # Last, after the teacher's instructions: the product rule wins.
        parts.append(PRACTICE_SINGLE_ANSWER_RULE)

    user_message = "\n\n".join(parts)

    try:
        if images:
            content = build_vision_content(images, user_message)
            result = await call_claude_vision(
                content,
                mode=LLMMode.REGENERATE_BANK_ITEM,
                tool_schema=qa_schema,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
                call_metadata=doc_metadata,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                user_message,
                mode=LLMMode.REGENERATE_BANK_ITEM,
                tool_schema=qa_schema,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
                call_metadata=doc_metadata,
            )
    except Exception as e:
        raise RuntimeError(f"AI revision failed: {e}") from e

    new_title = result.get("title")
    new_steps = result.get("solution_steps")
    new_answer = result.get("final_answer")
    # A version with a fact card: its text is code's, written from the card
    # (apply_card); without one, the AI's words, and no figure.
    drafted: dict[str, Any] = {"text": str(result.get("question") or ""), "figure_spec": result.get("figure_spec")}
    if result.get("figure_facts") is not None and not is_blank_card(result.get("figure_facts")):
        drafted.update(figure_card=result["figure_facts"], context=result.get("context"), hint=result.get("hint"))
    apply_card(drafted)
    new_question = drafted["text"]
    if not new_question and drafted.get("card_refused"):
        # Its words were to come from the card, which code refused: nothing to show.
        raise RuntimeError(
            f"The new version of this problem couldn't be written ({'; '.join(drafted['card_refused'])}). "
            "Nothing was changed — try again.",
        )
    if not new_question:
        raise RuntimeError("AI revision returned no question text")
    card: FigureFacts | None = drafted.get("card")

    new_final = real_newlines(str(new_answer)) if new_answer else ""
    # Figure first, so a problem that points at a figure it can't have is
    # refused before anything is overwritten.
    # The flag the item will store, worked out once: a teacher's choice
    # stands; else the card's (the student draws what it says they
    # construct); else the AI's flag OR'd with the regex.
    stored_flag = (
        item.requires_drawing if item.requires_drawing_teacher_set
        else combine_requires_drawing(new_question, drafted.get("requires_drawing", result.get("requires_drawing")))
    )
    teacher_draws = item.requires_drawing if item.requires_drawing_teacher_set else None
    # With a card, only the teacher's own choice drops the figure (the card
    # says who draws what); without one, the stored flag does, as in
    # generation: "graph y = …" keeps no figure and is kept.
    _drop_unwanted_figure(drafted, teacher_draws=teacher_draws if card is not None else stored_flag)
    if card is not None and teacher_draws is True:
        # No figure goes with it, so its words can't say "the figure shows".
        context, hint = drafted["card_words"]
        new_question = drafted["text"] = card_text(card, context=context, hint=hint, figure=False)
    if card is None:
        # A figure with no card can't be checked (no readings of AI-written words).
        new_figure_spec = new_figure_svg = None
        new_facts = None
        figure_issues = ["; ".join(drafted.get("card_refused") or []) or "the figure came without its fact card"] \
            if drafted["figure_spec"] or _has_card(drafted) else []
    else:
        new_figure_spec, new_figure_svg, figure_issues, new_facts = await _resolve_figure_with_retry(
            drafted["figure_spec"], new_question, mode=LLMMode.REGENERATE_BANK_ITEM,
            user_id=str(user_id), final_answer=new_final, facts=card, fresh=teacher_draws is not True,
        )
    # The AI's choice of a figure, unless the teacher's "the student draws it" stands.
    # (A figure the student draws was dropped above, so it isn't wanted.)
    drafted["figure_wanted"] = (bool(drafted["figure_spec"]) or _has_card(drafted)) and teacher_draws is not True
    if card is not None and not new_figure_svg and (unsaid := pair_lines_unsaid(card)):
        # No figure goes with it, so the words alone must place the pair.
        raise RuntimeError(f"The new version of this problem can't be done from its words ({'; '.join(unsaid)}). "
                           "Nothing was changed — try again.")
    if _lacks_figure({**drafted, "figure_svg": new_figure_svg}):
        reason = "; ".join(figure_issues) or "no figure was drawn"
        logger.warning("Regenerated item %s needs a figure it doesn't have: %s", item.id, reason)
        what = "refers to a figure" if _FIGURE_REFERENCE.search(new_question) else "has a figure"
        raise RuntimeError(
            f"The new version of this problem {what} that couldn't be drawn ({reason}). "
            "Nothing was changed — try again.",
        )
    new_steps_rendered: list[dict[str, Any]] | None = None
    if isinstance(new_steps, list):
        new_steps_rendered, _, _ = await _render_step_figures_with_retry(
            new_steps, question_text=new_question, question_spec=new_figure_spec,
            mode=LLMMode.REGENERATE_BANK_ITEM, user_id=str(user_id), facts=new_facts,
        )

    snapshot_history(item)
    if new_title:
        item.title = str(new_title)[:120]
    item.question = new_question
    # A regenerated question is new AI text, so its drawing requirement is
    # re-derived — the same call's answer (REGENERATE_QA_SCHEMA) OR'd with
    # the regex — unless the teacher set it themselves.
    item.requires_drawing = stored_flag
    item.solution_steps = new_steps_rendered
    item.final_answer = new_final
    # The figure resolved above, from the regenerated payload. If the new
    # question no longer needs a figure (LLM omitted the spec), we
    # clear the stale one — otherwise the diagram on disk would
    # contradict the rewritten prose. If rendering fails we drop both
    # (graceful degradation: teacher reviews + manually retries).
    item.figure_spec = new_figure_spec
    item.figure_svg = new_figure_svg
    item.figure_facts = new_facts.model_dump() if new_facts is not None and new_figure_svg else None
    # Regenerate distractors to match the new question/answer. The old
    # distractors were keyed off the old wrong-answer patterns and would
    # be misleading on the new problem. Failure here is non-fatal —
    # we drop to None and let the next student-facing fetch handle it.
    if is_practice and is_multi_part(item.question, item.final_answer):
        item.distractors = None
    elif item.final_answer:
        try:
            item.distractors = await generate_distractors(
                item.question,
                item.final_answer,
                user_id=str(user_id),
                subject=course.subject,
            ) or None
        except Exception:
            logger.warning("Distractor regeneration failed for item %s", item.id)
            item.distractors = None
    else:
        item.distractors = None
    # Status is preserved (approved stays approved). New rows from /generate
    # already start as pending; this only affects already-curated items.
    item.updated_at = datetime.now(UTC)
    await db.commit()
