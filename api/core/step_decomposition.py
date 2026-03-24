"""Step-by-step decomposition: Claude generates steps for any math problem."""

import logging
import re
import time
from dataclasses import dataclass

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory TTL cache for non-personalized decompositions
# ---------------------------------------------------------------------------

_CACHE_TTL_SECONDS = 30 * 60  # 30 minutes
_cache: dict[str, tuple[float, "Decomposition"]] = {}
_CACHE_MAX_SIZE = 200


def _cache_get(problem: str) -> "Decomposition | None":
    """Get a cached decomposition if it exists and hasn't expired."""
    entry = _cache.get(problem)
    if entry is None:
        return None
    ts, decomp = entry
    if time.monotonic() - ts > _CACHE_TTL_SECONDS:
        del _cache[problem]
        return None
    return decomp


def _cache_set(problem: str, decomp: "Decomposition") -> None:
    """Cache a decomposition result."""
    # Evict oldest entries if cache is full
    if len(_cache) >= _CACHE_MAX_SIZE:
        oldest_key = min(_cache, key=lambda k: _cache[k][0])
        del _cache[oldest_key]
    _cache[problem] = (time.monotonic(), decomp)

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



async def decompose_problem(
    problem: str,
    *,
    user_id: str | None = None,
    work_diagnosis: dict[str, object] | None = None,
) -> Decomposition:
    """Generate step-by-step decomposition for a math problem.

    If work_diagnosis is provided (from a prior work submission), the steps
    will be personalized to reference the student's specific mistakes.
    """
    # Return cached result for non-personalized calls
    if not work_diagnosis:
        cached = _cache_get(problem)
        if cached is not None:
            logger.info("Decomposition cache hit for %s", problem)
            return cached

    problem_type = "word_problem" if _is_word_problem(problem) else "math"
    prompt = f"Problem: {problem}"

    if work_diagnosis:
        import json
        diagnosis_text = json.dumps(work_diagnosis, indent=2)
        prompt += (
            "\n\nIMPORTANT: The student has already attempted this problem. "
            "Their work has been analyzed:\n"
            f"{diagnosis_text}\n\n"
            "When writing each step description, reference their specific mistakes where relevant.\n"
            "For steps they got right, acknowledge it briefly: \"You got this right —\" then explain the step.\n"
            "For steps where they made errors, address it directly: \"This is where your work diverged —\" "
            "then explain what they should have done and why their approach was wrong.\n"
            "For steps they skipped, note it: \"You skipped this step —\" then explain why it matters.\n"
            "If the student got the correct answer but with a suboptimal method, point out the more optimal "
            "approach and explain why it matters for harder problems.\n\n"
            "Keep the tone encouraging and constructive. The goal is to teach, not to criticize."
        )

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

    # Cache non-personalized decompositions for reuse
    if not work_diagnosis:
        _cache_set(problem, decomposition)

    return decomposition
