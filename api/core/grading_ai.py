"""AI grading — one text-only LLM call per submission.

Consumes the extraction from the integrity pipeline's Vision call
(work steps + final answers) and compares against the teacher's answer
key and rubric. Outputs a per-problem grade that pre-fills the
teacher's review page.

This call never reads the image — extraction already did that. The
grading prompt sees structured text only, which keeps it fast, cheap,
and separable from the extraction step.
"""

from __future__ import annotations

import logging
from typing import Any

from api.core.llm_client import (
    MODEL_REASON,
    LLMMode,
    call_claude_json,
)
from api.core.llm_schemas import AI_GRADING_SCHEMA

logger = logging.getLogger(__name__)

# Registered on LLMMode for cost-tracking / admin dashboard.
LLMMode.AI_GRADING = "ai_grading"  # type: ignore[attr-defined]

_GRADING_SYSTEM = """\
You are a world-class math professor grading a student's homework submission. \
You have the student's extracted work (what they wrote on paper, already converted \
to text by a separate extraction step) and the teacher's answer key.

Your job:
1. For each problem, compare the student's extracted final answer against the \
answer key.
2. Assign a grade: "full" (100%), "partial" (1-99%), or "zero" (0%).
3. For partial credit, set a specific percent and explain why.

Grading criteria:
{rubric_block}

Rules:
- Grade ONLY based on the student's extracted work — do not solve the problem yourself.
- If the student's answer matches the answer key exactly (or is mathematically equivalent), \
give full credit.
- If the student's approach is correct but they made an arithmetic or sign error, give \
partial credit.
- If no extracted answer exists for a problem (student skipped it), give zero.
- Keep reasoning concise (1-2 sentences per problem)."""


def _build_rubric_block(rubric: dict[str, Any] | None) -> str:
    if not rubric:
        return (
            "No rubric provided. Use default criteria:\n"
            "- Full credit: correct final answer\n"
            "- Partial credit: right approach but arithmetic/sign error\n"
            "- Zero: wrong answer or no attempt"
        )
    parts: list[str] = []
    if rubric.get("full_credit"):
        parts.append(f"- Full credit: {rubric['full_credit']}")
    if rubric.get("partial_credit"):
        parts.append(f"- Partial credit: {rubric['partial_credit']}")
    if rubric.get("common_mistakes"):
        parts.append(f"- Common mistakes to watch for: {rubric['common_mistakes']}")
    if rubric.get("notes"):
        parts.append(f"- Additional notes: {rubric['notes']}")
    return "\n".join(parts) if parts else "No specific criteria. Use your best judgment."


def _build_user_message(
    extraction: dict[str, Any],
    problems: list[dict[str, Any]],
) -> str:
    lines: list[str] = []

    lines.append("## Student's extracted work\n")
    final_answers = extraction.get("final_answers", [])
    if final_answers:
        for fa in final_answers:
            lines.append(
                f"Problem {fa['problem_position']}: "
                f"{fa.get('answer_latex', fa.get('answer_plain', '(no answer)'))}"
            )
    else:
        lines.append("(No per-problem answers extracted — only work steps available)")

    steps = extraction.get("steps", [])
    if steps:
        lines.append("\n## Work steps (for context)\n")
        for s in steps:
            lines.append(f"Step {s['step_num']}: {s.get('latex', '')} — {s.get('plain_english', '')}")

    lines.append("\n## Problems + Answer Key\n")
    for p in problems:
        lines.append(
            f"Problem {p['position']}: {p['question']}\n"
            f"  Answer key: {p.get('final_answer', '(no answer key)')}"
        )

    return "\n".join(lines)


async def grade_submission_with_ai(
    extraction: dict[str, Any],
    problems: list[dict[str, Any]],
    rubric: dict[str, Any] | None,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Grade a submission using the already-extracted student work.

    Args:
        extraction: Output of extract_student_work() — contains steps
            and final_answers.
        problems: List of dicts with {position, question, final_answer}
            from the HW's bank items.
        rubric: Teacher's rubric from Assignment.rubric (optional).
        user_id: For cost-tracking attribution.

    Returns:
        {"grades": [{problem_position, student_answer, score_status,
                      percent, reasoning}]}
    """
    system = _GRADING_SYSTEM.format(
        rubric_block=_build_rubric_block(rubric),
    )
    user_message = _build_user_message(extraction, problems)

    result = await call_claude_json(
        system,
        user_message,
        LLMMode.AI_GRADING,
        tool_schema=AI_GRADING_SCHEMA,
        model=MODEL_REASON,
        max_tokens=1024,
        user_id=user_id,
    )
    return result
