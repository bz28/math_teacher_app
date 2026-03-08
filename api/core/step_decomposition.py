"""Step-by-step decomposition: Claude generates steps for any math problem."""

import json
import logging
import re
from dataclasses import dataclass

import anthropic
from anthropic.types import TextBlock

from api.config import settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3

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

Respond with ONLY valid JSON — no markdown, no explanation, just the array."""


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


# In-memory few-shot cache: problem_type → list of example decompositions
_few_shot_cache: dict[str, list[Decomposition]] = {}


def _build_prompt(problem: str, problem_type: str) -> str:
    """Build the user prompt, optionally with few-shot examples."""
    parts: list[str] = []

    # Include few-shot example if available
    examples = _few_shot_cache.get(problem_type, [])
    if examples:
        ex = examples[0]
        steps_json = json.dumps([
            {"description": s.description, "operation": s.operation, "before": s.before, "after": s.after}
            for s in ex.steps
        ], indent=2)
        parts.append(
            f"Here's how we broke down a similar problem:\n"
            f"Problem: {ex.problem}\n"
            f"Steps: {steps_json}\n"
            f"Now decompose this one:"
        )

    parts.append(f"Problem: {problem}")

    return "\n\n".join(parts)


def _parse_steps(response_text: str) -> list[Step]:
    """Parse Claude's JSON response into Step objects."""
    # Strip any markdown fencing
    text = response_text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    data = json.loads(text)
    return [
        Step(
            description=s["description"],
            operation=s["operation"],
            before=s["before"],
            after=s["after"],
        )
        for s in data
    ]


def _is_word_problem(text: str) -> bool:
    """Detect whether text is a word problem vs pure math notation."""
    return bool(re.search(r"[a-zA-Z]{2,}", text))


async def generate_similar_problem(problem: str) -> str:
    """Use Claude to generate a similar math problem with different numbers/context."""
    client = anthropic.Anthropic(api_key=settings.claude_api_key)
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            system=(
                "Generate a similar math problem with the same structure "
                "but different numbers and context. Respond with ONLY the new "
                "problem text, nothing else."
            ),
            messages=[{"role": "user", "content": f"Original problem: {problem}"}],
        )
        first_block = response.content[0]
        if isinstance(first_block, TextBlock):
            return first_block.text.strip()
    except Exception:
        logger.warning("Failed to generate similar problem, returning original")
    return problem


async def decompose_problem(problem: str) -> Decomposition:
    """Generate step-by-step decomposition for a math problem.

    Claude generates the steps directly. Retries only on JSON parse
    or API errors.
    """
    problem_type = "word_problem" if _is_word_problem(problem) else "math"

    client = anthropic.Anthropic(api_key=settings.claude_api_key)

    last_error: str | None = None
    for attempt in range(MAX_RETRIES):
        prompt = _build_prompt(problem, problem_type)

        try:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )

            first_block = response.content[0]
            if not isinstance(first_block, TextBlock):
                last_error = "Unexpected response type from Claude"
                continue
            steps = _parse_steps(first_block.text)

            if not steps:
                last_error = "Empty steps returned"
                continue

            decomposition = Decomposition(
                problem=problem,
                steps=steps,
                final_answer=steps[-1].after,
                problem_type=problem_type,
            )
            _cache_decomposition(decomposition)

            logger.info(
                "Decomposition succeeded on attempt %d for %s",
                attempt + 1,
                problem,
                extra={"problem_type": problem_type, "num_steps": len(steps)},
            )
            return decomposition

        except json.JSONDecodeError as e:
            last_error = f"JSON parse error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)
        except Exception as e:
            last_error = f"API error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)

    # All retries exhausted — this should be rare
    logger.error(
        "All %d attempts failed for '%s'. Last error: %s.",
        MAX_RETRIES,
        problem,
        last_error,
    )
    raise RuntimeError(f"Failed to decompose problem after {MAX_RETRIES} attempts: {last_error}")


def _cache_decomposition(decomposition: Decomposition) -> None:
    """Cache a successful decomposition as a few-shot example."""
    key = decomposition.problem_type
    if key not in _few_shot_cache:
        _few_shot_cache[key] = []
    # Keep max 3 examples per type
    if len(_few_shot_cache[key]) >= 3:
        _few_shot_cache[key].pop(0)
    _few_shot_cache[key].append(decomposition)
