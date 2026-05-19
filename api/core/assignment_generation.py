"""AI-powered assignment generation — create questions and solve them."""

import asyncio
import logging
from typing import Any

from api.core.document_vision import build_vision_content
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import GENERATE_QUESTIONS_SCHEMA
from api.core.step_decomposition import decompose_problem
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)


# ── Question generation ──

_GENERATE_QUESTIONS_TEMPLATE = """\
You are a {professor_role}.

The teacher will review and approve each problem before it reaches their
students; the bar is "would the teacher write this themselves" — not
AI-flavored filler.

# Sources of truth, in priority order

1. The teacher's instructions in the message — the active intent. What
   they want, what they don't, the angle. Lead from this.
2. The reference materials they've attached — notation, grade level,
   vocabulary, what their students have already seen. Match what's shown.
3. The unit name — the topic scope.

When a higher-priority source is silent, defer to the next one down.
When they pull against each other, the higher one wins.

# Output

- Generate exactly the requested number of problems
- Each problem is self-contained
- LaTeX with $ delimiters; single backslashes for commands
- Problem text only — no answers, no hints

# Difficulty calibration

Label each problem easy / medium / hard relative to THIS course's
student level — NOT absolute math/science difficulty:
- easy: direct application of one technique with clean numbers.
  Would appear in the first few practice problems of this unit.
- medium: chains two techniques OR requires choosing the right
  approach from several options. Mid-textbook practice.
- hard: synthesis, unusual setup, or a non-obvious step. Tough but
  solvable with practice for THIS course."""


def _build_question_generation_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _GENERATE_QUESTIONS_TEMPLATE.format(
        professor_role=cfg["professor_role"],
    )


# Translation tables for the Customize section's structured params.
# Each non-default value becomes a single bullet in the user message;
# defaults (mixed/auto/either/frq) emit nothing so the unchanged
# 1-click flow produces a prompt byte-identical to before.
_PROBLEM_TYPE_INSTRUCTIONS = {
    "word": "Generate only word problems with real-world contexts.",
    "computation": "Generate only pure computational problems.",
    "multi_step": "Each problem must involve multiple steps or chained techniques.",
    "proof": "Each problem must be a proof requiring justified reasoning at each step.",
}
_ANSWER_FORM_INSTRUCTIONS = {
    "radical": "Express all final answers in radical form (no decimal approximations).",
    "rational_exponent": "Express all final answers in rational-exponent form.",
    "exact": "All final answers must be exact — no decimal approximations.",
    "decimal_2": "Express final answers as decimals to 2 significant figures.",
    "decimal_3": "Express final answers as decimals to 3 significant figures.",
}
_DIFFICULTY_INSTRUCTIONS = {
    "easy": "Generate all problems at the EASY level per the difficulty calibration above.",
    "medium": "Generate all problems at the MEDIUM level per the difficulty calibration above.",
    "hard": "Generate all problems at the HARD level per the difficulty calibration above.",
    "ramp": (
        "Order problems by difficulty: roughly first third easy, middle "
        "third medium, last third hard. For fewer than 3 problems, "
        "distribute as evenly as possible."
    ),
}
_CALCULATOR_INSTRUCTIONS = {
    "no_calc": (
        "No-calculator problems: keep all numerics clean (standard angles "
        "like π/4, integer evaluations, simple fractions). Do not require "
        "multi-digit decimal arithmetic."
    ),
    "calc_allowed": (
        "Calculator-allowed: irregular numerics, transcendental "
        "evaluations, and multi-digit decimal arithmetic are fine."
    ),
}
_FORMAT_INSTRUCTIONS = {
    "mcq": (
        "These problems will be served as multiple choice. Each problem "
        "should have one clear correct answer that's distinct from common "
        "student misconceptions. Distractors (3 plausible wrong answers) "
        "will be generated separately — do NOT include answer choices in "
        "the problem text itself."
    ),
}


def _translate_params_to_instructions(params: dict[str, Any] | None) -> list[str]:
    """Map the Customize-section param dict to prompt-instruction lines.

    Defaults (mixed/auto/either/frq) emit nothing. The order of the
    returned list mirrors the order the dropdowns appear in the
    modal — gives the model a predictable structure to read.
    """
    if not params:
        return []
    instructions: list[str] = []
    if (line := _PROBLEM_TYPE_INSTRUCTIONS.get(params.get("problem_type", ""))):
        instructions.append(line)
    if (line := _ANSWER_FORM_INSTRUCTIONS.get(params.get("answer_form", ""))):
        instructions.append(line)
    if (line := _DIFFICULTY_INSTRUCTIONS.get(params.get("difficulty", ""))):
        instructions.append(line)
    if (line := _CALCULATOR_INSTRUCTIONS.get(params.get("calculator", ""))):
        instructions.append(line)
    if (line := _FORMAT_INSTRUCTIONS.get(params.get("format", ""))):
        instructions.append(line)
    return instructions


async def generate_questions(
    unit_name: str,
    count: int,
    *,
    course_name: str = "",
    subject: str = Subject.MATH,
    user_id: str | None = None,
    images: list[dict[str, str]] | None = None,
    extra_instructions: str | None = None,
    params: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Generate problems for a given topic.

    Args:
        images: Optional list of {"filename", "base64", "media_type"} from
                fetch_document_images. When provided, Claude reads the actual
                document content — that's the priority-2 grounding (notation,
                grade level, what students have already seen).
        extra_instructions: Optional natural-language brief from the teacher
                ("only word problems", "no calculator", "skip trig"). This
                is the priority-1 source of truth — Claude leads from it.
        params: Optional dict of structured customizations from the
                Customize section of the generate modal (problem_type /
                answer_form / difficulty / calculator / format). Each
                non-default value is translated to a constraint bullet
                appended to the user message. See
                _translate_params_to_instructions.

    Returns list of {"title", "text", "difficulty"}. The model's
    auto-labeled difficulty (per the schema enum) flows downstream
    into BankItem.difficulty — load-bearing for the integrity
    agent's tier-aware probe selection (`integrity_pipeline.py`).
    """
    if count <= 0:
        return []

    system_prompt = _build_question_generation_prompt(subject)
    # Order the user message to match the prompt's priority hierarchy:
    # teacher's brief first (intent), structured constraints next, then
    # unit name + course + count.
    user_message_parts: list[str] = []
    if extra_instructions and extra_instructions.strip():
        user_message_parts.append(
            f"Teacher's instructions:\n{extra_instructions.strip()}"
        )
    param_lines = _translate_params_to_instructions(params)
    if param_lines:
        bullets = "\n".join(f"- {line}" for line in param_lines)
        user_message_parts.append(f"Constraints:\n{bullets}")
    user_message_parts.append(f"Topic: {unit_name}")
    if course_name:
        user_message_parts.append(f"Course: {course_name}")
    user_message_parts.append(f"Number of problems: {count}")
    user_message = "\n\n".join(user_message_parts)

    try:
        if images:
            # call_claude_vision doesn't accept a separate system
            # prompt — bake it into the user message so the priority
            # hierarchy still applies to vision-mode runs.
            content = build_vision_content(
                images, f"{system_prompt}\n\n{user_message}"
            )
            result = await call_claude_vision(
                content,
                mode=LLMMode.GENERATE_QUESTIONS,
                tool_schema=GENERATE_QUESTIONS_SCHEMA,
                user_id=user_id,
                model=MODEL_REASON,
                max_tokens=4096,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                user_message,
                mode=LLMMode.GENERATE_QUESTIONS,
                tool_schema=GENERATE_QUESTIONS_SCHEMA,
                user_id=user_id,
                model=MODEL_REASON,
                max_tokens=4096,
            )
        questions: list[Any] = result.get("questions", [])  # type: ignore[assignment]

        normalized = []
        for q in questions:
            if not isinstance(q, dict) or "text" not in q:
                continue
            normalized.append({
                "title": str(q.get("title") or "")[:120],
                "text": str(q["text"]),
                "difficulty": str(q.get("difficulty") or "medium"),
            })

        return normalized[:count]

    except Exception:
        logger.exception("Failed to generate questions")
        return []


# ── Solution generation (reuses decompose_problem) ──


async def generate_solutions(
    questions: list[dict[str, str]],
    *,
    subject: str = Subject.MATH,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """Generate step-by-step solutions for each question using decompose.

    Returns list of {"question_text", "steps": [...], "final_answer": "..."}.
    """
    if not questions:
        return []

    async def solve_one(q: dict[str, str]) -> dict[str, Any]:
        try:
            decomp = await decompose_problem(
                q["text"],
                user_id=user_id,
                subject=subject,
            )
            return {
                "question_text": q["text"],
                "steps": decomp.steps,
                "final_answer": decomp.final_answer,
            }
        except Exception:
            logger.warning("Failed to solve question: %s", q["text"][:80])
            return {
                "question_text": q["text"],
                "steps": [],
                "final_answer": "(solution failed — please solve manually)",
            }

    # Solve in parallel (max 5 concurrent to avoid rate limits)
    semaphore = asyncio.Semaphore(5)

    async def solve_with_limit(q: dict[str, str]) -> dict[str, Any]:
        async with semaphore:
            return await solve_one(q)

    solutions = await asyncio.gather(*[solve_with_limit(q) for q in questions])
    return list(solutions)
