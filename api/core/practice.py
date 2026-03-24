"""Practice mode: generate similar problems and check answers."""

import json
import logging

import anthropic

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json
from api.core.step_decomposition import decompose_problem
from api.core.tutor import check_answer_equivalence

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Problem generation
# ---------------------------------------------------------------------------

_GENERATE_PROBLEMS_PROMPT = """You are a math tutor generating practice problems.

Given one or more original math problems, generate similar problems with different
numbers and context but the same underlying math structure.

Respond with ONLY valid JSON:
{"problems": [{"question": "the problem text", "answer": "the correct answer"}]}

Rules:
- Each problem must be solvable with the same type of math as the originals
- Do NOT repeat or rephrase the original problems — generate entirely new ones
- If multiple original problems are given, generate at least 1 problem of each type
- Vary the numbers, names, and context
- Answers must be correct
- Keep problems at the same difficulty level"""


async def generate_practice_problems(
    problem: str, count: int, *, user_id: str | None = None,
) -> list[dict[str, str]]:
    """Generate the original + count similar problems with answers.

    When count=0, solves the original problem using step-by-step decomposition
    for accuracy, then returns the answer.
    When count>0, generates count new similar problems (excluding original).

    Returns list of {"question": ..., "answer": ...} dicts.
    """
    if count == 0:
        # Use decompose_problem for chain-of-thought reasoning — more accurate
        # than a simple "solve this" prompt. Steps are discarded here but could
        # be cached if the student later enters learn mode.
        decomposition = await decompose_problem(problem, user_id=user_id)
        return [{"question": problem, "answer": decomposition.final_answer}]

    user_msg = (
        f"Original problem: {problem}\n\n"
        f"Generate {count} similar problems (do not include the original). "
        f"Each must have a correct answer."
    )

    try:
        result = await call_claude_json(
            _GENERATE_PROBLEMS_PROMPT,
            user_msg,
            mode=LLMMode.PRACTICE_GENERATE,
            user_id=user_id,
            model=MODEL_REASON,
            max_tokens=2048,
        )
        problems = result.get("problems")
        if isinstance(problems, list):
            return [
                {"question": str(p.get("question", "")), "answer": str(p.get("answer", ""))}
                for p in problems
                if isinstance(p, dict)
            ]
    except (anthropic.APIError, anthropic.APITimeoutError, json.JSONDecodeError, RuntimeError):
        logger.exception("Failed to generate practice problems")

    raise RuntimeError("Failed to generate practice problems")


# ---------------------------------------------------------------------------
# Answer checking
# ---------------------------------------------------------------------------


async def check_answer(
    question: str,
    correct_answer: str,
    user_answer: str,
    *,
    session_id: str | None = None,
    user_id: str | None = None,
) -> bool:
    """Check if user's answer matches the correct answer.

    Uses string match first, then LLM fallback via shared check_answer_equivalence.
    """
    if user_answer.strip() == correct_answer.strip():
        return True
    return await check_answer_equivalence(
        question, correct_answer, user_answer,
        session_id=session_id, user_id=user_id,
    )
