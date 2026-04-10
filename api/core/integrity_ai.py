"""Real AI helpers for the integrity-checker pipeline.

Replaces the stubs from PR 1. Three functions:
- extract_student_work: Vision call to read the student's uploaded photo
- generate_questions: Sonnet call to create 2-3 targeted follow-ups
- score_answer: Sonnet call to evaluate whether the answer shows understanding
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.llm_client import (
    MODEL_REASON,
    LLMMode,
    call_claude_json,
    call_claude_vision,
)
from api.core.llm_schemas import (
    INTEGRITY_EXTRACT_SCHEMA,
    INTEGRITY_GENERATE_SCHEMA,
    INTEGRITY_SCORE_SCHEMA,
)
from api.models.assignment import Submission

logger = logging.getLogger(__name__)

# Below this confidence threshold the handwriting is considered
# unreadable and the problem is skipped (no questions generated).
UNREADABLE_THRESHOLD = 0.3


def _strip_data_url_prefix(data: str) -> tuple[str, str]:
    """Strip the data URL prefix and return (base64, media_type).

    Handles:
    - "data:image/png;base64,iVBOR..."  → ("iVBOR...", "image/png")
    - "iVBOR..." (raw base64, PNG)      → ("iVBOR...", "image/png")
    - "/9j/..." (raw base64, JPEG)      → ("/9j/...", "image/jpeg")
    """
    m = re.match(r"^data:(image/(?:png|jpeg|jpg));base64,", data)
    if m:
        media_type = m.group(1)
        if media_type == "image/jpg":
            media_type = "image/jpeg"
        return data[m.end():], media_type
    # Raw base64 — sniff by magic bytes
    if data.startswith("iVBOR"):
        return data, "image/png"
    return data, "image/jpeg"


# ── Extraction ──

_EXTRACT_SYSTEM = """\
You are a world-class math professor examining a student's handwritten homework submission. \
Your task is to extract the student's work steps from the image into structured data.

Rules:
- List every distinct step the student wrote, in order from top to bottom.
- For each step, provide both the LaTeX representation and a plain-English description.
- If the handwriting is illegible or the image is blurry, set confidence low (below 0.3).
- If you can read most of it but some parts are unclear, set confidence between 0.3 and 0.7.
- If everything is clear, set confidence above 0.7.
- Do NOT solve the problem yourself — only extract what the student actually wrote."""


async def extract_student_work(
    submission_id: uuid.UUID, db: AsyncSession,
) -> dict[str, Any]:
    """Call Claude Vision to extract the student's work steps from
    their uploaded homework photo."""
    image_data: str | None = (await db.execute(
        select(Submission.image_data).where(Submission.id == submission_id)
    )).scalar_one_or_none()

    if not image_data:
        logger.warning("extract_student_work: no image for submission %s", submission_id)
        return {"steps": [], "confidence": 0.0}

    base64_data, media_type = _strip_data_url_prefix(image_data)

    content: list[dict[str, Any]] = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64_data,
            },
        },
        {
            "type": "text",
            "text": (
                "Extract the student's handwritten work from this homework submission. "
                "List each step they wrote, in order."
            ),
        },
    ]

    result = await call_claude_vision(
        content,
        LLMMode.INTEGRITY_EXTRACT,
        tool_schema=INTEGRITY_EXTRACT_SCHEMA,
        model=MODEL_REASON,
        max_tokens=1024,
    )
    return result


# ── Question Generation ──

_GENERATE_SYSTEM = """\
You are a world-class professor who deeply cares about your students' learning. \
A student has submitted homework and you want to verify they understand their own work — \
not to catch cheaters, but because you genuinely want to know if they learned something.

Given the problem text and the student's extracted work steps, generate 2-3 short \
follow-up questions. These questions should:

1. Reference something SPECIFIC the student wrote (a particular step, operation, or choice).
2. Be answerable in 1-2 sentences by a student who actually did the work themselves.
3. NOT be answerable by a student who only copied the final answer.
4. Use grade-appropriate, friendly language — no trick questions.
5. NOT ask the student to re-derive or re-solve the problem.
6. Test understanding of WHY they did what they did, not just WHAT they did.

Good example: "You factored x² + 2x - 15 into (x+5)(x-3). How did you determine those two numbers?"
Bad example: "What is factoring?" (too generic, anyone could answer this)
Bad example: "Solve x² + 2x - 15 = 0." (re-derivation)"""


def _format_extraction(extraction: dict[str, Any]) -> str:
    """Format the extraction into a readable string for the prompt."""
    steps = extraction.get("steps", [])
    if not steps:
        return "No work steps were extracted."
    lines = []
    for s in steps:
        lines.append(f"Step {s.get('step_num', '?')}: {s.get('plain_english', '')} [{s.get('latex', '')}]")
    return "\n".join(lines)


async def generate_integrity_questions(
    problem_text: str, extraction: dict[str, Any],
) -> list[dict[str, str]]:
    """Call Claude Sonnet to generate 2-3 targeted follow-up questions."""
    user_msg = (
        f"Problem: {problem_text}\n\n"
        f"Student's work:\n{_format_extraction(extraction)}\n\n"
        "Generate 2-3 follow-up questions."
    )

    result = await call_claude_json(
        _GENERATE_SYSTEM,
        user_msg,
        LLMMode.INTEGRITY_GENERATE,
        tool_schema=INTEGRITY_GENERATE_SCHEMA,
        model=MODEL_REASON,
        max_tokens=1024,
    )
    questions: list[dict[str, str]] = result.get("questions", [])  # type: ignore[assignment]
    # Defensive: cap at 3 even if the model over-generates.
    return questions[:3]


# ── Answer Scoring ──

_SCORE_SYSTEM = """\
You are a world-class professor evaluating whether a student's answer to a follow-up \
question demonstrates genuine understanding of their own homework work.

You will receive:
- The question that was asked
- What a good answer should look like (expected_shape)
- Scoring guidance (rubric_hint)
- The student's original work steps (for context)
- The student's answer

Evaluate fairly:
- A short but correct answer is "good" — don't penalize brevity.
- A vague answer that could apply to any problem is "weak."
- An answer that contradicts their own work, is clearly made up, or shows no understanding is "bad."
- If the student's answer directly contradicts what they wrote in their work, flag "contradicts_own_work."
- If the answer is so generic it could be a textbook definition, flag "generic_textbook."
- If the answer is just restating the question or saying "I don't know" with filler, flag "vague."

Be fair and charitable. Students may express things imperfectly but still demonstrate understanding."""


async def score_answer(
    question: dict[str, Any],
    answer: str,
    extraction: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Call Claude Sonnet to score the student's answer."""
    extraction_text = _format_extraction(extraction) if extraction else "No extraction available."

    user_msg = (
        f"Question: {question.get('question_text', '')}\n"
        f"Expected answer shape: {question.get('expected_shape', '')}\n"
        f"Rubric hint: {question.get('rubric_hint', '')}\n\n"
        f"Student's original work:\n{extraction_text}\n\n"
        f"Student's answer: {answer}"
    )

    result = await call_claude_json(
        _SCORE_SYSTEM,
        user_msg,
        LLMMode.INTEGRITY_SCORE,
        tool_schema=INTEGRITY_SCORE_SCHEMA,
        model=MODEL_REASON,
        max_tokens=256,
    )
    return result
