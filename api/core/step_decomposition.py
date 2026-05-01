"""Step-by-step decomposition: Claude generates steps for any problem."""

import logging
import re
import time
from dataclasses import dataclass

from api.core.constants import DECOMPOSITION_CACHE_MAX_SIZE, DECOMPOSITION_CACHE_TTL_SECONDS
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import DECOMPOSITION_SCHEMA
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

    "A step is one conceptual move. If two adjacent steps make the same move, "
    "they're one step — merge them.\n\n"

    "Every sentence in a step's description teaches. Cut narration "
    "(\"now we'll multiply\"), problem restating, and previews of what's "
    "coming. Just the math and the why.\n\n"

    "Given a {domain} problem, solve it step-by-step.\n\n"
    "Each step needs a short title (2-5 words) and a full description. "
    "Titles answer \"what does this step do?\" — examples: "
    "\"Distribute the 3\", \"Substitute x = 5\". Not: \"Now we can solve\".\n"
    "Formatting rules for descriptions:\n"
    "- Do NOT use HTML tags like <br> — use plain newlines (\\n) for line breaks\n"
    "- Use LaTeX with $ delimiters for ALL math, even simple expressions like $2 \\times 3$ or $n = 5$\n"
    "- Use $$ delimiters for display math on its own line (e.g., $$\\frac{{a}}{{b}}$$)\n"
    "- Use **double asterisks** for emphasis on key terms\n"
    "- For matrices, use $\\begin{{pmatrix}}...\\end{{pmatrix}}$\n"
    "- For diagrams, use structured @@{{...}}@@ notation:\n"
    "  - Chemistry: @@{{\"diagram_type\": \"smiles\",\n"
    "    \"smiles\": \"SMILES_STRING\", \"label\": \"desc\"}}@@\n"
    "  - Math graphs: @@{{\"diagram_type\": \"graph\",\n"
    "    \"functions\": [{{\"fn\": \"x^2-4\"}}],\n"
    "    \"xRange\": [-5,5], \"yRange\": [-5,10]}}@@\n"
    "  - Physics/other: use <svg> blocks as before\n\n"
    "For answer_type, use \"diagram\" with @@{{...}}@@ notation for chemistry/graph answers."
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
    answer_type: str = "text"


_OVER_ESCAPED_MARKERS = (
    "\\\\begin", "\\\\end", "\\\\frac", "\\\\sqrt", "\\\\sum", "\\\\int",
    "\\\\alpha", "\\\\beta", "\\\\theta", "\\\\pi", "\\\\sigma", "\\\\phi",
    "\\\\mathbb", "\\\\mathbf", "\\\\left", "\\\\right",
)


def _normalize_latex(text: str) -> str:
    """Fix uniform over-escaping in LaTeX strings from the LLM.

    Claude sometimes returns `\\\\begin{...}` (double-escaped) instead of
    `\\begin{...}` because it treats the JSON tool schema as if it required
    JSON-encoded backslashes. When this happens, EVERY backslash is doubled
    uniformly (so `\\begin` → `\\\\begin` AND `\\\\` → `\\\\\\\\`). KaTeX
    fails because `\\\\begin` is not a valid command.

    Detection: if any known LaTeX command appears with double-backslash prefix
    (which is invalid LaTeX), assume uniform over-escaping and halve all
    backslash sequences.
    """
    if any(marker in text for marker in _OVER_ESCAPED_MARKERS):
        # Uniform over-escaping detected — halve all backslash pairs
        text = text.replace("\\\\", "\\")
    return text


def _ensure_math_delimiters(answer: str) -> str:
    """Wrap answer in $$...$$ if it contains LaTeX commands but no delimiters."""
    if not answer.strip():
        return answer
    # Already has delimiters
    if "$" in answer:
        return answer
    # Contains a backslash command — likely raw LaTeX without delimiters
    if "\\" in answer:
        return f"$${answer}$$"
    return answer


def _parse_decomposition(data: dict[str, object]) -> tuple[list[dict[str, str]], str, str]:
    """Parse LLM JSON response into steps, final_answer, and answer_type."""
    steps_data = data["steps"]
    final_answer = data.get("final_answer", "")
    answer_type = str(data.get("answer_type", "text"))

    if not isinstance(steps_data, list):
        raise ValueError("Expected 'steps' to be a list")

    steps: list[dict[str, str]] = []
    for s in steps_data:
        if isinstance(s, dict):
            title = _normalize_latex(str(s.get("title", "")))
            description = _normalize_latex(str(s.get("description", "")))
            steps.append({"title": title, "description": description})
        else:
            # Backward compat: plain string from older prompt format
            steps.append({"title": "", "description": _normalize_latex(str(s))})

    if answer_type not in ("text", "diagram"):
        answer_type = "text"

    final_answer_str = _normalize_latex(str(final_answer))
    final_answer_str = _ensure_math_delimiters(final_answer_str)

    return (
        steps,
        final_answer_str,
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
    user_message = f"Problem: {problem}"

    if work_diagnosis:
        import json
        diagnosis_text = json.dumps(work_diagnosis, indent=2)
        user_message += (
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
                "text": _build_system_prompt(subject) + "\n\n" + user_message,
            },
        ]
        result = await call_claude_vision(
            user_content,
            mode=llm_mode,
            tool_schema=DECOMPOSITION_SCHEMA,
            model=MODEL_REASON,
            max_tokens=8192,
            thinking_budget=2000,
            user_id=user_id,
        )
    else:
        result = await call_claude_json(
            _build_system_prompt(subject),
            user_message,
            mode=llm_mode,
            tool_schema=DECOMPOSITION_SCHEMA,
            model=MODEL_REASON,
            max_tokens=8192,
            thinking_budget=2000,
            user_id=user_id,
        )

    steps, final_answer, answer_type = _parse_decomposition(result)
    if not steps:
        raise RuntimeError("Empty steps returned from decomposition")
    if not final_answer:
        raise RuntimeError("No final_answer returned from decomposition")

    decomposition = Decomposition(
        problem=problem,
        steps=steps,
        final_answer=final_answer,
        problem_type=problem_type,
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
