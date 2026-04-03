"""Practice mode: generate similar problems and check answers."""

import asyncio
import json
import logging

import anthropic

from api.core.llm_client import MODEL_HAIKU, MODEL_REASON, LLMMode, call_claude_json
from api.core.step_decomposition import decompose_problem
from api.core.subjects import Subject, get_config
from api.core.tutor import check_answer_equivalence

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Problem generation
# ---------------------------------------------------------------------------

_GENERATE_QUESTIONS_TEMPLATE = """You are a {professor_role} generating practice problems.

Given one or more {problems_noun}, generate similar problems that test the SAME
concepts and require the SAME approach to solve.

Respond with ONLY valid JSON:
{{"problems": ["problem 1 text", "problem 2 text", ...]}}

Rules:
- Identify the concept and solving approach from the problem text alone
- Each generated problem must be solvable with the same method as its source
- Do NOT repeat or rephrase the originals — generate entirely new problems
- Vary the numbers, names, and context while keeping the same difficulty
- Return ONLY the problem text — do NOT include answers"""


def _build_generate_prompt(subject: str) -> str:
    cfg = get_config(subject)
    return _GENERATE_QUESTIONS_TEMPLATE.format(
        professor_role=cfg["professor_role"],
        problems_noun=cfg["problems_noun"],
    )


_DISTRACTOR_PROMPT = """\
You are a worldclass {professor_role} designing multiple choice test options.

Given a {domain} problem and its correct answer, generate exactly 3 plausible but WRONG answers.

Rules:
- Each distractor should target a common student mistake (sign errors, off-by-one, \
wrong formula, partial solution, etc.)
- Distractors must be clearly wrong but look reasonable to a student who made an error
- Use LaTeX $ delimiters for ALL math, even simple expressions
- If the correct answer contains @@{{"diagram_type": "smiles", ...}}@@, generate 3 WRONG \
SMILES structures using the same @@{{...}}@@ notation (wrong functional groups, wrong \
charges, wrong connectivity)
- If the correct answer contains @@{{"diagram_type": "graph", ...}}@@, generate 3 WRONG \
graph definitions (wrong functions, shifted curves, etc.)

Respond with ONLY valid JSON:
{{"distractors": ["wrong answer 1", "wrong answer 2", "wrong answer 3"]}}"""


async def generate_distractors(
    problem: str,
    final_answer: str,
    answer_type: str = "text",
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> list[str]:
    """Generate 3 plausible wrong answers for MC. Uses Haiku for text, Sonnet for diagrams."""
    cfg = get_config(subject)
    system_prompt = _DISTRACTOR_PROMPT.format(
        professor_role=cfg["professor_role"],
        domain=cfg["domain"],
    )
    user_msg = f"Problem: {problem}\nCorrect answer: {final_answer}"

    is_diagram = answer_type == "diagram"
    model = MODEL_REASON if is_diagram else MODEL_HAIKU
    max_tokens = 4096 if is_diagram else 1024

    try:
        result = await call_claude_json(
            system_prompt,
            user_msg,
            mode=LLMMode.PRACTICE_EVAL,
            user_id=user_id,
            model=model,
            max_tokens=max_tokens,
        )
        distractors = result.get("distractors", [])
        if isinstance(distractors, list) and len(distractors) >= 3:
            return [str(d) for d in distractors[:3]]
    except Exception:
        logger.warning("Failed to generate distractors for: %s", problem[:80])

    return []


async def generate_practice_problems(
    problem: str,
    count: int,
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
    image_base64: str | None = None,
) -> list[dict[str, object]]:
    """Generate the original + count similar problems with answers.

    When count=0, solves the original problem using step-by-step decomposition
    for accuracy, then returns the answer.
    When count>0, generates count new similar problems (excluding original),
    then verifies each answer via decompose_problem for accuracy.

    Returns list of {"question": ..., "answer": ...} dicts.
    """
    if count == 0:
        decomposition = await decompose_problem(
            problem, user_id=user_id, subject=subject, image_base64=image_base64,
        )
        distractors = await generate_distractors(
            problem, decomposition.final_answer, decomposition.answer_type,
            user_id=user_id, subject=subject,
        )
        return [{"question": problem, "answer": decomposition.final_answer, "distractors": distractors}]

    # Generate question text only (no answers — they'd be unreliable)
    has_diagram = "[" in problem
    user_msg = f"{problem}\n\nGenerate {count} similar problems (do not include the originals)."
    if has_diagram:
        user_msg += (
            "\n\nIMPORTANT: The original problem included a diagram. Each generated problem "
            "MUST include a diagram using structured notation:\n"
            '- Chemistry: @@{"diagram_type": "smiles", "smiles": "SMILES_STRING", "label": "description"}@@\n'
            '- Math graphs: @@{"diagram_type": "graph", "functions": [...], "xRange": [...], "yRange": [...]}@@\n'
            "- Physics/other: use <svg> blocks"
        )

    try:
        result = await call_claude_json(
            _build_generate_prompt(subject),
            user_msg,
            mode=LLMMode.PRACTICE_GENERATE,
            user_id=user_id,
            model=MODEL_REASON,
            max_tokens=4096 if has_diagram else 2048,
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
    async def solve_one(q: str) -> dict[str, object] | None:
        try:
            decomp = await decompose_problem(q, user_id=user_id, subject=subject)
            distractors = await generate_distractors(
                q, decomp.final_answer, decomp.answer_type,
                user_id=user_id, subject=subject,
            )
            return {"question": q, "answer": decomp.final_answer, "distractors": distractors}
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
    subject: str = Subject.MATH,
) -> bool:
    """Check if user's answer matches the correct answer.

    Uses string match first, then LLM fallback via shared check_answer_equivalence.
    """
    if user_answer.strip() == correct_answer.strip():
        return True
    return await check_answer_equivalence(
        question, correct_answer, user_answer,
        session_id=session_id, user_id=user_id, subject=subject,
    )
