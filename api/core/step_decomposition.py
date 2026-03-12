"""Step-by-step decomposition: Claude generates steps for any math problem."""

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass

from anthropic.types import TextBlock

from api.core.llm_client import get_client

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


def _strip_markdown_fencing(text: str) -> str:
    """Strip markdown code fencing from LLM response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return text


def _parse_steps(response_text: str) -> tuple[list[Step], list[str]]:
    """Parse Claude's JSON response into Step objects and distractors."""
    text = _strip_markdown_fencing(response_text)

    data = json.loads(text)

    # Support both formats: {"steps": [...], "distractors": [...]} and bare [...]
    if isinstance(data, list):
        steps_data = data
        distractors = []
    else:
        steps_data = data["steps"]
        distractors = data.get("distractors", [])

    steps = [
        Step(
            description=s["description"],
            operation=s["operation"],
            before=s["before"],
            after=s["after"],
        )
        for s in steps_data
    ]
    return steps, distractors


def _is_word_problem(text: str) -> bool:
    """Detect whether text is a word problem vs pure math notation."""
    return bool(re.search(r"[a-zA-Z]{2,}", text))


SOLVE_SYSTEM_PROMPT = """You are a math tutor solving a problem.

Given a math problem, compute the final answer. Respond with ONLY valid JSON:
{"answer": "<the final simplified answer>", "problem_type": "word_problem" or "math"}

Rules:
- The answer must be the fully simplified final result
- Use standard math notation (e.g., x^2 not x², use * for multiplication)
- For equations, give the solution (e.g., "x = 3")
- For expressions, give the simplified form (e.g., "28x")
- Do NOT include any explanation, just the JSON"""


async def solve_problem(problem: str) -> tuple[str, str]:
    """Solve a math problem and return (final_answer, problem_type).

    Lighter-weight alternative to decompose_problem — no step breakdown,
    just the answer. Used for practice mode where steps aren't needed upfront.
    """
    client = get_client()
    model = "claude-sonnet-4-20250514"

    for attempt in range(MAX_RETRIES):
        start = time.monotonic()
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=256,
                system=SOLVE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": f"Problem: {problem}"}],
            )
            latency_ms = round((time.monotonic() - start) * 1000, 2)

            first_block = response.content[0]
            if not isinstance(first_block, TextBlock):
                continue
            resp_text = first_block.text.strip()
            text = _strip_markdown_fencing(resp_text)

            data = json.loads(text)
            answer = data["answer"]
            problem_type = data.get("problem_type", "math")

            _log_decomposition_call(
                model=model, function="solve",
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                latency_ms=latency_ms, success=True, retry_count=attempt,
                input_text=f"Problem: {problem}", output_text=resp_text,
            )
            logger.info("solve_problem succeeded on attempt %d", attempt + 1)
            return answer, problem_type

        except (json.JSONDecodeError, KeyError, Exception) as e:
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            logger.warning("solve_problem attempt %d failed: %s", attempt + 1, e)

    raise RuntimeError(f"Failed to solve problem after {MAX_RETRIES} attempts")


async def generate_similar_problem(problem: str) -> str:
    """Use Claude to generate a similar math problem with different numbers/context."""
    client = get_client()
    model = "claude-sonnet-4-20250514"
    start = time.monotonic()
    try:
        response = await client.messages.create(
            model=model,
            max_tokens=256,
            system=(
                "Generate a similar math problem with the same structure "
                "but different numbers and context. Respond with ONLY the new "
                "problem text, nothing else."
            ),
            messages=[{"role": "user", "content": f"Original problem: {problem}"}],
        )
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        first_block = response.content[0]
        resp_text = first_block.text if isinstance(first_block, TextBlock) else ""
        _log_decomposition_call(
            model=model, function="generate_similar",
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            latency_ms=latency_ms, success=True, retry_count=0,
            input_text=f"Original problem: {problem}", output_text=resp_text,
        )
        if isinstance(first_block, TextBlock):
            return first_block.text.strip()
    except Exception:
        latency_ms = round((time.monotonic() - start) * 1000, 2)
        logger.warning("Failed to generate similar problem, returning original")
    return problem


async def decompose_problem(problem: str) -> Decomposition:
    """Generate step-by-step decomposition for a math problem.

    Claude generates the steps directly. Retries only on JSON parse
    or API errors.
    """
    problem_type = "word_problem" if _is_word_problem(problem) else "math"

    client = get_client()

    model = "claude-sonnet-4-20250514"
    last_error: str | None = None
    for attempt in range(MAX_RETRIES):
        prompt = _build_prompt(problem, problem_type)
        start = time.monotonic()

        try:
            response = await client.messages.create(
                model=model,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            latency_ms = round((time.monotonic() - start) * 1000, 2)

            first_block = response.content[0]
            resp_text = first_block.text if isinstance(first_block, TextBlock) else ""
            if not isinstance(first_block, TextBlock):
                last_error = "Unexpected response type from Claude"
                _log_decomposition_call(
                    model=model, function="decompose",
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    latency_ms=latency_ms, success=False, retry_count=attempt,
                    input_text=prompt, output_text=resp_text,
                )
                continue
            steps, distractors = _parse_steps(first_block.text)

            if not steps:
                last_error = "Empty steps returned"
                _log_decomposition_call(
                    model=model, function="decompose",
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    latency_ms=latency_ms, success=False, retry_count=attempt,
                    input_text=prompt, output_text=resp_text,
                )
                continue

            _log_decomposition_call(
                model=model, function="decompose",
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                latency_ms=latency_ms, success=True, retry_count=attempt,
                input_text=prompt, output_text=resp_text,
            )

            decomposition = Decomposition(
                problem=problem,
                steps=steps,
                final_answer=steps[-1].after,
                problem_type=problem_type,
                distractors=distractors,
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
            latency_ms = round((time.monotonic() - start) * 1000, 2)
            last_error = f"JSON parse error: {e}"
            logger.warning("Attempt %d: %s", attempt + 1, last_error)
        except Exception as e:
            latency_ms = round((time.monotonic() - start) * 1000, 2)
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


def _log_decomposition_call(
    model: str,
    function: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: float,
    success: bool,
    retry_count: int,
    input_text: str | None = None,
    output_text: str | None = None,
) -> None:
    """Log a Claude call from step_decomposition to the llm_calls table."""
    from api.core.tutor import COST_PER_INPUT_TOKEN_SONNET, COST_PER_OUTPUT_TOKEN_SONNET, _persist_llm_call

    cost = (input_tokens * COST_PER_INPUT_TOKEN_SONNET) + (output_tokens * COST_PER_OUTPUT_TOKEN_SONNET)
    logger.info(
        "LLM call: function=%s model=%s tokens=%d+%d cost=$%.4f latency=%.0fms",
        function, model, input_tokens, output_tokens, cost, latency_ms,
    )
    try:
        asyncio.get_running_loop().create_task(
            _persist_llm_call(
                model=model, function=function,
                input_tokens=input_tokens, output_tokens=output_tokens,
                latency_ms=latency_ms, cost_usd=round(cost, 6),
                session_id=None, user_id=None,
                success=success, retry_count=retry_count,
                input_text=input_text, output_text=output_text,
            )
        )
    except RuntimeError:
        logger.warning("No running event loop — skipping LLM call persistence")


def _cache_decomposition(decomposition: Decomposition) -> None:
    """Cache a successful decomposition as a few-shot example."""
    key = decomposition.problem_type
    if key not in _few_shot_cache:
        _few_shot_cache[key] = []
    # Keep max 3 examples per type
    if len(_few_shot_cache[key]) >= 3:
        _few_shot_cache[key].pop(0)
    _few_shot_cache[key].append(decomposition)
