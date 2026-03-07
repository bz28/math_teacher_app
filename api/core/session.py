"""Session orchestration: manages the tutoring loop.

Handles step advancement, hint system, step-size validation,
and per-user daily request caps.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.math_engine import MathEngine
from api.core.step_decomposition import Step, decompose_problem, generate_similar_word_problem
from api.core.tutor import _call_claude_json, converse, step_chat
from api.models.session import Session

MAX_ATTEMPTS_PER_STEP = 5
MAX_HINTS_PER_STEP = 3
RECENT_EXCHANGES_LIMIT = 10


class SessionError(Exception):
    pass


class RateLimitError(SessionError):
    pass


# ---------------------------------------------------------------------------
# Per-user daily request cap
# ---------------------------------------------------------------------------

async def _check_daily_cap(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Enforce per-user daily session creation cap."""
    from datetime import date, datetime

    today_start = datetime.combine(date.today(), datetime.min.time(), tzinfo=UTC)
    result = await db.execute(
        select(func.count(Session.id)).where(
            Session.user_id == user_id,
            Session.created_at >= today_start,
        )
    )
    count = result.scalar() or 0
    # Use school cap as default; role-based logic can be added later
    cap = settings.daily_request_cap_free
    if count >= cap:
        raise RateLimitError(f"Daily session limit reached ({cap})")


# ---------------------------------------------------------------------------
# Step-size validation
# ---------------------------------------------------------------------------

def _find_matching_steps(response: str, steps: list[Step], current_idx: int) -> list[int]:
    """Check which future steps the student's response matches.

    Returns list of matching step indices.
    Compares both as expressions and as string equality for equation forms.
    """
    response_clean = response.strip()
    matches: list[int] = []
    for i in range(current_idx, len(steps)):
        after = steps[i].after.strip()
        # Direct string match (handles equation forms like "2x = 6")
        if response_clean == after:
            matches.append(i)
            continue
        try:
            if MathEngine.are_equivalent(response_clean, after):
                matches.append(i)
        except Exception:
            continue
    return matches


def _validate_step_size(response: str, steps: list[Step], current_idx: int) -> tuple[bool, str | None]:
    """Validate that the response doesn't skip steps.

    Returns (is_valid, message). If the student's response matches a step
    2+ ahead of the current step, reject and ask for intermediate work.
    """
    matches = _find_matching_steps(response, steps, current_idx)
    if matches:
        furthest = max(matches)
        skipped = furthest - current_idx
        if skipped >= 2:
            return False, (
                "That's the right answer, but you skipped some steps. "
                "Can you walk me through how you got there?"
            )
    return True, None


# ---------------------------------------------------------------------------
# Hint generation
# ---------------------------------------------------------------------------

def _generate_hint(step: Step, hint_level: int) -> str:
    """Generate a progressive hint for the current step.

    hint_level 0: vague direction
    hint_level 1: specific operation
    hint_level 2: most of the answer (80% ceiling)
    """
    if hint_level == 0:
        return f"Think about what operation you need to do next. Look at: {step.before}"
    elif hint_level == 1:
        return f"You need to perform: {step.operation}. Start from: {step.before}"
    else:
        # 80% ceiling: give the operation and partial result, but not the full answer
        return (
            f"Apply {step.operation} to {step.before}. "
            f"The result should simplify things significantly."
        )


# ---------------------------------------------------------------------------
# Session creation
# ---------------------------------------------------------------------------

async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    problem: str,
    mode: str = "learn",
) -> Session:
    """Create a new tutoring session for a problem."""
    await _check_daily_cap(db, user_id)

    # Decompose the problem into steps
    decomposition = await decompose_problem(problem)

    steps_data = [
        {
            "description": s.description,
            "operation": s.operation,
            "before": s.before,
            "after": s.after,
        }
        for s in decomposition.steps
    ]

    session = Session(
        user_id=user_id,
        problem=problem,
        problem_type=decomposition.problem_type,
        steps=steps_data,
        current_step=0,
        total_steps=len(decomposition.steps),
        status="active",
        mode=mode,
        step_tracking={},
        exchanges=[],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Get session
# ---------------------------------------------------------------------------

async def get_session(db: AsyncSession, session_id: uuid.UUID) -> Session:
    """Retrieve a session by ID."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise SessionError("Session not found")
    return session


# ---------------------------------------------------------------------------
# Respond to a step
# ---------------------------------------------------------------------------

@dataclass
class StepResponse:
    # "advance", "hint", "completed", "error", "conversation", "show_step"
    action: str
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False
    similar_problem: str | None = None
    step_description: str | None = None


async def _converse_completed(
    db: AsyncSession,
    session: Session,
    student_response: str,
) -> StepResponse:
    """Allow the student to keep asking questions after completing a problem."""
    _add_exchange(session, "student", student_response)

    converse_result = await converse(
        problem=session.problem,
        steps=session.steps,
        exchanges=session.exchanges,
        student_input=student_response,
        session_id=str(session.id),
    )

    _add_exchange(session, "tutor", converse_result.feedback)
    await db.commit()
    return StepResponse(
        action="conversation",
        feedback=converse_result.feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
    )


async def _complete_practice(
    db: AsyncSession, session: Session,
) -> StepResponse:
    """Mark a practice session as completed and generate a similar problem."""
    session.current_step = session.total_steps
    session.status = "completed"
    if session.problem_type == "word_problem":
        similar = await generate_similar_word_problem(session.problem)
    else:
        similar = MathEngine.generate_similar(session.problem)
    feedback = "Correct! Problem complete!"
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="completed",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=True,
        similar_problem=similar,
    )


_PRACTICE_FINAL_EVAL_PROMPT = """You are a strict math tutor checking a student's final answer.

Determine if the student's answer is MATHEMATICALLY EQUIVALENT to the correct
final answer. Allow differences in formatting or notation (e.g., "x=3" vs
"x = 3", "6" vs "x = 6"), but the answer must be completely correct.

Be STRICT:
- "35" does NOT match "35x^4" — the variable/exponent is missing
- Partial answers or answers missing terms are WRONG

Respond with ONLY valid JSON:
{"is_correct": <true/false>}"""


async def _llm_check_final_answer(
    problem: str,
    correct_answer: str,
    student_response: str,
    session_id: str,
) -> bool:
    """Use LLM to check if student's response matches the final answer."""
    user_msg = (
        f"Problem: {problem}\n"
        f"Correct final answer: {correct_answer}\n"
        f"Student's answer: {student_response}"
    )

    try:
        result = await _call_claude_json(
            _PRACTICE_FINAL_EVAL_PROMPT, user_msg,
            mode="practice_eval", session_id=session_id,
        )
        return bool(result.get("is_correct", False))
    except Exception:
        return False


async def _respond_practice_mode(
    db: AsyncSession,
    session: Session,
    student_response: str,
) -> StepResponse:
    """Handle a student response in practice mode (final-answer-only)."""
    final_step = session.steps[-1]
    correct_answer = final_step["after"]

    _add_exchange(session, "student", student_response)

    # 1. Fast symbolic check against the final answer only
    is_correct = False
    try:
        is_correct = MathEngine.are_equivalent(student_response.strip(), correct_answer.strip())
    except Exception:
        pass

    # Also try direct string match
    if not is_correct:
        is_correct = student_response.strip() == correct_answer.strip()

    # 2. LLM fallback if symbolic check fails
    if not is_correct:
        is_correct = await _llm_check_final_answer(
            session.problem, correct_answer,
            student_response, str(session.id),
        )

    if is_correct:
        return await _complete_practice(db, session)

    # Wrong answer
    feedback = "Incorrect, try again."
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="error",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=False,
    )


async def _complete_learn(
    db: AsyncSession, session: Session,
) -> StepResponse:
    """Mark a learn session as completed and generate a similar problem."""
    session.current_step = session.total_steps
    session.status = "completed"
    if session.problem_type == "word_problem":
        similar = await generate_similar_word_problem(session.problem)
    else:
        similar = MathEngine.generate_similar(session.problem)
    feedback = "Correct! You've solved the problem!"
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="completed",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=True,
        similar_problem=similar,
    )


async def _respond_learn_mode(
    db: AsyncSession,
    session: Session,
    student_response: str,
    request_advance: bool = False,
) -> StepResponse:
    """Handle learn mode: steps shown upfront, chat scoped to current step.

    Non-final steps: student reads the step, can ask questions, clicks
    "I understand" (request_advance=True) to advance.

    Final step: student must provide the final answer. The step is NOT
    shown — we ask them what the answer is and evaluate it.
    """
    step_data = session.steps[session.current_step]
    is_final_step = session.current_step >= session.total_steps - 1

    # --- Non-final step: advance or chat ---
    if not is_final_step:
        if request_advance:
            session.current_step += 1
            await db.commit()
            return StepResponse(
                action="advance",
                feedback="",
                current_step=session.current_step,
                total_steps=session.total_steps,
                is_correct=True,
            )

        # Chat: answer questions about this step
        _add_exchange(session, "student", student_response)
        chat_result = await step_chat(
            problem=session.problem,
            step=step_data,
            exchanges=session.exchanges,
            student_input=student_response,
            session_id=str(session.id),
        )
        _add_exchange(session, "tutor", chat_result.feedback)
        await db.commit()
        return StepResponse(
            action="conversation",
            feedback=chat_result.feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
        )

    # --- Final step: evaluate the student's answer ---
    if request_advance:
        raise SessionError("You must provide an answer for the final step")

    correct_answer = step_data["after"]
    _add_exchange(session, "student", student_response)

    # 1. Fast symbolic check
    is_correct = False
    try:
        is_correct = MathEngine.are_equivalent(student_response.strip(), correct_answer.strip())
    except Exception:
        pass

    # 2. Direct string match
    if not is_correct:
        is_correct = student_response.strip() == correct_answer.strip()

    # 3. LLM fallback
    if not is_correct:
        is_correct = await _llm_check_final_answer(
            session.problem, correct_answer,
            student_response, str(session.id),
        )

    if is_correct:
        return await _complete_learn(db, session)

    # Wrong answer
    feedback = "Not quite. Review the steps above and try again."
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="error",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=False,
    )


async def respond_to_step(
    db: AsyncSession,
    session: Session,
    student_response: str,
    request_hint: bool = False,
    request_show_step: bool = False,
    request_advance: bool = False,
) -> StepResponse | AsyncIterator[str]:
    """Process a student's response or action for the current step.

    Returns a StepResponse for JSON actions, or an AsyncIterator[str] for
    streamed explanations.
    """
    if session.status not in ("active", "completed"):
        raise SessionError("Session is not active")

    # Allow conversation on completed sessions ("I still have questions")
    if session.current_step >= session.total_steps:
        if student_response and not request_hint and not request_show_step:
            return await _converse_completed(db, session, student_response)
        raise SessionError("All steps completed")

    # Practice mode: skip step enforcement and scaffolding
    if session.mode == "practice":
        return await _respond_practice_mode(db, session, student_response)

    # Learn mode: steps shown upfront, chat scoped to step, final answer eval
    return await _respond_learn_mode(db, session, student_response, request_advance)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _add_exchange(session: Session, role: str, content: str) -> None:
    """Append an exchange to session history."""
    import time
    exchanges = list(session.exchanges)
    exchanges.append({"role": role, "content": content, "timestamp": time.time()})
    # Keep only recent exchanges
    if len(exchanges) > RECENT_EXCHANGES_LIMIT * 2:
        exchanges = exchanges[-RECENT_EXCHANGES_LIMIT:]
    session.exchanges = exchanges
