"""Work diagnosis: analyze student handwritten work via Claude Vision."""

import logging
from typing import Any

from api.core.image_utils import validate_and_decode_image
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_vision
from api.core.llm_schemas import WORK_DIAGNOSIS_SCHEMA
from api.core.prompts import load_prompt
from api.core.subjects import Subject

logger = logging.getLogger(__name__)

DIAGNOSIS_PROMPT = load_prompt("work_diagnosis")


async def diagnose_work(
    image_base64: str,
    problem_text: str,
    steps: list[str],
    final_answer: str,
    user_answer: str,
    user_was_correct: bool,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> dict[str, Any]:
    """Analyze student's handwritten work against the optimal solution.

    Args:
        image_base64: Base64-encoded photo of student's work.
        problem_text: The problem.
        steps: Optimal solution steps from decompose_problem().
        final_answer: The correct final answer.
        user_answer: What the student typed as their answer.
        user_was_correct: Whether their typed answer was correct.
        session_id: For cost tracking.
        user_id: For cost tracking.
        subject: The subject (math, chemistry, etc.).

    Returns:
        Structured diagnosis dict with steps, summary, has_issues, overall_feedback.
    """
    _, media_type = validate_and_decode_image(image_base64)

    # Format steps for the prompt
    steps_text = "\n".join(f"  Step {i + 1}: {s}" for i, s in enumerate(steps))
    correctness = "correct" if user_was_correct else "incorrect"

    prompt = DIAGNOSIS_PROMPT.format(
        domain=subject,
        problem_text=problem_text,
        steps=steps_text,
        final_answer=final_answer,
        user_answer=user_answer,
        correctness=correctness,
    )

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
            "text": prompt,
        },
    ]

    result = await call_claude_vision(
        user_content,
        mode=LLMMode.DIAGNOSE_WORK,
        tool_schema=WORK_DIAGNOSIS_SCHEMA,
        session_id=session_id,
        user_id=user_id,
        model=MODEL_REASON,
        max_tokens=2048,
    )

    # Validate expected fields
    if not isinstance(result.get("steps"), list):
        raise RuntimeError("Invalid diagnosis result: missing steps array")
    if "summary" not in result:
        raise RuntimeError("Invalid diagnosis result: missing summary")

    return {
        "steps": result["steps"],
        "summary": str(result.get("summary", "")),
        "has_issues": bool(result.get("has_issues", False)),
        "overall_feedback": str(result.get("overall_feedback", "")),
    }
