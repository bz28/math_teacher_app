"""Session orchestration: manages the tutoring loop.

Handles step advancement, hint system, explain-back triggers,
step-size validation, and per-user daily request caps.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.math_engine import MathEngine
from api.core.step_decomposition import Step, decompose_problem
from api.core.tutor import evaluate, probe
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
    action: str  # "advance", "hint", "explain_back", "scaffolded", "completed", "error", "skip_rejected"
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False
    similar_problem: str | None = None


async def respond_to_step(
    db: AsyncSession,
    session: Session,
    student_response: str,
    request_hint: bool = False,
) -> StepResponse | AsyncIterator[str]:
    """Process a student's response or hint request for the current step.

    Returns a StepResponse for JSON actions, or an AsyncIterator[str] for
    streamed explanations.
    """
    if session.status != "active":
        raise SessionError("Session is not active")

    if session.current_step >= session.total_steps:
        raise SessionError("All steps completed")

    step_data = session.steps[session.current_step]
    step = Step(
        description=step_data["description"],
        operation=step_data["operation"],
        before=step_data["before"],
        after=step_data["after"],
    )

    # Initialize step tracking
    step_key = str(session.current_step)
    tracking = dict(session.step_tracking)
    if step_key not in tracking:
        tracking[step_key] = {"attempts": 0, "hints_used": 0, "explain_back": False}
    step_info = tracking[step_key]

    # Handle hint request
    if request_hint:
        hint_level = min(step_info["hints_used"], MAX_HINTS_PER_STEP - 1)
        hint = _generate_hint(step, hint_level)
        step_info["hints_used"] += 1
        tracking[step_key] = step_info
        session.step_tracking = tracking

        _add_exchange(session, "tutor", f"Hint: {hint}")
        await db.commit()

        return StepResponse(
            action="hint",
            feedback=hint,
            current_step=session.current_step,
            total_steps=session.total_steps,
        )

    # Record the student's response
    _add_exchange(session, "student", student_response)
    step_info["attempts"] += 1

    # Step-size validation
    steps_list = [
        Step(s["description"], s["operation"], s["before"], s["after"])
        for s in session.steps
    ]
    is_valid, skip_msg = _validate_step_size(student_response, steps_list, session.current_step)
    if not is_valid:
        _add_exchange(session, "tutor", skip_msg or "")
        tracking[step_key] = step_info
        session.step_tracking = tracking
        await db.commit()
        return StepResponse(
            action="skip_rejected",
            feedback=skip_msg or "Please show your work step by step.",
            current_step=session.current_step,
            total_steps=session.total_steps,
        )

    # Check if too many attempts — scaffold down
    if step_info["attempts"] > MAX_ATTEMPTS_PER_STEP:
        feedback = (
            f"Let me break this down further. {step.description}: "
            f"Starting from {step.before}, apply {step.operation} to get closer to the answer."
        )
        _add_exchange(session, "tutor", feedback)
        tracking[step_key] = step_info
        session.step_tracking = tracking
        await db.commit()
        return StepResponse(
            action="scaffolded",
            feedback=feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
        )

    # Evaluate the response using LLM
    eval_result = await evaluate(
        problem=session.problem,
        step_before=step.before,
        step_operation=step.operation,
        step_after=step.after,
        student_response=student_response,
        session_id=str(session.id),
    )

    if eval_result.is_correct:
        # Explain-back only after hints were used (not on clean correct answers)
        if step_info["hints_used"] > 0 and not step_info["explain_back"]:
            step_info["explain_back"] = True
            tracking[step_key] = step_info
            session.step_tracking = tracking
            feedback = f"{eval_result.feedback} Now explain this step in your own words."
            _add_exchange(session, "tutor", feedback)
            await db.commit()
            return StepResponse(
                action="explain_back",
                feedback=feedback,
                current_step=session.current_step,
                total_steps=session.total_steps,
                is_correct=True,
            )

        # Advance to next step
        session.current_step += 1
        tracking[step_key] = step_info
        session.step_tracking = tracking

        if session.current_step >= session.total_steps:
            session.status = "completed"
            similar = MathEngine.generate_similar(session.problem)
            feedback = f"{eval_result.feedback} Problem complete!"
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

        _add_exchange(session, "tutor", eval_result.feedback)
        await db.commit()
        return StepResponse(
            action="advance",
            feedback=eval_result.feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
            is_correct=True,
        )

    # Wrong answer — stream an explanation
    _add_exchange(session, "tutor", eval_result.feedback)
    tracking[step_key] = step_info
    session.step_tracking = tracking
    await db.commit()

    return StepResponse(
        action="error",
        feedback=eval_result.feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=False,
    )


# ---------------------------------------------------------------------------
# Handle explain-back response
# ---------------------------------------------------------------------------

async def handle_explain_back(
    db: AsyncSession,
    session: Session,
    student_explanation: str,
) -> StepResponse:
    """Process a student's explain-back response."""
    if session.current_step >= session.total_steps:
        raise SessionError("All steps completed")

    step_data = session.steps[session.current_step]
    step_desc = f"{step_data['description']}: {step_data['before']} → {step_data['after']}"

    _add_exchange(session, "student", student_explanation)

    probe_result = await probe(
        step=step_desc,
        student_explanation=student_explanation,
        session_id=str(session.id),
    )

    if probe_result.understanding == "clear":
        # Advance
        session.current_step += 1

        if session.current_step >= session.total_steps:
            session.status = "completed"
            similar = MathEngine.generate_similar(session.problem)
            feedback = "Great explanation! Problem complete!"
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

        feedback = "Great explanation! Let's move on to the next step."
        _add_exchange(session, "tutor", feedback)
        await db.commit()
        return StepResponse(
            action="advance",
            feedback=feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
            is_correct=True,
        )

    # Partial or wrong — ask follow-up
    feedback = probe_result.follow_up or "Can you explain why we do this step?"
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="explain_back",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
    )


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
