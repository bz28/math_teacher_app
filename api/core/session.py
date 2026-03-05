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
from api.core.step_decomposition import Step, decompose_problem, generate_similar_word_problem
from api.core.tutor import converse, evaluate, probe
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
    action: str  # "advance", "hint", "explain_back", "scaffolded", "completed", "error", "skip_rejected", "conversation", "show_step"
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False
    similar_problem: str | None = None
    step_description: str | None = None


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


_PRACTICE_EVAL_PROMPT = """You are a strict math tutor checking a student's work.

Given a problem and solution steps, determine which step (if any) the student's
answer is MATHEMATICALLY EQUIVALENT to. Allow differences in formatting or
notation (e.g., "x=3" vs "x = 3"), but the answer must be completely correct.

Be STRICT:
- "35" does NOT match "35x^4" — the variable/exponent is missing
- "x = 2" DOES match "x = 2 or x = 3" — it's one of the solutions
- "6" DOES match "x = 6" — just a formatting difference
- Partial answers or answers missing terms are WRONG

Respond with ONLY valid JSON:
{"matched_step": <step_index or -1>, "is_correct": <true/false>}

- matched_step: the 0-based index of the FURTHEST step the answer matches, or -1
- is_correct: true ONLY if the answer is mathematically equivalent to a step result"""


async def _llm_match_step(
    problem: str,
    steps: list[Step],
    current_idx: int,
    student_response: str,
    session_id: str,
) -> int:
    """Use LLM to find which step a student's response matches.

    Returns the matched step index, or -1 if no match.
    """
    remaining = []
    for i in range(current_idx, len(steps)):
        remaining.append(f"  Step {i}: {steps[i].description} → {steps[i].after}")
    steps_text = "\n".join(remaining)

    user_msg = (
        f"Problem: {problem}\n\n"
        f"Solution steps:\n{steps_text}\n\n"
        f"Student's answer: {student_response}"
    )

    try:
        result = await _call_claude_json(
            _PRACTICE_EVAL_PROMPT, user_msg, mode="practice_eval", session_id=session_id,
        )
        matched = int(result.get("matched_step", -1))
        is_correct = bool(result.get("is_correct", False))
        if matched >= current_idx and matched < len(steps) and is_correct:
            return matched
    except Exception:
        pass
    return -1


async def _respond_practice_mode(
    db: AsyncSession,
    session: Session,
    student_response: str,
) -> StepResponse:
    """Handle a student response in practice mode (free-form, no step enforcement)."""
    steps_list = [
        Step(s["description"], s["operation"], s["before"], s["after"])
        for s in session.steps
    ]

    _add_exchange(session, "student", student_response)

    # 1. Fast symbolic match against ANY step (instant)
    matches = _find_matching_steps(student_response, steps_list, session.current_step)
    if matches:
        furthest = max(matches)
        session.current_step = furthest + 1

        if session.current_step >= session.total_steps:
            return await _complete_practice(db, session)

        feedback = "Correct!"
        _add_exchange(session, "tutor", feedback)
        await db.commit()
        return StepResponse(
            action="advance",
            feedback=feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
            is_correct=True,
        )

    # 2. Symbolic match failed — fall back to LLM evaluation
    llm_match = await _llm_match_step(
        session.problem, steps_list, session.current_step,
        student_response, str(session.id),
    )
    if llm_match >= 0:
        session.current_step = llm_match + 1

        if session.current_step >= session.total_steps:
            return await _complete_practice(db, session)

        feedback = "Correct!"
        _add_exchange(session, "tutor", feedback)
        await db.commit()
        return StepResponse(
            action="advance",
            feedback=feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
            is_correct=True,
        )

    # 3. Neither matched — wrong answer
    feedback = "That doesn't match any step. Try again."
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
        tracking[step_key] = {"attempts": 0, "hints_used": 0, "explain_back": False, "shown": False}
    step_info = tracking[step_key]

    # Handle hint request (practice mode only now; learn mode uses show_step)
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

    # Practice mode: skip step enforcement, explain-back, scaffolding
    if session.mode == "practice":
        return await _respond_practice_mode(db, session, student_response)

    # --- Learn mode: conversational tutoring ---

    # Handle "Show next step" request
    if request_show_step:
        step_info["shown"] = True
        tracking[step_key] = step_info
        session.step_tracking = tracking
        feedback = f"Here's what to do next. Enter the math expression to continue."
        _add_exchange(session, "tutor", f"Show step: {step.description}")
        await db.commit()
        return StepResponse(
            action="show_step",
            feedback=feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
            step_description=step.description,
        )

    # Record the student's response
    _add_exchange(session, "student", student_response)
    step_info["attempts"] += 1

    # Call converse() for LLM evaluation
    converse_result = await converse(
        problem=session.problem,
        steps=session.steps,
        exchanges=session.exchanges,
        student_input=student_response,
        session_id=str(session.id),
    )

    # Question or unclear → return conversation feedback
    if converse_result.input_type in ("question", "unclear"):
        _add_exchange(session, "tutor", converse_result.feedback)
        tracking[step_key] = step_info
        session.step_tracking = tracking
        await db.commit()
        return StepResponse(
            action="conversation",
            feedback=converse_result.feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
        )

    # Answer attempt
    if converse_result.is_correct and converse_result.steps_completed is not None:
        new_step = converse_result.steps_completed + 1

        # If step was shown, trigger explain-back before advancing
        if step_info.get("shown") and not step_info["explain_back"]:
            step_info["explain_back"] = True
            tracking[step_key] = step_info
            session.step_tracking = tracking
            feedback = f"{converse_result.feedback} Now explain this step in your own words."
            _add_exchange(session, "tutor", feedback)
            # Store pending advance so explain-back knows where to go
            step_info["pending_advance_to"] = new_step
            tracking[step_key] = step_info
            session.step_tracking = tracking
            await db.commit()
            return StepResponse(
                action="explain_back",
                feedback=feedback,
                current_step=session.current_step,
                total_steps=session.total_steps,
                is_correct=True,
            )

        # Advance
        session.current_step = new_step
        tracking[step_key] = step_info
        session.step_tracking = tracking

        if session.current_step >= session.total_steps:
            session.status = "completed"
            if session.problem_type == "word_problem":
                similar = await generate_similar_word_problem(session.problem)
            else:
                similar = MathEngine.generate_similar(session.problem)
            feedback = f"{converse_result.feedback} Problem complete!"
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

        _add_exchange(session, "tutor", converse_result.feedback)
        await db.commit()
        return StepResponse(
            action="advance",
            feedback=converse_result.feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
            is_correct=True,
        )

    # Wrong answer
    _add_exchange(session, "tutor", converse_result.feedback)
    tracking[step_key] = step_info
    session.step_tracking = tracking
    await db.commit()

    return StepResponse(
        action="error",
        feedback=converse_result.feedback,
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
    skip_explain_back: bool = False,
) -> StepResponse:
    """Process a student's explain-back response.

    If skip_explain_back is True, skip the probe and just advance.
    """
    if session.current_step >= session.total_steps:
        raise SessionError("All steps completed")

    step_key = str(session.current_step)
    tracking = dict(session.step_tracking)
    step_info = tracking.get(step_key, {})

    should_advance = skip_explain_back

    if not skip_explain_back:
        step_data = session.steps[session.current_step]
        step_desc = f"{step_data['description']}: {step_data['before']} → {step_data['after']}"

        _add_exchange(session, "student", student_explanation)

        probe_result = await probe(
            step=step_desc,
            student_explanation=student_explanation,
            session_id=str(session.id),
        )
        should_advance = probe_result.understanding == "clear"

        if not should_advance:
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

    # Advance — use pending_advance_to if set (from show_step flow)
    pending = step_info.get("pending_advance_to")
    if pending is not None:
        session.current_step = pending
        step_info.pop("pending_advance_to", None)
        tracking[step_key] = step_info
        session.step_tracking = tracking
    else:
        session.current_step += 1

    if session.current_step >= session.total_steps:
        session.status = "completed"
        if session.problem_type == "word_problem":
            similar = await generate_similar_word_problem(session.problem)
        else:
            similar = MathEngine.generate_similar(session.problem)
        feedback = "Problem complete!" if skip_explain_back else "Great explanation! Problem complete!"
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

    feedback = "Let's move on." if skip_explain_back else "Great explanation! Let's move on to the next step."
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="advance",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=True,
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
