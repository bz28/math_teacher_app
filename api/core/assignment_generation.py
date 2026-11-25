"""AI-powered assignment generation — create questions and solve them."""

import asyncio
import json
import logging
from typing import Any

from api.core.constants import SOLUTION_FAILED_SENTINEL
from api.core.construction_figures import CONSTRUCTION_FIGURE_RULES
from api.core.document_vision import build_vision_content
from api.core.geometry.fact_card import is_blank_card
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import GENERATE_QUESTIONS_CONSTRUCTION_SCHEMA
from api.core.prompts import load_prompt, load_prompt_map, prompt_ids_in
from api.core.step_decomposition import StepFigures, decompose_problem
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)


# ── Question generation ──

_GENERATE_QUESTIONS_TEMPLATE = load_prompt("assignment_generate_questions")


# When a generated problem gets a figure: Ben's when-to-draw rule
# (WHEN_TO_DRAW), then how such a problem is written (FACT_CARD_RULES).
# Code enforces one rule on top (question_bank_generation._lacks_figure): a
# problem the AI wrote a card or drafted a figure for, or whose text refers
# to a figure, ends with a checked figure, or is replaced once, or is left
# out with a note to the teacher.
# How a problem that gets a figure is written: as a fact card
# (api/core/geometry/fact_card.py). Code writes the problem's words from the
# card and checks the figure against the card, so nothing is read back from
# the AI's wording. Shared with the regenerate prompt (question_bank_generation).
FACT_CARD_RULES = load_prompt("figure_fact_card_rules")

# When a problem gets a figure (Ben, 2026-11-14; replaces the first
# "When to draw" paragraph). TODO(text auditor): a separate PR may let a
# real-world layout keep its story words once code can account for them;
# until then the SHOULD case is written as plain geometry with named points.
WHEN_TO_DRAW = load_prompt("figure_when_to_draw")

_CONSTRUCTION_FIGURES_SECTION = (
    '# Figures (diagrams)\n'
    '\n'
    + WHEN_TO_DRAW
    + '\n'
    + FACT_CARD_RULES
    + "\n"
)


# The prompt files a generation call is built from: the system prompt, its
# figure sections, and the Customize constraint lines in the user message.
_GENERATE_PROMPT_IDS = (
    "assignment_generate_questions", "figure_when_to_draw", "figure_fact_card_rules",
    "construction_figure_rules", "assignment_problem_type_instructions",
    "assignment_answer_form_instructions", "assignment_difficulty_instructions",
    "assignment_calculator_instructions", "assignment_format_instructions",
)


def _build_question_generation_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _GENERATE_QUESTIONS_TEMPLATE.format(professor_role=cfg["professor_role"]) + (
        _CONSTRUCTION_FIGURES_SECTION + CONSTRUCTION_FIGURE_RULES
    )


# Translation tables for the Customize section's structured params.
# Each non-default value becomes a single bullet in the user message;
# defaults (mixed/auto/either/frq) emit nothing so the unchanged
# 1-click flow produces a prompt byte-identical to before.
_PROBLEM_TYPE_INSTRUCTIONS: dict[str, str] = load_prompt_map("assignment_problem_type_instructions")
_ANSWER_FORM_INSTRUCTIONS: dict[str, str] = load_prompt_map("assignment_answer_form_instructions")
_DIFFICULTY_INSTRUCTIONS: dict[str, str] = load_prompt_map("assignment_difficulty_instructions")
_CALCULATOR_INSTRUCTIONS: dict[str, str] = load_prompt_map("assignment_calculator_instructions")
_FORMAT_INSTRUCTIONS: dict[str, str] = load_prompt_map("assignment_format_instructions")


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


# A set of problems that each carry a construction figure: about 150 tokens
# of text plus 300-500 of figure each, so 4096 cut an 8-problem set short.
_GENERATE_MAX_TOKENS = 16000
# Room to write all of them: output streams at about 70 tokens/s, so 16000
# tokens take about 230 s; the default 90 s would cut a full set off.
_GENERATE_TIMEOUT_S = 300.0


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
    # Callers pass product rules (practice single-answer, replacement) inside
    # the teacher's instructions; log their versions when they're present.
    prompt_ids = (*_GENERATE_PROMPT_IDS, *prompt_ids_in(
        extra_instructions or "", "practice_single_answer_rule", "bank_replacement_rule",
    ))
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
                max_tokens=_GENERATE_MAX_TOKENS,
                call_metadata=call_metadata,
                generation_job_id=generation_job_id,
                prompt_ids=prompt_ids,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                user_message,
                mode=LLMMode.GENERATE_QUESTIONS,
                tool_schema=schema,
                user_id=user_id,
                model=MODEL_REASON,
                max_tokens=_GENERATE_MAX_TOKENS,
                timeout=_GENERATE_TIMEOUT_S,
                call_metadata=call_metadata,
                generation_job_id=generation_job_id,
                prompt_ids=prompt_ids,
            )
        questions: list[Any] = result.get("questions", [])  # type: ignore[assignment]

        normalized = []
        for q in questions:
            card_given = q.get("figure_facts") is not None and not is_blank_card(q.get("figure_facts")) \
                if isinstance(q, dict) else False
            if not isinstance(q, dict) or ("text" not in q and not card_given):
                continue
            entry: dict[str, Any] = {
                "title": str(q.get("title") or "")[:120],
                "text": str(q.get("text") or ""),
                "difficulty": str(q.get("difficulty") or "medium"),
            }
            # Pass figure_spec through if the model emitted one. The
            # consumer (question_bank_generation) renders + stores it.
            # Keep the raw dict here; validation happens at render
            # time so we can degrade-gracefully on bad specs rather
            # than dropping the whole question.
            if isinstance(q.get("figure_spec"), dict):
                entry["figure_spec"] = q["figure_spec"]
            # The fact card, as the AI wrote it: read (and the text written
            # from it) by question_bank_generation.apply_card.
            if card_given:
                entry["figure_card"] = q["figure_facts"]
                entry["context"] = str(q.get("context") or "")
                entry["hint"] = str(q.get("hint") or "")
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
                # Sorted, so the prompt is the same however the spec's keys
                # arrived (a live call's order, or a stored one's).
                + json.dumps(q["figure_spec"], sort_keys=True)
            )
        # Step figures build on the problem's checked construction figure
        # (and are checked themselves by the caller); a problem without one
        # gets no step figures.
        spec = q.get("figure_spec")
        construction = isinstance(spec, dict) and spec.get("shape") == "construction"
        figures: StepFigures = "construction" if construction else "none"
        try:
            decomp = await decompose_problem(
                problem,
                user_id=user_id,
                subject=subject,
                generation_job_id=generation_job_id,
                figures=figures,
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
