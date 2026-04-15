"""Practice mode: generate similar problems and check answers."""

import logging

import anthropic

from api.core.llm_client import MODEL_HAIKU, MODEL_REASON, LLMMode, call_claude_json
from api.core.llm_schemas import DISTRACTOR_SCHEMA, PRACTICE_GENERATE_SCHEMA
from api.core.step_decomposition import decompose_problem
from api.core.subjects import Subject, get_config
from api.core.tutor import check_answer_equivalence

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Distractor generation
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Solve a single problem (decompose + distractors)
# ---------------------------------------------------------------------------

async def solve_problem(
    problem: str,
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
    image_base64: str | None = None,
) -> dict[str, object]:
    """Solve a single problem: decompose into steps, extract answer, generate distractors.

    Returns {"question": ..., "answer": ..., "distractors": [...]}.
    """
    decomposition = await decompose_problem(
        problem, user_id=user_id, subject=subject, image_base64=image_base64,
    )
    distractors = await generate_distractors(
        problem, decomposition.final_answer, decomposition.answer_type,
        user_id=user_id, subject=subject,
    )
    return {
        "question": problem,
        "answer": decomposition.final_answer,
        "distractors": distractors,
    }


# ---------------------------------------------------------------------------
# Generate similar question texts (batch, no solving)
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


_DIFFICULTY_INSTRUCTIONS: dict[str, str] = {
    "easier": (
        "Make the generated problems EASIER than the originals — "
        "use simpler numbers, fewer steps, and more straightforward setups."
    ),
    "harder": (
        "Make the generated problems HARDER than the originals — "
        "use more complex numbers, more steps, edge cases, or require deeper insight."
    ),
}


async def generate_similar_questions(
    problems: list[str],
    *,
    user_id: str | None = None,
    subject: str = Subject.MATH,
    difficulty: str = "same",
) -> list[str]:
    """Generate one similar question text per source problem (batch, Haiku).

    Sends all source problems in a single Claude call and returns the generated
    question texts in the same order. Does NOT solve or add answers — that is
    handled separately by solve_problem().

    Returns a list of question text strings.
    """
    # Mini-batch cap: split into chunks of 5 to avoid token limits
    batch_size = 5
    if len(problems) > batch_size:
        results: list[str] = []
        for i in range(0, len(problems), batch_size):
            chunk = problems[i:i + batch_size]
            results.extend(
                await generate_similar_questions(chunk, user_id=user_id, subject=subject, difficulty=difficulty)
            )
        return results

    has_diagram = any("[" in p for p in problems)

    if len(problems) == 1:
        user_msg = f"{problems[0]}\n\nGenerate 1 similar problem (do not include the original)."
    else:
        numbered = "\n\n".join(f"Problem {i + 1}: {p}" for i, p in enumerate(problems))
        user_msg = (
            f"{numbered}\n\n"
            f"Generate exactly 1 similar problem for each of the {len(problems)} problems above. "
            f"Return them in the same order as a list of {len(problems)} items."
        )

    if difficulty in _DIFFICULTY_INSTRUCTIONS:
        user_msg += f"\n\nDifficulty instruction: {_DIFFICULTY_INSTRUCTIONS[difficulty]}"

    if has_diagram:
        user_msg += (
            "\n\nIMPORTANT: Any problem that included a diagram requires a diagram in its "
            "generated version, using structured notation:\n"
            '- Chemistry: @@{"diagram_type": "smiles", "smiles": "SMILES_STRING", "label": "description"}@@\n'
            '- Math graphs: @@{"diagram_type": "graph", "functions": [...], "xRange": [...], "yRange": [...]}@@\n'
            "- Physics/other: use <svg> blocks"
        )

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
        if len(questions) < len(problems):
            logger.warning(
                "Batch generation returned %d problems, expected %d — padding with sources",
                len(questions), len(problems),
            )
            questions += problems[len(questions):]

        return questions
    except (anthropic.APIError, anthropic.APITimeoutError, RuntimeError):
        logger.exception("Failed to generate similar questions")
        raise RuntimeError("Failed to generate similar questions")


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
