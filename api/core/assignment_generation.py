"""AI-powered assignment generation — create questions and solve them."""

import asyncio
import json
import logging
from typing import Any

from api.core.constants import SOLUTION_FAILED_SENTINEL
from api.core.construction_figures import CONSTRUCTION_FIGURE_RULES
from api.core.document_vision import build_vision_content
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import GENERATE_QUESTIONS_CONSTRUCTION_SCHEMA
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
2. The reference materials they've attached — the topic, notation, grade
   level, vocabulary, and style of problem their students have already
   seen. Match what's shown, but write NEW problems: never copy a
   problem from these attached documents, and never lightly re-number
   one. (A reference question in the teacher's instructions is
   different — follow the instructions for it.)
3. The assignment's title — the topic, when it names one ("Parallel &
   Perpendicular Lines", "Exponent Rules"). Every problem stays on it.
   A title that names no topic ("HW 3", "Unit 1 Review", "test") says
   nothing; ignore it.
4. The unit name — the topic scope. Often just a number ("Unit 3").

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
  solvable with practice for THIS course.

"""


_CONSTRUCTION_FIGURES_SECTION = """\
# Figures (diagrams)

Some problems genuinely need a diagram to be understood — congruence and
similarity setups, parallel lines and transversals, angle relationships,
right-triangle trigonometry, circles with chords, tangents or inscribed
angles. Emit `figure_spec` for those, NOT for algebra, word problems, or
anything where the prose already carries the full picture. A problem
that says "in the figure below" MUST carry its figure_spec.

"""


def _build_question_generation_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _GENERATE_QUESTIONS_TEMPLATE.format(professor_role=cfg["professor_role"]) + (
        _CONSTRUCTION_FIGURES_SECTION + CONSTRUCTION_FIGURE_RULES
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
    # Unlike every other value here, this one constrains how the problem
    # is BUILT, not how a finished answer is written down: you cannot
    # express sqrt(2) as a whole number, you can only choose givens that
    # avoid it. Hence "design ... choose the given values".
    #
    # Two things this wording is carefully doing:
    #
    # 1. "integer ... negative, or zero". A model told "whole number"
    #    reads the US-curriculum sense {0,1,2,...} and will avoid
    #    negative answers — which quietly guts any unit where a negative
    #    solution IS the point (solving equations, integer operations).
    # 2. The escape hatch is "stay on topic and give the exact answer",
    #    NOT "write a different problem". The prompt already demands
    #    exactly N problems within the unit's scope, so inviting
    #    substitution pushes a radicals or trig unit toward off-topic
    #    output. Topic fidelity has to outrank clean numbers, and the
    #    teacher-facing tooltip promises exactly this behaviour.
    #
    # Note this does NOT prevent a wrong answer reaching a student:
    # generate_questions emits problem text only (see the template's
    # "no answers, no hints" and GENERATE_QUESTIONS_SCHEMA), and the
    # solver that does produce answers never sees these params. The
    # worst case here is a problem whose honest answer isn't an integer
    # — the teacher gets something they didn't ask for, not a lie.
    "integer": (
        "Design every problem so its final answer is an integer "
        "(positive, negative, or zero — no fractions, decimals, or "
        "radicals). Choose the given values so it works out exactly, "
        "and NEVER round or approximate to reach one. Staying on the "
        "unit's topic outranks this: if the topic cannot yield integer "
        "answers (irrational roots, most trigonometric values), keep "
        "the problem on-topic and let the answer be exact instead — do "
        "not substitute an unrelated problem to satisfy this."
    ),
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
    assignment_title: str | None = None,
    params: dict[str, Any] | None = None,
    call_metadata: dict[str, Any] | None = None,
    generation_job_id: str | None = None,
) -> list[dict[str, str]]:
    """Generate problems for a given topic.

    Args:
        images: Optional list of {"filename", "base64", "media_type"} from
                fetch_source_documents. When provided, Claude reads the actual
                document content — that's the priority-2 grounding (notation,
                grade level, what students have already seen).
        extra_instructions: Optional natural-language brief from the teacher
                ("only word problems", "no calculator", "skip trig"). This
                is the priority-1 source of truth — Claude leads from it.
        assignment_title: The homework or practice set the problems are
                for. Often the only place the topic is named — units are
                commonly just "Unit 3" — so it ranks above the unit name.
        params: Optional dict of structured customizations from the
                Customize section of the generate modal (problem_type /
                answer_form / difficulty / calculator / format). Each
                non-default value is translated to a constraint bullet
                appended to the user message. See
                _translate_params_to_instructions.
        call_metadata: Optional structured tags logged on the LLM call
                (e.g. attached-document provenance from
                build_attachment_metadata). Observability only — it is
                NOT part of the prompt or vision content, so passing it
                leaves the model's input byte-identical.

    Returns list of {"title", "text", "difficulty"}. The model's
    auto-labeled difficulty (per the schema enum) flows downstream
    into BankItem.difficulty — load-bearing for the integrity
    agent's tier-aware probe selection (`integrity_pipeline.py`).
    """
    if count <= 0:
        return []

    system_prompt = _build_question_generation_prompt(subject)
    schema = GENERATE_QUESTIONS_CONSTRUCTION_SCHEMA
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
    if assignment_title and assignment_title.strip():
        user_message_parts.append(f"Assignment title: {assignment_title.strip()}")
    user_message_parts.append(f"Unit: {unit_name}")
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
                tool_schema=schema,
                user_id=user_id,
                model=MODEL_REASON,
                max_tokens=4096,
                call_metadata=call_metadata,
                generation_job_id=generation_job_id,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                user_message,
                mode=LLMMode.GENERATE_QUESTIONS,
                tool_schema=schema,
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
            entry: dict[str, Any] = {
                "title": str(q.get("title") or "")[:120],
                "text": str(q["text"]),
                "difficulty": str(q.get("difficulty") or "medium"),
            }
            # Pass figure_spec through if the model emitted one. The
            # consumer (question_bank_generation) renders + stores it.
            # Keep the raw dict here; validation happens at render
            # time so we can degrade-gracefully on bad specs rather
            # than dropping the whole question.
            if isinstance(q.get("figure_spec"), dict):
                entry["figure_spec"] = q["figure_spec"]
            # The model that wrote the question says whether it asks for a
            # drawing (see GENERATE_QUESTIONS_SCHEMA); the consumer ORs it
            # with the regex classifier (combine_requires_drawing).
            if isinstance(q.get("requires_drawing"), bool):
                entry["requires_drawing"] = q["requires_drawing"]
            normalized.append(entry)

        return normalized[:count]

    except Exception:
        # Deliberately not swallowed. Returning [] here made every API
        # failure — an oversized request, a page-count rejection, a
        # timeout — indistinguishable from "the model returned nothing",
        # and the only caller then told the teacher to go rewrite her
        # instructions. The real cause reaches her via the job's
        # error_message instead.
        logger.exception("Failed to generate questions")
        raise


# ── Solution generation (reuses decompose_problem) ──


async def generate_solutions(
    questions: list[dict[str, Any]],
    *,
    subject: str = Subject.MATH,
    user_id: str | None = None,
    generation_job_id: str | None = None,
) -> list[dict[str, Any]]:
    """Generate step-by-step solutions for each question using decompose.

    Returns list of {"question_text", "steps": [...], "final_answer": "..."}.
    """
    if not questions:
        return []

    async def solve_one(q: dict[str, Any]) -> dict[str, Any]:
        problem = q["text"]
        # A drawn figure is part of the problem — a "find the hypotenuse
        # in the triangle below" carries its numbers only in the figure,
        # and text alone can't be solved (prod, 2026-10-18: three failed
        # attempts, then the "solution failed" sentinel).
        if isinstance(q.get("figure_spec"), dict):
            problem += (
                "\n\nThe figure drawn with this problem, as data — its labels "
                "and measurements are part of the problem:\n"
                + json.dumps(q["figure_spec"])
            )
        try:
            decomp = await decompose_problem(
                problem,
                user_id=user_id,
                subject=subject,
                generation_job_id=generation_job_id,
            )
            return {
                "question_text": q["text"],
                "steps": decomp.steps,
                "final_answer": decomp.final_answer,
            }
        except Exception:
            logger.exception("Failed to solve question: %s", q["text"][:80])
            return {
                "question_text": q["text"],
                "steps": [],
                "final_answer": SOLUTION_FAILED_SENTINEL,
            }

    # Solve in parallel (max 5 concurrent to avoid rate limits)
    semaphore = asyncio.Semaphore(5)

    async def solve_with_limit(q: dict[str, str]) -> dict[str, Any]:
        async with semaphore:
            return await solve_one(q)

    solutions = await asyncio.gather(*[solve_with_limit(q) for q in questions])
    return list(solutions)
