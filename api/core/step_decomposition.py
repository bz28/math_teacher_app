"""Step-by-step decomposition: LLM generates steps for any math problem."""

import logging
import re
from dataclasses import dataclass

from api.core.llm_client import MODEL_REASON, LLMMode, call_openai_json

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a math tutor generating step-by-step solutions for students.

Given a math problem, produce a JSON array of solution steps. Each step must have:
- "description": a SPECIFIC instruction telling the student exactly what to do, including the actual
  numbers/terms involved (e.g., "Subtract 6 from both sides", "Divide both sides by 3",
  "Apply the power rule to 14x^2: bring down the exponent and reduce by 1 to get 28x").
  NEVER use vague words like "Evaluate", "Simplify", or "Calculate" alone.
- "operation": the mathematical operation (e.g., "subtraction", "division", "power rule")
- "before": the full expression/equation state before this step (must be valid math, e.g., "3x + 6 = 18")
- "after": the full expression/equation state after this step (must be valid math, e.g., "3x = 12")

Rules:
- Each step should be ONE mathematical operation (don't combine multiple operations)
- Steps should be pedagogically ordered — the way a teacher would explain on a whiteboard
- The "before" and "after" fields must ALWAYS contain complete mathematical expressions
  or equations, never words like "equation" or "answer"
- The final step's "after" must be the simplified solution
- Use standard math notation (e.g., x^2 not x², use * for multiplication)
- For word problems, the first step should translate to an equation: description says what
  variables represent, "before" is the word problem summary, "after" is the equation
- Only include steps that directly answer the problem — stop once you reach the answer.
  Do NOT add extra steps (factoring, rearranging, verifying) unless the problem asks for it.
- Every step must make meaningful progress toward the answer. If a step makes the expression
  more complex (e.g., introducing fractions where there were none), it is probably wrong.

Also include a top-level "distractors" array with exactly 3 plausible but WRONG final answers.
Distractors should reflect common student mistakes (sign errors, arithmetic mistakes, forgetting a term).

Respond with ONLY valid JSON in this format — no markdown, no explanation:
{"steps": [<step objects>], "distractors": ["wrong1", "wrong2", "wrong3"]}"""


@dataclass
class Step:
    description: str
    operation: str
    before: str
    after: str


@dataclass
class Decomposition:
    problem: str
    steps: list[Step]
    final_answer: str
    problem_type: str
    distractors: list[str]


def _parse_steps(data: dict[str, object]) -> tuple[list[Step], list[str]]:
    """Parse LLM JSON response into Step objects and distractors."""
    steps_data = data["steps"]
    distractors = data.get("distractors", [])

    if not isinstance(steps_data, list):
        raise ValueError("Expected 'steps' to be a list")

    steps = [
        Step(
            description=s["description"],
            operation=s["operation"],
            before=s["before"],
            after=s["after"],
        )
        for s in steps_data
    ]
    return steps, list(distractors) if isinstance(distractors, list) else []


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
    data = await call_openai_json(
        SOLVE_SYSTEM_PROMPT,
        f"Problem: {problem}",
        mode=LLMMode.SOLVE,
        model=MODEL_REASON,
        max_tokens=2048,
        user_id=user_id,
    )
    return str(data["answer"]), str(data.get("problem_type", "math"))


async def generate_similar_problem(problem: str, *, user_id: str | None = None) -> str:
    """Generate a similar math problem with different numbers/context."""
    system = (
        "Generate a similar math problem with the same structure "
        "but different numbers and context. Respond with ONLY valid JSON:\n"
        '{"problem": "<the new problem text>"}'
    )
    try:
        data = await call_openai_json(
            system,
            f"Original problem: {problem}",
            mode=LLMMode.GENERATE_SIMILAR,
            model=MODEL_REASON,
            max_tokens=2048,
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

    data = await call_openai_json(
        SYSTEM_PROMPT,
        prompt,
        mode=LLMMode.DECOMPOSE,
        model=MODEL_REASON,
        max_tokens=4096,
        user_id=user_id,
    )

    steps, distractors = _parse_steps(data)
    if not steps:
        raise RuntimeError("Empty steps returned from decomposition")

    decomposition = Decomposition(
        problem=problem,
        steps=steps,
        final_answer=steps[-1].after,
        problem_type=problem_type,
        distractors=distractors,
    )
    logger.info(
        "Decomposition succeeded for %s",
        problem,
        extra={"problem_type": problem_type, "num_steps": len(steps)},
    )
    return decomposition
