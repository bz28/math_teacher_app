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
You are a {professor_role} creating assignment questions for a teacher.

The teacher wants questions about a specific topic for their students.
Generate original problems that test understanding of the topic.

Rules:
- Generate exactly the requested number of questions
- Match the requested difficulty level (or mix if "mixed")
- Questions should be clear, unambiguous, and solvable
- Use LaTeX with $ delimiters for math expressions (e.g., $2x + 3 = 7$)
- Vary the question types: computation, word problems, conceptual
- Do NOT include answers — only the question text
- Each question should be self-contained (no "use the answer from Q1")"""


def _build_generate_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _GENERATE_QUESTIONS_TEMPLATE.format(
        professor_role=cfg["professor_role"],
    )


async def generate_questions(
    unit_name: str,
    difficulty: str,
    count: int,
    *,
    course_name: str = "",
    subject: str = Subject.MATH,
    user_id: str | None = None,
    images: list[dict[str, str]] | None = None,
    extra_instructions: str | None = None,
) -> list[dict[str, str]]:
    """Generate assignment questions for a given topic.

    Args:
        images: Optional list of {"filename", "base64", "media_type"} from
                fetch_document_images. When provided, Claude reads the actual
                document content to generate more relevant questions.
        extra_instructions: Optional natural-language constraint from the
                teacher (e.g. "only word problems", "skip trig"). Layered on
                top of the system prompt.

    Returns list of {"text": "...", "difficulty": "..."}.
    """
    if count <= 0:
        return []

    difficulty_instruction = (
        f"All questions should be {difficulty} difficulty."
        if difficulty != "mixed"
        else "Mix difficulties: roughly 20% easy, 50% medium, 30% hard."
    )

    system_prompt = _build_generate_prompt(subject)
    user_message = (
        f"Course: {course_name}\n"
        f"Topic: {unit_name}\n"
        f"Number of questions: {count}\n"
        f"{difficulty_instruction}"
    )
    if extra_instructions:
        user_message += f"\n\nAdditional teacher instructions:\n{extra_instructions.strip()}"

    if images:
        user_message = (
            f"{system_prompt}\n\n"
            "The teacher has attached documents from this unit. "
            "Read them carefully and generate questions based on the actual content, "
            "notation style, and difficulty level shown in the materials.\n\n"
            f"{user_message}"
        )

    try:
        if images:
            content = build_vision_content(images, user_message)
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
                "text": str(q["text"]),
                "difficulty": str(q.get("difficulty", difficulty)),
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
