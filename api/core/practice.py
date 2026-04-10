"""Practice mode: generate similar problems and check answers."""

import asyncio
import logging

import anthropic

from api.core.llm_client import MODEL_HAIKU, MODEL_REASON, LLMMode, call_claude_json
from api.core.llm_schemas import DISTRACTOR_SCHEMA, PRACTICE_GENERATE_SCHEMA
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

"""


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
            tool_schema=DISTRACTOR_SCHEMA,
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
    problems: list[str] | str,
    count: int = 0,
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
    image_base64: str | None = None,
) -> list[dict[str, object]]:
    """Generate similar problems for one or more source problems.

    When a single problem string (or list of one) is passed with count=0,
    solves the original using step-by-step decomposition and returns the answer.

    When a list of problems is passed (or count>0 for legacy single-problem
    callers), sends all source problems in one batched Claude call — one
    generated similar problem per source — then solves each in parallel.

    Returns list of {"question": ..., "answer": ..., "distractors": [...]} dicts.
    """
    # Normalise: always work with a list internally
    if isinstance(problems, str):
        problems = [problems]

    # count=0 path: solve the single original problem (no generation)
    if count == 0 and len(problems) == 1:
        problem = problems[0]
        decomposition = await decompose_problem(
            problem, user_id=user_id, subject=subject, image_base64=image_base64,
        )
        distractors = await generate_distractors(
            problem, decomposition.final_answer, decomposition.answer_type,
            user_id=user_id, subject=subject,
        )
        return [{"question": problem, "answer": decomposition.final_answer, "distractors": distractors}]

    # Mini-batch cap: split into chunks of 5 to avoid token limits
    _BATCH_SIZE = 5
    if len(problems) > _BATCH_SIZE:
        results: list[dict[str, object]] = []
        for i in range(0, len(problems), _BATCH_SIZE):
            chunk = problems[i:i + _BATCH_SIZE]
            results.extend(await generate_practice_problems(
                chunk, count=0, user_id=user_id, subject=subject,
            ))
        return results

    # Build batched user message — numbered list, one similar per source
    has_diagram = any("[" in p for p in problems)
    if len(problems) == 1:
        # Legacy single-problem path (count > 0): generate `count` variations
        user_msg = f"{problems[0]}\n\nGenerate {count} similar problems (do not include the originals)."
    else:
        numbered = "\n\n".join(f"Problem {i + 1}: {p}" for i, p in enumerate(problems))
        user_msg = (
            f"{numbered}\n\n"
            f"Generate exactly 1 similar problem for each of the {len(problems)} problems above. "
            f"Return them in the same order as a list of {len(problems)} items."
        )

    if has_diagram:
        user_msg += (
            "\n\nIMPORTANT: Any problem that included a diagram requires a diagram in its "
            "generated version, using structured notation:\n"
            '- Chemistry: @@{"diagram_type": "smiles", "smiles": "SMILES_STRING", "label": "description"}@@\n'
            '- Math graphs: @@{"diagram_type": "graph", "functions": [...], "xRange": [...], "yRange": [...]}@@\n'
            "- Physics/other: use <svg> blocks"
        )

    expected_count = len(problems) if len(problems) > 1 else count
    try:
        result = await call_claude_json(
            _build_generate_prompt(subject),
            user_msg,
            mode=LLMMode.PRACTICE_GENERATE,
            tool_schema=PRACTICE_GENERATE_SCHEMA,
            user_id=user_id,
            model=MODEL_REASON if has_diagram else MODEL_HAIKU,
            max_tokens=4096 if has_diagram else min(1024 * len(problems), 4096),
        )
        raw_problems = result.get("problems")
        if not isinstance(raw_problems, list) or len(raw_problems) == 0:
            raise RuntimeError("No problems generated")

        questions = [str(p) for p in raw_problems if isinstance(p, str) and p.strip()]
        if not questions:
            raise RuntimeError("No valid questions generated")

        # If Claude returned fewer than expected, pad with source problems as fallback
        if len(questions) < expected_count and len(problems) > 1:
            logger.warning(
                "Batch generation returned %d problems, expected %d — padding with sources",
                len(questions), expected_count,
            )
            questions += problems[len(questions):]
    except (anthropic.APIError, anthropic.APITimeoutError, RuntimeError):
        logger.exception("Failed to generate practice problems")
        raise RuntimeError("Failed to generate practice problems")

    # Return question texts only — caller is responsible for solving asynchronously
    return [{"question": q, "answer": "", "distractors": []} for q in questions]


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
