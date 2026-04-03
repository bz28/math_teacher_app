"""Step-by-step decomposition: Claude generates steps for any problem."""

import logging
import re
import time
from dataclasses import dataclass

from api.core.constants import DECOMPOSITION_CACHE_MAX_SIZE, DECOMPOSITION_CACHE_TTL_SECONDS
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.subjects import Subject, get_config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory TTL cache for non-personalized decompositions
# ---------------------------------------------------------------------------

_cache: dict[str, tuple[float, "Decomposition"]] = {}


def _cache_get(problem: str) -> "Decomposition | None":
    """Get a cached decomposition if it exists and hasn't expired."""
    entry = _cache.get(problem)
    if entry is None:
        return None
    ts, decomp = entry
    if time.monotonic() - ts > DECOMPOSITION_CACHE_TTL_SECONDS:
        del _cache[problem]
        return None
    return decomp


def _cache_set(problem: str, decomp: "Decomposition") -> None:
    """Cache a decomposition result."""
    # Evict oldest entry if cache is full (dict is insertion-ordered in Python 3.7+)
    if len(_cache) >= DECOMPOSITION_CACHE_MAX_SIZE:
        oldest_key = next(iter(_cache))
        del _cache[oldest_key]
    _cache[problem] = (time.monotonic(), decomp)

_SYSTEM_PROMPT_TEMPLATE = (
    "You are a {professor_role}.\n\n"

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

    "Given a {domain} problem, produce a JSON object with:\n"
    '- "steps": an array of objects. EACH step MUST be an object with exactly two keys:\n'
    '  - "title": a short 2-5 word heading (e.g., "Isolate the Variable")\n'
    '  - "description": the full explanation of the step.\n'
    "  Formatting rules for descriptions:\n"
    "  - Do NOT use HTML tags like <br> — use plain newlines (\\n) for line breaks\n"
    "  - Use LaTeX with $ delimiters for inline math (e.g., $x^2 + 1$)\n"
    "  - Use $$ delimiters for display math on its own line (e.g., $$\\frac{{a}}{{b}}$$)\n"
    "  - Use **double asterisks** for emphasis on key terms\n"
    "  - For matrices, use $\\begin{{pmatrix}}...\\end{{pmatrix}}$\n"
    "  - If a visual diagram would help the student (geometric shape, graph, coordinate plane,\n"
    "    molecular structure), include it as an <svg> block with viewBox.\n"
    "    Keep SVGs simple: lines, circles, rects, text labels. Max 300x300 viewBox.\n"
    "    IMPORTANT: Escape all quotes inside SVG attribute values as \\\" since this is JSON.\n"
    '  Do NOT use plain strings for steps — every step must be {{"title": "...", "description": "..."}}.\n'
    '- "final_answer": the final simplified answer\n'
    '- "distractors": exactly 3 plausible but WRONG final answers (common student mistakes)\n'
    '- "answer_type": "text" (default) or "diagram" if the answer is a visual drawing/structure\n'
    '  If answer_type is "diagram", final_answer and all distractors MUST be <svg> blocks.\n'
    '  Common diagram distractors: wrong charge states, wrong bonds, mirror images, missing components.\n\n'
    "Respond with ONLY valid JSON — no markdown, no explanation:\n"
    '{{"steps": [...], "final_answer": "...", "distractors": ["...", "...", "..."], "answer_type": "text"}}'
)


def _build_system_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _SYSTEM_PROMPT_TEMPLATE.format(
        professor_role=cfg["professor_role"],
        domain=cfg["domain"],
    )


@dataclass
class Decomposition:
    problem: str
    steps: list[dict[str, str]]
    final_answer: str
    problem_type: str
    distractors: list[str]
    answer_type: str = "text"


def _parse_decomposition(data: dict[str, object]) -> tuple[list[dict[str, str]], str, list[str], str]:
    """Parse LLM JSON response into steps, final_answer, distractors, and answer_type."""
    steps_data = data["steps"]
    final_answer = data.get("final_answer", "")
    distractors = data.get("distractors", [])
    answer_type = str(data.get("answer_type", "text"))

    if not isinstance(steps_data, list):
        raise ValueError("Expected 'steps' to be a list")

    steps: list[dict[str, str]] = []
    for s in steps_data:
        if isinstance(s, dict):
            steps.append({"title": str(s.get("title", "")), "description": str(s.get("description", ""))})
        else:
            # Backward compat: plain string from older prompt format
            steps.append({"title": "", "description": str(s)})

    if answer_type not in ("text", "diagram"):
        answer_type = "text"

    return (
        steps,
        str(final_answer),
        list(distractors) if isinstance(distractors, list) else [],
        answer_type,
    )


def _is_word_problem(text: str, subject: str = Subject.MATH) -> bool:
    """Detect whether text is a word problem vs pure notation."""
    cfg = get_config(subject)
    function_names: set[str] = cfg.get("function_names", set())  # type: ignore[assignment]
    words = re.findall(r"[a-zA-Z]{3,}", text)
    return any(w.lower() not in function_names for w in words)



async def decompose_problem(
    problem: str,
    *,
    user_id: str | None = None,
    work_diagnosis: dict[str, object] | None = None,
    subject: str = Subject.MATH,
    image_base64: str | None = None,
) -> Decomposition:
    """Generate step-by-step decomposition for a problem.

    If work_diagnosis is provided (from a prior work submission), the steps
    will be personalized to reference the student's specific mistakes.
    """
    cache_key = f"{subject}:{problem}"
    # Return cached result for non-personalized calls (image or not — the
    # decomposition depends on the problem text, not the image itself).
    if not work_diagnosis:
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info("Decomposition cache hit for %s", problem)
            return cached

    problem_type = "word_problem" if _is_word_problem(problem, subject) else subject
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

    llm_mode = LLMMode.DECOMPOSE_DIAGNOSIS if work_diagnosis else LLMMode.DECOMPOSE

    if image_base64:
        # Use Vision API when an image is attached
        from api.core.image_utils import validate_and_decode_image
        _, media_type = validate_and_decode_image(image_base64)
        user_content: list[dict[str, object]] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": image_base64,
                },
            },
            {
                "type": "text",
                "text": _build_system_prompt(subject) + "\n\n" + prompt,
            },
        ]
        data = await call_claude_vision(
            user_content,
            mode=llm_mode,
            model=MODEL_REASON,
            max_tokens=4096,
            user_id=user_id,
        )
    else:
        data = await call_claude_json(
            _build_system_prompt(subject),
            prompt,
            mode=llm_mode,
            model=MODEL_REASON,
            max_tokens=4096,
            user_id=user_id,
        )

    steps, final_answer, distractors, answer_type = _parse_decomposition(data)
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
        answer_type=answer_type,
    )
    logger.info(
        "Decomposition succeeded for %s",
        problem,
        extra={"problem_type": problem_type, "num_steps": len(steps)},
    )

    # Cache non-personalized decompositions for reuse
    if not work_diagnosis:
        _cache_set(cache_key, decomposition)

    return decomposition
