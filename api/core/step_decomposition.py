"""Step-by-step decomposition: Claude generates steps for any math problem."""

import logging
import re
from dataclasses import dataclass

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a worldclass math professor with expertise in breaking down "
    "math problems into easy to understand, coherent steps, making even the most "
    "complex problems trivial to understand to an elementary student.\n\n"

    "Before solving, consider if there is a simpler or faster approach than "
    "the obvious one. Prefer elegant shortcuts over mechanical procedures. "

    "Always use the first step as a breakdown of the problem in plain english, "
    "provide a generalization on how to approach the problem, "
    "including what to look out for. "
    "If the solution is not obvious or straightforward to an elementary student "
    "then explain how we knew to take this approach. "
    "Every step should have a clear transition/logic to it, make sure to have "
    "plain english to help the student understand the problem and solution better.\n\n"
    "Do NOT include any mention of approaches that are not the final/optimal "
    "solution. Those will only confuse the student.\n\n"

    "Given a math problem, produce a JSON object with:\n"
    '- "steps": an array of strings, each being a clear description of one step\n'
    '- "final_answer": the final simplified answer\n'
    '- "distractors": exactly 3 plausible but WRONG final answers (common student mistakes)\n\n'
    "Respond with ONLY valid JSON — no markdown, no explanation:\n"
    '{"steps": ["step 1", "step 2", ...], "final_answer": "...", '
    '"distractors": ["wrong1", "wrong2", "wrong3"]}'
)


@dataclass
class Decomposition:
    problem: str
    steps: list[str]
    final_answer: str
    problem_type: str
    distractors: list[str]


def _parse_decomposition(data: dict[str, object]) -> tuple[list[str], str, list[str]]:
    """Parse LLM JSON response into steps, final_answer, and distractors."""
    steps_data = data["steps"]
    final_answer = data.get("final_answer", "")
    distractors = data.get("distractors", [])

    if not isinstance(steps_data, list):
        raise ValueError("Expected 'steps' to be a list")

    steps = [str(s) for s in steps_data]
    return (
        steps,
        str(final_answer),
        list(distractors) if isinstance(distractors, list) else [],
    )


_MATH_FUNCTION_NAMES = {"sin", "cos", "tan", "log", "ln", "abs", "max", "min", "mod", "gcd", "lcm", "sqrt"}


def _is_word_problem(text: str) -> bool:
    """Detect whether text is a word problem vs pure math notation."""
    words = re.findall(r"[a-zA-Z]{3,}", text)
    return any(w.lower() not in _MATH_FUNCTION_NAMES for w in words)


SOLVE_SYSTEM_PROMPT = """You are a math tutor solving a problem.

Given a math problem, compute the final answer. Respond with ONLY valid JSON:
{"answer": "<the final simplified answer>", "problem_type": "word_problem" or "math"}

Rules:
- The answer must be the fully simplified final result
- Use standard math notation (e.g., x^2 not x², use * for multiplication)
- For equations, give the solution (e.g., "x = 3")
- For expressions, give the simplified form (e.g., "28x")
- Do NOT include any explanation, just the JSON"""


async def solve_problem(problem: str, *, user_id: str | None = None) -> tuple[str, str]:
    """Solve a math problem and return (final_answer, problem_type).

    Lighter-weight alternative to decompose_problem — no step breakdown,
    just the answer. Used for practice mode where steps aren't needed upfront.
    """
    data = await call_claude_json(
        SOLVE_SYSTEM_PROMPT,
        f"Problem: {problem}",
        mode=LLMMode.SOLVE,
        model=MODEL_REASON,
        max_tokens=256,
        user_id=user_id,
    )
    return str(data["answer"]), str(data.get("problem_type", "math"))


async def generate_similar_problem(
    problem: str,
    steps: list[dict[str, str]] | None = None,
    *,
    user_id: str | None = None,
) -> str:
    """Generate a similar math problem that uses the same solving approach."""
    system = (
        "You are a worldclass math professor with expertise in testing students on the same concepts using different problems."
        "Generate a similar math problem that would be solved using the SAME "
        "approach/method as the original. The student should be able to apply "
        "the exact same steps to solve the new problem.\n\n"
        "Respond with ONLY valid JSON:\n"
        '{"problem": "<the new problem text>"}'
    )
    parts = [f"Original problem: {problem}"]
    if steps:
        steps_text = "\n".join(
            f"  Step {i + 1}: {s['description']}" for i, s in enumerate(steps)
        )
        parts.append(f"\nApproach used:\n{steps_text}")
    parts.append("\nGenerate a new problem solvable with this same approach.")

    try:
        data = await call_claude_json(
            system,
            "\n".join(parts),
            mode=LLMMode.GENERATE_SIMILAR,
            model=MODEL_REASON,
            max_tokens=256,
            max_retries=1,
            user_id=user_id,
        )
        return str(data.get("problem", problem))
    except Exception as e:
        raise RuntimeError("Failed to generate similar problem") from e


async def decompose_problem(problem: str, *, user_id: str | None = None) -> Decomposition:
    """Generate step-by-step decomposition for a math problem."""
    problem_type = "word_problem" if _is_word_problem(problem) else "math"
    prompt = f"Problem: {problem}"

    data = await call_claude_json(
        SYSTEM_PROMPT,
        prompt,
        mode=LLMMode.DECOMPOSE,
        model=MODEL_REASON,
        max_tokens=1024,
        user_id=user_id,
    )

    steps, final_answer, distractors = _parse_decomposition(data)
    if not steps:
        raise RuntimeError("Empty steps returned from decomposition")
    if not final_answer:
        raise RuntimeError("No final_answer returned from decomposition")

    decomposition = Decomposition(
        problem=problem,
        steps=steps,
        final_answer=final_answer,
        problem_type=problem_type,
        distractors=distractors,
    )
    logger.info(
        "Decomposition succeeded for %s",
        problem,
        extra={"problem_type": problem_type, "num_steps": len(steps)},
    )
    return decomposition
