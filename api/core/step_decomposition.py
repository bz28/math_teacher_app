"""Step-by-step decomposition: Claude generates steps, SymPy verifies final answer."""

import json
import logging
from dataclasses import dataclass

import anthropic
from anthropic.types import TextBlock

from api.config import settings
from api.core.math_engine import MathEngine, ParseError

logger = logging.getLogger(__name__)

MAX_RETRIES = 3

SYSTEM_PROMPT = """You are a math tutor generating step-by-step solutions for students.

Given a math problem, produce a JSON array of solution steps. Each step must have:
- "description": what the student should do (e.g., "Subtract 6 from both sides")
- "operation": the mathematical operation (e.g., "subtraction")
- "before": the expression/equation state before this step
- "after": the expression/equation state after this step

Rules:
- Each step should be ONE mathematical operation (don't combine multiple operations)
- Steps should be pedagogically ordered — the way a teacher would explain on a whiteboard
- The final step's "after" must be the simplified solution
- Use standard math notation (e.g., x^2 not x², use * for multiplication)
- For word problems, the first step should be "Translate to equation" with the equation in "after"

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


def _build_prompt(problem: str, problem_type: str, correct_answer: str | None = None) -> str:
    """Build the user prompt, optionally with few-shot examples and corrective feedback."""
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

    if correct_answer:
        parts.append(
            f"\nIMPORTANT: The correct final answer is {correct_answer}. "
            f"Your last step's 'after' field MUST match this answer."
        )

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


EXTRACTION_PROMPT = """You are a math tutor. Extract the math equation from this word problem.

Given a word problem, identify the underlying math equation and solve it.

Respond with ONLY valid JSON:
{
  "equation": "the equation using standard notation (e.g., d = 60 * 3)",
  "simplified_equation": "simplified form if different (e.g., d = 180)",
  "variable": "the variable being solved for (e.g., d)",
  "answer": "the numeric answer (e.g., 180)"
}

Use standard math notation: * for multiplication, / for division, ^ for exponents."""


async def _extract_equation(problem: str) -> dict[str, str]:
    """Call Claude to extract the math equation from a word problem."""
    client = anthropic.Anthropic(api_key=settings.claude_api_key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=256,
        system=EXTRACTION_PROMPT,
        messages=[{"role": "user", "content": f"Word problem: {problem}"}],
    )
    first_block = response.content[0]
    if not isinstance(first_block, TextBlock):
        raise ValueError("Unexpected response type from Claude")
    text = first_block.text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    result: dict[str, str] = json.loads(text)
    return result


async def _decompose_word_problem(problem: str) -> Decomposition:
    """Decompose a word problem: extract equation, then generate steps."""
    client = anthropic.Anthropic(api_key=settings.claude_api_key)

    last_error: str | None = None
    for attempt in range(MAX_RETRIES):
        try:
            # Step 1: Extract the equation
            extraction = await _extract_equation(problem)
            equation = extraction.get("equation", "")
            answer = extraction.get("answer", "")

            # Step 2: Verify with SymPy
            try:
                solutions = MathEngine.solve_problem(equation)
                correct_answer = str(solutions[0]) if solutions else answer
            except (ParseError, Exception):
                # Equation may not be directly solvable (e.g., d = 60*3)
                try:
                    result = MathEngine.evaluate_arithmetic(answer)
                    correct_answer = str(result)
                except Exception:
                    correct_answer = answer

            # Step 3: Generate step decomposition via Claude
            prompt = _build_prompt(problem, "word_problem", correct_answer=correct_answer)
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

            # Step 4: Verify final answer
            final_after = steps[-1].after
            if MathEngine.are_equivalent(final_after, correct_answer):
                decomposition = Decomposition(
                    problem=problem,
                    steps=steps,
                    final_answer=final_after,
                    problem_type="word_problem",
                )
                _cache_decomposition(decomposition)
                logger.info(
                    "Word problem decomposition succeeded on attempt %d",
                    attempt + 1,
                    extra={"problem": problem, "equation": equation},
                )
                return decomposition

            last_error = f"Final answer mismatch: got '{final_after}', expected '{correct_answer}'"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)

        except json.JSONDecodeError as e:
            last_error = f"JSON parse error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)
        except Exception as e:
            last_error = f"API error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)

    logger.error(
        "All %d attempts failed for word problem '%s'. Last error: %s. Using fallback.",
        MAX_RETRIES, problem, last_error,
    )
    return _fallback_word_problem(problem)


def _fallback_word_problem(problem: str) -> Decomposition:
    """Minimal fallback for word problems when retries are exhausted."""
    return Decomposition(
        problem=problem,
        steps=[
            Step("Set up the equation", "translate", problem, "equation"),
            Step("Solve for the answer", "solve", "equation", "answer"),
        ],
        final_answer="answer",
        problem_type="word_problem",
    )


async def decompose_problem(problem: str) -> Decomposition:
    """Generate step-by-step decomposition for a math problem.

    Claude generates steps, SymPy verifies the final answer.
    Retries with corrective feedback if the final answer doesn't match.
    """
    problem_type = MathEngine.classify_problem(problem)

    if problem_type == "word_problem":
        return await _decompose_word_problem(problem)

    solutions = MathEngine.solve_problem(problem)
    correct_answer = str(solutions[0]) if solutions else None

    client = anthropic.Anthropic(api_key=settings.claude_api_key)

    last_error: str | None = None
    for attempt in range(MAX_RETRIES):
        prompt = _build_prompt(
            problem,
            problem_type,
            correct_answer=correct_answer if attempt > 0 else None,
        )

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
            response_text = first_block.text
            steps = _parse_steps(response_text)

            if not steps:
                last_error = "Empty steps returned"
                continue

            # Verify final answer matches SymPy
            final_after = steps[-1].after
            if correct_answer and MathEngine.are_equivalent(final_after, correct_answer):
                decomposition = Decomposition(
                    problem=problem,
                    steps=steps,
                    final_answer=final_after,
                    problem_type=problem_type,
                )
                # Cache for few-shot examples
                _cache_decomposition(decomposition)

                logger.info(
                    "Decomposition succeeded on attempt %d for %s",
                    attempt + 1,
                    problem,
                    extra={"problem_type": problem_type, "num_steps": len(steps)},
                )
                return decomposition

            last_error = f"Final answer mismatch: got '{final_after}', expected '{correct_answer}'"
            logger.warning(
                "Attempt %d: %s",
                attempt + 1,
                last_error,
                extra={"problem": problem},
            )

        except json.JSONDecodeError as e:
            last_error = f"JSON parse error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)
        except Exception as e:
            last_error = f"API error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)

    # Fallback: simple 2-step decomposition
    logger.error(
        "All %d attempts failed for '%s'. Last error: %s. Using fallback.",
        MAX_RETRIES,
        problem,
        last_error,
    )
    return _fallback_decomposition(problem, correct_answer or "unknown", problem_type)


def _fallback_decomposition(problem: str, answer: str, problem_type: str) -> Decomposition:
    """Minimal fallback when Claude retries are exhausted."""
    return Decomposition(
        problem=problem,
        steps=[
            Step(description="Simplify the problem", operation="simplify", before=problem, after=answer),
        ],
        final_answer=answer,
        problem_type=problem_type,
    )


def _cache_decomposition(decomposition: Decomposition) -> None:
    """Cache a successful decomposition as a few-shot example."""
    key = decomposition.problem_type
    if key not in _few_shot_cache:
        _few_shot_cache[key] = []
    # Keep max 3 examples per type
    if len(_few_shot_cache[key]) >= 3:
        _few_shot_cache[key].pop(0)
    _few_shot_cache[key].append(decomposition)
