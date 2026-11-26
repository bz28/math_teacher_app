"""Step-by-step decomposition: Claude generates steps for any problem."""

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Literal

from api.core.constants import DECOMPOSITION_CACHE_MAX_SIZE, DECOMPOSITION_CACHE_TTL_SECONDS
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import DECOMPOSITION_SCHEMA
from api.core.prompts import load_prompt
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory TTL cache for non-personalized decompositions
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[float, "Decomposition"]] = {}


def _cache_get(problem: str) -> "Decomposition | None":
    """Get a cached decomposition if it exists and hasn't expired.

    Re-renders any step figures at read time so that a renderer-code
    update (deploy, hotfix) takes effect immediately instead of being
    masked by 30-minute-old cached SVGs. The cached Decomposition
    holds only the structured spec (figure_spec dict); figure_svg is
    rendered fresh here.
    """
    entry = _cache.get(problem)
    if entry is None:
        return None
    ts, decomp = entry
    if time.monotonic() - ts > DECOMPOSITION_CACHE_TTL_SECONDS:
        del _cache[problem]
        return None

    # Re-render step figures using the current renderer.
    from api.core.geometry import render_figure_or_none

    refreshed_steps: list[dict[str, Any]] = []
    for s in decomp.steps:
        if not isinstance(s, dict):
            refreshed_steps.append(s)
            continue
        rendered = dict(s)
        svg = None if _is_construction(s.get("figure_spec")) else render_figure_or_none(
            s.get("figure_spec"), context="cached step figure",
        )
        if svg:
            rendered["figure_svg"] = svg
        else:
            # No spec, or a renderer change invalidated a previously-valid
            # one — drop any stale svg rather than crash.
            rendered.pop("figure_svg", None)
        refreshed_steps.append(rendered)

    return Decomposition(
        problem=decomp.problem,
        steps=refreshed_steps,
        final_answer=decomp.final_answer,
        problem_type=decomp.problem_type,
        answer_type=decomp.answer_type,
    )


def _cache_set(problem: str, decomp: "Decomposition") -> None:
    """Cache a decomposition result.

    Strips rendered figure_svg before storing so the cache holds
    only the canonical figure_spec. Re-rendering happens on read so
    renderer-code updates take effect immediately. Without this, a
    deploy that fixes a renderer bug would leave stale SVGs in the
    in-process cache for up to DECOMPOSITION_CACHE_TTL_SECONDS.
    """
    # Evict oldest entry if cache is full (dict is insertion-ordered in Python 3.7+)
    if len(_cache) >= DECOMPOSITION_CACHE_MAX_SIZE:
        oldest_key = next(iter(_cache))
        del _cache[oldest_key]

    stripped_steps: list[dict[str, Any]] = []
    for s in decomp.steps:
        if not isinstance(s, dict):
            stripped_steps.append(s)
            continue
        stripped = {k: v for k, v in s.items() if k != "figure_svg"}
        stripped_steps.append(stripped)

    cacheable = Decomposition(
        problem=decomp.problem,
        steps=stripped_steps,
        final_answer=decomp.final_answer,
        problem_type=decomp.problem_type,
        answer_type=decomp.answer_type,
    )
    _cache[problem] = (time.monotonic(), cacheable)

_SYSTEM_PROMPT_TEMPLATE = load_prompt("step_decomposition_system")

# Learn mode's step figures: the shape forms, rendered as the solver writes
# them (a student's own problem has no checked figure to build on).
_SHAPE_STEP_FIGURES = load_prompt("step_shape_figures")

# A generated problem's step figures: the problem's checked construction
# figure plus what the step adds, checked like the problem's own
# (question_bank_generation._render_step_figures_with_retry). The first
# paragraph is Ben's wording (2026-11-13), word for word.
_CONSTRUCTION_STEP_FIGURES = load_prompt("step_construction_figures")

# Which step figures the solver may emit: "shapes" (Learn mode), "construction"
# (a generated problem with a checked construction figure), "none".
StepFigures = Literal["shapes", "construction", "none"]


def _step_prompt_ids(figures: StepFigures) -> tuple[str, ...]:
    """The prompt files `_build_system_prompt` assembles for this figure mode."""
    return ("step_decomposition_system", *{
        "shapes": ("step_shape_figures",),
        "construction": ("step_construction_figures", "construction_figure_rules"),
        "none": (),
    }[figures])


def _build_system_prompt(subject: str, figures: StepFigures = "shapes") -> str:
    cfg = get_config(subject)
    prompt = _SYSTEM_PROMPT_TEMPLATE.format(
        professor_role=cfg["professor_role"],
        domain=cfg["domain"],
    )
    if figures == "shapes":
        return prompt + _SHAPE_STEP_FIGURES
    if figures == "construction":
        # Appended after .format(): the rules hold literal braces.
        from api.core.construction_figures import CONSTRUCTION_FIGURE_RULES

        return prompt + _CONSTRUCTION_STEP_FIGURES + CONSTRUCTION_FIGURE_RULES + "\n"
    return prompt


def _schema(figures: StepFigures) -> Any:
    from api.core.llm_schemas import DECOMPOSITION_CONSTRUCTION_SCHEMA, DECOMPOSITION_NO_FIGURES_SCHEMA

    return {
        "shapes": DECOMPOSITION_SCHEMA,
        "construction": DECOMPOSITION_CONSTRUCTION_SCHEMA,
        "none": DECOMPOSITION_NO_FIGURES_SCHEMA,
    }[figures]


@dataclass
class Decomposition:
    problem: str
    # Each step is {"title", "description"} plus an optional
    # {"figure_spec", "figure_svg"} pair when the step carries a
    # geometry figure. Mixed value type — values are str except for
    # figure_spec which is a dict.
    steps: list[dict[str, Any]]
    final_answer: str
    problem_type: str
    answer_type: str = "text"


_OVER_ESCAPED_MARKERS = (
    "\\\\begin", "\\\\end", "\\\\frac", "\\\\sqrt", "\\\\sum", "\\\\int",
    "\\\\alpha", "\\\\beta", "\\\\theta", "\\\\pi", "\\\\sigma", "\\\\phi",
    "\\\\mathbb", "\\\\mathbf", "\\\\left", "\\\\right",
)


def _normalize_latex(text: str) -> str:
    """Fix uniform over-escaping in LaTeX strings from the LLM.

    Claude sometimes returns `\\\\begin{...}` (double-escaped) instead of
    `\\begin{...}` because it treats the JSON tool schema as if it required
    JSON-encoded backslashes. When this happens, EVERY backslash is doubled
    uniformly (so `\\begin` → `\\\\begin` AND `\\\\` → `\\\\\\\\`). KaTeX
    fails because `\\\\begin` is not a valid command.

    Detection: if any known LaTeX command appears with double-backslash prefix
    (which is invalid LaTeX), assume uniform over-escaping and halve all
    backslash sequences.
    """
    if any(marker in text for marker in _OVER_ESCAPED_MARKERS):
        # Uniform over-escaping detected — halve all backslash pairs
        text = text.replace("\\\\", "\\")
    return text


def _ensure_math_delimiters(answer: str) -> str:
    """Wrap answer in $$...$$ if it contains LaTeX commands but no delimiters."""
    if not answer.strip():
        return answer
    # Already has delimiters
    if "$" in answer:
        return answer
    # Contains a backslash command — likely raw LaTeX without delimiters
    if "\\" in answer:
        return f"$${answer}$$"
    return answer


def _parse_decomposition(
    data: dict[str, object],
) -> tuple[list[dict[str, Any]], str, str]:
    """Parse LLM JSON response into steps, final_answer, and answer_type.

    Steps may carry an optional `figure_spec` (validated + rendered to
    `figure_svg` here so downstream consumers — solution_steps JSON in
    the bank item, the workshop UI, the student step display — get a
    ready-to-render SVG without having to know about the geometry
    module). Failures degrade gracefully: a bad figure on step N drops
    that step's diagram, never the step itself.
    """
    # Local import — keeps step_decomposition.py importable without
    # pulling in the geometry module's sympy dependency (none today,
    # but the boundary holds for when it does).
    from api.core.geometry import render_figure_or_none

    steps_data = data["steps"]
    final_answer = data.get("final_answer", "")
    answer_type = str(data.get("answer_type", "text"))

    if not isinstance(steps_data, list):
        raise ValueError("Expected 'steps' to be a list")

    steps: list[dict[str, Any]] = []
    for s in steps_data:
        if isinstance(s, dict):
            title = _normalize_latex(str(s.get("title", "")))
            description = _normalize_latex(str(s.get("description", "")))
            step: dict[str, Any] = {"title": title, "description": description}
            raw_figure = s.get("figure_spec")
            if _is_construction(raw_figure):
                # Kept without a drawing: a construction step figure is drawn
                # only once it passes its check, which the caller runs
                # (question_bank_generation._render_step_figures_with_retry).
                step["figure_spec"] = raw_figure
            elif svg := render_figure_or_none(raw_figure, context="step figure_spec"):
                step["figure_svg"] = svg
                step["figure_spec"] = raw_figure
            steps.append(step)
        else:
            # Backward compat: plain string from older prompt format
            steps.append({"title": "", "description": _normalize_latex(str(s))})

    if answer_type not in ("text", "diagram"):
        answer_type = "text"

    final_answer_str = _normalize_latex(str(final_answer))
    final_answer_str = _ensure_math_delimiters(final_answer_str)

    return (
        steps,
        final_answer_str,
        answer_type,
    )


def _is_construction(spec: Any) -> bool:
    return isinstance(spec, dict) and spec.get("shape") == "construction"


def _is_word_problem(text: str, subject: str = Subject.MATH) -> bool:
    """Detect whether text is a word problem vs pure notation."""
    cfg = get_config(subject)
    function_names: set[str] = cfg.get("function_names", set())  # type: ignore[assignment]
    words = re.findall(r"[a-zA-Z]{3,}", text)
    return any(w.lower() not in function_names for w in words)



async def decompose_problem(
    problem: str,
    *,
    user_id: str | None = None,
    work_diagnosis: dict[str, object] | None = None,
    subject: str = Subject.MATH,
    image_base64: str | None = None,
    generation_job_id: str | None = None,
    figures: StepFigures = "shapes",
) -> Decomposition:
    """Generate step-by-step decomposition for a problem.

    If work_diagnosis is provided (from a prior work submission), the steps
    will be personalized to reference the student's specific mistakes.

    `figures` picks which step figures the solver may emit: the shape forms
    (Learn mode, the default), construction figures built on the problem's
    checked figure (a generated problem that has one; they come back
    undrawn, for the caller to check), or none.
    """
    cache_key = f"{subject}:{problem}" if figures == "shapes" else f"{subject}:{figures}:{problem}"
    # Return cached result for non-personalized calls (image or not — the
    # decomposition depends on the problem text, not the image itself).
    if not work_diagnosis:
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("Decomposition cache hit for %s", problem)
            return cached

    problem_type = "word_problem" if _is_word_problem(problem, subject) else subject
    user_message = f"Problem: {problem}"

    if work_diagnosis:
        import json
        diagnosis_text = json.dumps(work_diagnosis, indent=2)
        user_message += (
            "\n\nIMPORTANT: The student has already attempted this problem. "
            "Their work has been analyzed:\n"
            f"{diagnosis_text}\n\n"
            "When writing each step description, reference their specific mistakes where relevant.\n"
            "For steps they got right, acknowledge it briefly: \"You got this right —\" then explain the step.\n"
            "For steps where they made errors, address it directly: \"This is where your work diverged —\" "
            "then explain what they should have done and why their approach was wrong.\n"
            "For steps they skipped, note it: \"You skipped this step —\" then explain why it matters.\n"
            "If the student got the correct answer but with a suboptimal method, point out the more optimal "
            "approach and explain why it matters for harder problems.\n\n"
            "Keep the tone encouraging and constructive. The goal is to teach, not to criticize."
        )

    llm_mode = LLMMode.DECOMPOSE_DIAGNOSIS if work_diagnosis else LLMMode.DECOMPOSE

    if image_base64:
        # Use Vision API when an image is attached
        from api.core.image_utils import validate_and_decode_image
        _, media_type = validate_and_decode_image(image_base64)
        user_content: list[dict[str, object]] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": image_base64,
                },
            },
            {
                "type": "text",
                "text": _build_system_prompt(subject, figures) + "\n\n" + user_message,
            },
        ]
        result = await call_claude_vision(
            user_content,
            mode=llm_mode,
            tool_schema=_schema(figures),
            model=MODEL_REASON,
            max_tokens=8192,
            thinking_budget=2000,
            user_id=user_id,
            generation_job_id=generation_job_id,
            prompt_ids=_step_prompt_ids(figures),
        )
    else:
        result = await call_claude_json(
            _build_system_prompt(subject, figures),
            user_message,
            mode=llm_mode,
            tool_schema=_schema(figures),
            model=MODEL_REASON,
            max_tokens=8192,
            thinking_budget=2000,
            user_id=user_id,
            generation_job_id=generation_job_id,
            prompt_ids=_step_prompt_ids(figures),
        )

    steps, final_answer, answer_type = _parse_decomposition(result)
    if not steps:
        raise RuntimeError("Empty steps returned from decomposition")
    if not final_answer:
        raise RuntimeError("No final_answer returned from decomposition")

    decomposition = Decomposition(
        problem=problem,
        steps=steps,
        final_answer=final_answer,
        problem_type=problem_type,
        answer_type=answer_type,
    )
    logger.info(
        "Decomposition succeeded for %s",
        problem,
        extra={"problem_type": problem_type, "num_steps": len(steps)},
    )

    # Cache non-personalized decompositions for reuse
    if not work_diagnosis:
        _cache_set(cache_key, decomposition)

    return decomposition
