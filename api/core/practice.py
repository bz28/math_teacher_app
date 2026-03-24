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

Given an original math problem (and optionally the step-by-step approach used to
solve it), generate similar problems that test the SAME concepts and approach.

Respond with ONLY valid JSON:
{"problems": ["problem 1 text", "problem 2 text", ...]}

Rules:
- Each problem must be solvable with the same type of math and approach as the original
- The student should be able to apply the exact same steps to solve the new problems
- Do NOT repeat or rephrase the original problem — generate entirely new ones
- Vary the numbers, names, and context
- Keep problems at the same difficulty level
- Return ONLY the problem text — do NOT include answers"""


async def generate_practice_problems(
    problem: str,
    count: int,
    *,
    steps: list[dict[str, str]] | None = None,
    user_id: str | None = None,
) -> list[dict[str, str]]:
    """Generate the original + count similar problems with answers.

    When count=0, solves the original problem using step-by-step decomposition
    for accuracy, then returns the answer.
    When count>0, generates count new similar problems (excluding original),
    then verifies each answer via decompose_problem for accuracy.

    If steps are provided, the generation prompt includes the solving approach
    for better-targeted similar problems.

    Returns list of {"question": ..., "answer": ...} dicts.
    """
    if count == 0:
        decomposition = await decompose_problem(problem, user_id=user_id)
        return [{"question": problem, "answer": decomposition.final_answer}]

    # Step 1: Generate question text only (no answers — they'd be unreliable)
    parts = [f"Original problem: {problem}"]
    if steps:
        steps_text = "\n".join(
            f"  Step {i + 1}: {s['description']}" for i, s in enumerate(steps)
        )
        parts.append(f"\nApproach used:\n{steps_text}")
    parts.append(
        f"\nGenerate {count} similar problems (do not include the original)."
    )
    user_msg = "\n".join(parts)

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
