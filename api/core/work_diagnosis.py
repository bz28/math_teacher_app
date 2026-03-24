"""Work diagnosis: analyze student handwritten work via Claude Vision."""

import base64
import logging
from typing import Any

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_vision

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB after decode

DIAGNOSIS_PROMPT = """You are analyzing a student's handwritten math work shown in the attached image.
Compare their work against the reference solution below.

Problem: {problem_text}
Reference solution (the optimal approach):
{steps}
Correct answer: {final_answer}
Student's typed answer: {user_answer} ({correctness})

The reference solution is the OPTIMAL approach. A student's method can be valid but
less optimal (e.g. more steps, brute force instead of an elegant shortcut). Flag this —
the student should know a better approach exists.

Set has_issues to true when ANY of these apply:
- The student made an actual error (arithmetic, sign, conceptual)
- The student jumped straight to the answer with no visible work and got lucky
- The student's method is mathematically unsound even if the answer is correct
- The student's method is valid but LESS OPTIMAL than the reference solution
  (less elegant, brute force, less generalizable, etc.)

Do NOT set has_issues to true when:
- The student's method is equally optimal or better than the reference — different
  is not wrong if it's equally efficient
- The student skipped some steps but all their VISIBLE steps are correct and show
  sound reasoning. More advanced students often do steps mentally — that is fine.
  Only flag skipped steps if the student appears to have guessed or shows no
  understanding of the intermediate work.

For the status field on each step, use:
- "correct" — student performed an equivalent step correctly, OR student clearly
  did this step mentally (skipped it but surrounding work shows understanding)
- "error" — student made a mistake
- "skipped" — student skipped this step AND shows no evidence of understanding it
  (jumped to answer, got lucky, no intermediate work visible)
- "suboptimal" — student did something valid but less efficient here
- "unclear" — student's work is illegible for this step

Look at the student's handwritten work in the image and for each reference step:
1. Did the student perform an equivalent step? Did they do it correctly?
2. If there's an error, what specifically went wrong?
3. If a step is missing but surrounding steps are correct, the student likely did it
   mentally — mark as "correct", not "skipped"
4. If their approach is valid but less optimal (less elegant, less generalizable, brute force), note this
5. If their work is illegible for a step, mark it as "unclear"

Return ONLY valid JSON:
{{"steps": [{{"step_description": "...", "status": "correct|error|skipped|suboptimal|unclear",
"student_work": "what they wrote", "feedback": "..."}}],
"summary": "One-line teaser for summary screen",
"has_issues": true/false,
"overall_feedback": "Brief overall assessment"}}"""


def _validate_image(image_base64: str) -> str:
    """Validate and detect media type of base64-encoded image. Returns media_type."""
    try:
        raw = base64.b64decode(image_base64)
    except Exception as err:
        raise ValueError("Invalid base64 image data") from err

    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large: {len(raw) / 1024 / 1024:.1f}MB (max 5MB)"
        )

    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    elif raw[:2] == b"\xff\xd8":
        return "image/jpeg"
    else:
        raise ValueError("Unsupported image format (only JPEG and PNG are accepted)")


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
) -> dict[str, Any]:
    """Analyze student's handwritten work against the optimal solution.

    Args:
        image_base64: Base64-encoded photo of student's work.
        problem_text: The math problem.
        steps: Optimal solution steps from decompose_problem().
        final_answer: The correct final answer.
        user_answer: What the student typed as their answer.
        user_was_correct: Whether their typed answer was correct.
        session_id: For cost tracking.
        user_id: For cost tracking.

    Returns:
        Structured diagnosis dict with steps, summary, has_issues, overall_feedback.
    """
    media_type = _validate_image(image_base64)

    # Format steps for the prompt
    steps_text = "\n".join(f"  Step {i + 1}: {s}" for i, s in enumerate(steps))
    correctness = "correct" if user_was_correct else "incorrect"

    prompt = DIAGNOSIS_PROMPT.format(
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
