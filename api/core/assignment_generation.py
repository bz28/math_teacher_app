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
- Problem text only — no answers, no hints"""


def _build_generate_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _GENERATE_QUESTIONS_TEMPLATE.format(
        professor_role=cfg["professor_role"],
    )


async def generate_questions(
    unit_name: str,
    count: int,
    *,
    course_name: str = "",
    subject: str = Subject.MATH,
    user_id: str | None = None,
    images: list[dict[str, str]] | None = None,
    extra_instructions: str | None = None,
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

    Returns list of {"title", "text"}. The bank-item layer assigns
    its own difficulty default downstream; we don't double up here.
    """
    if count <= 0:
        return []

    system_prompt = _build_generate_prompt(subject)
    # Order the user message to match the prompt's priority hierarchy:
    # teacher's brief first (intent), unit name and count next (scope).
    user_message_parts: list[str] = []
    if extra_instructions and extra_instructions.strip():
        user_message_parts.append(
            f"Teacher's instructions:\n{extra_instructions.strip()}"
        )
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
