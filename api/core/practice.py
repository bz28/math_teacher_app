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
# Generate question texts from objectives (no seed problems)
# ---------------------------------------------------------------------------

_LEVEL_LABELS: dict[str, str] = {
    "middle": "middle school",
    "hs": "high school",
    "college": "college",
    "other": "",
}

_GENERATE_FROM_OBJECTIVES_TEMPLATE = """You are a {professor_role} writing a \
{count}-question practice exam.

Course context:
- Level: {level}
- Course: {course}

The exam must cover these objectives:
{topics_block}

Requirements:
- Produce exactly {count} problems, each solvable on paper.
- Cover each listed objective at least once when feasible; distribute
  coverage evenly across the objectives rather than clustering on one.
- Match the difficulty a student at the given level would face on a real
  in-class exam in the given course. Do not go easier or harder.
- Use LaTeX with $ delimiters for ALL math. Describe any required diagram
  in detail inside brackets [...] appended to the problem text.
- Progress roughly foundational → challenging across the set.
- Do NOT repeat or near-duplicate problems within the set.

Return ONLY the problem text for each item — do NOT include answers, step
breakdowns, explanations, or numbering. The downstream pipeline solves and
decomposes each problem separately."""


async def generate_problems_from_objectives(
    topics: list[str],
    count: int,
    *,
    level: str | None = None,
    course_name: str | None = None,
    user_id: str | None = None,
    subject: str = Subject.MATH,
) -> list[str]:
    """Generate `count` practice problems covering the given topics.

    Topic-driven cold-start generation for Mock Test "From objectives" mode.
    Returns a list of problem text strings (no answers / decomposition —
    those run separately via solve_problem, matching the existing
    generate_similar pipeline).
    """
    cfg = get_config(subject)
    clean_topics = [t.strip() for t in topics if t and t.strip()]
    if not clean_topics:
        raise ValueError("At least one non-empty topic is required")
    if count < 1:
        raise ValueError("count must be >= 1")

    topics_block = "\n".join(f"- {t}" for t in clean_topics)
    level_label = _LEVEL_LABELS.get((level or "").lower(), "") or "unspecified"
    course_label = (course_name or "").strip() or "unspecified"

    system_prompt = _GENERATE_FROM_OBJECTIVES_TEMPLATE.format(
        professor_role=cfg["professor_role"],
        count=count,
        level=level_label,
        course=course_label,
        topics_block=topics_block,
    )

    user_msg = (
        f"Write {count} practice exam problems covering the objectives above. "
        f"Return them as a list of exactly {count} items, in order from most "
        f"foundational to most challenging."
    )

    try:
        result = await call_claude_json(
            system_prompt,
            user_msg,
            mode=LLMMode.PRACTICE_GENERATE,
            tool_schema=PRACTICE_GENERATE_SCHEMA,
            user_id=user_id,
            # Match generate_similar_questions: Haiku for text-only generation.
            # Topic inputs never carry diagrams, so no Sonnet escalation needed.
            model=MODEL_HAIKU,
            max_tokens=min(1024 * max(count, 2), 8192),
        )
        raw_problems = result.get("problems")
        if not isinstance(raw_problems, list) or not raw_problems:
            raise RuntimeError("No problems generated")

        questions = [
            str(p).strip() for p in raw_problems
            if isinstance(p, str) and p.strip()
        ]
        if not questions:
            raise RuntimeError("No valid questions generated")

        # Trim to requested count (Claude occasionally overshoots by 1).
        return questions[:count]
    except (anthropic.APIError, anthropic.APITimeoutError, RuntimeError):
        logger.exception("Failed to generate problems from objectives")
        raise RuntimeError("Failed to generate problems from objectives")


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
