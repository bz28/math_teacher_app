"""Practice mode: generate similar problems and check answers."""

import asyncio
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

_GENERATE_QUESTIONS_PROMPT = """You are a worldclass math professor generating practice problems.

Given one or more math problems, generate similar problems that test the SAME
concepts and require the SAME approach to solve.

Respond with ONLY valid JSON:
{"problems": ["problem 1 text", "problem 2 text", ...]}

Rules:
- Identify the concept and solving approach from the problem text alone
- Each generated problem must be solvable with the same method as its source
- Do NOT repeat or rephrase the originals — generate entirely new problems
- Vary the numbers, names, and context while keeping the same difficulty
- Return ONLY the problem text — do NOT include answers"""


async def generate_practice_problems(
    problem: str,
    count: int,
    *,
    user_id: str | None = None,
) -> list[dict[str, str]]:
    """Generate the original + count similar problems with answers.

    When count=0, solves the original problem using step-by-step decomposition
    for accuracy, then returns the answer.
    When count>0, generates count new similar problems (excluding original),
    then verifies each answer via decompose_problem for accuracy.

    Returns list of {"question": ..., "answer": ...} dicts.
    """
    if count == 0:
        decomposition = await decompose_problem(problem, user_id=user_id)
        return [{"question": problem, "answer": decomposition.final_answer}]

    # Generate question text only (no answers — they'd be unreliable)
    user_msg = f"{problem}\n\nGenerate {count} similar problems (do not include the originals)."

    try:
        result = await call_claude_json(
            _GENERATE_QUESTIONS_PROMPT,
            user_msg,
            mode=LLMMode.PRACTICE_GENERATE,
            user_id=user_id,
            model=MODEL_REASON,
            max_tokens=2048,
        )
        raw_problems = result.get("problems")
        if not isinstance(raw_problems, list) or len(raw_problems) == 0:
            raise RuntimeError("No problems generated")

        questions = [str(p) for p in raw_problems if isinstance(p, str) and p.strip()]
        if not questions:
            raise RuntimeError("No valid questions generated")
    except (anthropic.APIError, anthropic.APITimeoutError, json.JSONDecodeError, RuntimeError):
        logger.exception("Failed to generate practice problems")
        raise RuntimeError("Failed to generate practice problems")

    # Step 2: Solve each generated problem via decompose_problem for accuracy
    async def solve_one(q: str) -> dict[str, str] | None:
        try:
            decomp = await decompose_problem(q, user_id=user_id)
            return {"question": q, "answer": decomp.final_answer}
        except RuntimeError:
            logger.warning("Failed to solve generated problem: %s", q[:80])
            return None

    solved = await asyncio.gather(*[solve_one(q) for q in questions])
    problems = [p for p in solved if p is not None]

    if not problems:
        raise RuntimeError("Failed to generate practice problems")

    return problems


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
