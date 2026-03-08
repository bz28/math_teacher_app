"""Practice mode: generate similar problems and check answers."""

import logging

from api.core.tutor import _call_claude_json

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Problem generation
# ---------------------------------------------------------------------------

_GENERATE_PROBLEMS_PROMPT = """You are a math tutor generating practice problems.

Given an original math problem, generate similar problems with different
numbers and context but the same underlying math structure.

Respond with ONLY valid JSON:
{"problems": [{"question": "the problem text", "answer": "the correct answer"}]}

Rules:
- Each problem must be solvable with the same type of math as the original
- Vary the numbers, names, and context
- Answers must be correct
- Keep problems at the same difficulty level"""


async def generate_practice_problems(
    problem: str, count: int,
) -> list[dict[str, str]]:
    """Generate the original + count similar problems with answers.

    Returns list of {"question": ..., "answer": ...} dicts.
    """
    user_msg = (
        f"Original problem: {problem}\n\n"
        f"Generate {1 + count} problems total (include the original reworded, "
        f"plus {count} similar ones). Each must have a correct answer."
    )

    try:
        result = await _call_claude_json(
            _GENERATE_PROBLEMS_PROMPT,
            user_msg,
            mode="practice_generate",
        )
        problems = result.get("problems")
        if isinstance(problems, list):
            return [
                {"question": str(p.get("question", "")), "answer": str(p.get("answer", ""))}
                for p in problems
                if isinstance(p, dict)
            ]
    except Exception:
        logger.warning("Failed to generate problems via LLM, using fallback")

    # Fallback: return original only
    return [{"question": problem, "answer": ""}]


# ---------------------------------------------------------------------------
# Answer checking
# ---------------------------------------------------------------------------

_CHECK_ANSWER_PROMPT = """You are a strict math tutor checking a student's answer.

Determine if the student's answer is MATHEMATICALLY EQUIVALENT to the correct answer.
Allow differences in formatting or notation (e.g., "x=3" vs "x = 3", "6" vs "x = 6"),
but the answer must be completely correct.

Be STRICT:
- "35" does NOT match "35x^4" — the variable/exponent is missing
- Partial answers or answers missing terms are WRONG

Respond with ONLY valid JSON:
{"is_correct": true or false}"""


async def check_answer(
    question: str, correct_answer: str, user_answer: str,
) -> bool:
    """Check if user's answer matches the correct answer.

    Uses string match first, then LLM fallback.
    """
    user_clean = user_answer.strip()
    correct_clean = correct_answer.strip()

    # 1. Direct string match
    if user_clean == correct_clean:
        return True

    # 2. LLM check
    try:
        user_msg = (
            f"Problem: {question}\n"
            f"Correct answer: {correct_clean}\n"
            f"Student's answer: {user_clean}"
        )
        result = await _call_claude_json(
            _CHECK_ANSWER_PROMPT, user_msg, mode="practice_check",
        )
        return bool(result.get("is_correct", False))
    except Exception:
        return False
