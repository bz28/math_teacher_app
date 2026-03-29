"""Session orchestration: manages the tutoring loop."""

import random
import time
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.constants import (
    MAX_PROBLEM_LENGTH,
    MAX_STUDENT_MESSAGES,
    RECENT_EXCHANGES_LIMIT,
)
from api.core.practice import check_answer
from api.core.step_decomposition import decompose_problem
from api.core.subjects import Subject
from api.core.tutor import completed_chat, step_chat
from api.models.session import Session, SessionMode, SessionStatus
from api.models.work_submission import WorkSubmission


class SessionError(Exception):
    pass


# ---------------------------------------------------------------------------
# Session creation
# ---------------------------------------------------------------------------

async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    problem: str,
    mode: str = SessionMode.LEARN,
    subject: str = Subject.MATH,
) -> Session:
    """Create a new tutoring session for a problem."""
    problem = problem.strip()
    if not problem:
        raise ValueError("Problem cannot be empty")
    if len(problem) > MAX_PROBLEM_LENGTH:
        raise ValueError(f"Problem too long (max {MAX_PROBLEM_LENGTH} characters)")

    if mode == SessionMode.PRACTICE:
        # Use full decomposition for accuracy — steps cached for learn mode reuse
        decomp = await decompose_problem(problem, user_id=str(user_id), subject=subject)
        problem_type = decomp.problem_type
        steps_data: list[dict[str, Any]] = [
            {"description": "Final answer", "final_answer": decomp.final_answer},
        ]
    else:
        # Check for prior work submission to personalize learn mode
        prior_diagnosis: dict[str, Any] | None = None
        ws_result = await db.execute(
            select(WorkSubmission.diagnosis, WorkSubmission.has_issues)
            .where(
                WorkSubmission.user_id == user_id,
                WorkSubmission.problem_text == problem,
            )
            .order_by(WorkSubmission.created_at.desc())
            .limit(1)
        )
        ws_row = ws_result.one_or_none()
        if ws_row is not None:
            diagnosis_data, has_issues = ws_row
            # Only personalize if there were actual issues — no point
            # burning a fresh LLM call just to say "good job" at each step
            if has_issues:
                prior_diagnosis = diagnosis_data
            # Clean up — delete all work submissions for this user + problem
            await db.execute(
                delete(WorkSubmission).where(
                    WorkSubmission.user_id == user_id,
                    WorkSubmission.problem_text == problem,
                )
            )

        # Full decomposition for learn mode
        decomposition = await decompose_problem(
            problem, user_id=str(user_id), work_diagnosis=prior_diagnosis,
            subject=subject,
        )
        problem_type = decomposition.problem_type
        steps_data = [{"description": s} for s in decomposition.steps]
        if not steps_data:
            raise RuntimeError("Decomposition returned no steps")

        # Attach final_answer and shuffled multiple-choice to the last step
        last = steps_data[-1]
        last["final_answer"] = decomposition.final_answer
        if decomposition.distractors:
            choices = [decomposition.final_answer] + decomposition.distractors[:3]
            random.shuffle(choices)
            last["choices"] = choices

    session = Session(
        user_id=user_id,
        problem=problem,
        problem_type=problem_type,
        steps=steps_data,
        current_step=0,
        total_steps=len(steps_data),
        status=SessionStatus.ACTIVE,
        mode=mode,
        subject=subject,
        exchanges=[],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # TODO: re-enable once judge prompt is refined
    # if mode != SessionMode.PRACTICE:
    #     fire_and_forget_judge(
    #         problem=problem,
    #         steps=decomposition.steps,
    #         final_answer=decomposition.final_answer,
    #         session_id=str(session.id),
    #     )

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


async def get_owned_session(
    db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID,
) -> Session:
    """Retrieve a session and verify ownership. Raises SessionError / PermissionError."""
    session = await get_session(db, session_id)
    if session.user_id != user_id:
        raise PermissionError("Not your session")
    return session


# ---------------------------------------------------------------------------
# Respond to a step
# ---------------------------------------------------------------------------

@dataclass
class StepResponse:
    action: str  # "advance" | "completed" | "error" | "conversation"
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False


async def _converse_completed(
    db: AsyncSession,
    session: Session,
    student_response: str,
) -> StepResponse:
    """Allow the student to keep asking questions after completing a problem."""
    student_msgs = sum(1 for e in session.exchanges if e.get("role") == "student")
    if student_msgs >= MAX_STUDENT_MESSAGES:
        raise SessionError("Session message limit reached")

    _add_exchange(session, "student", student_response)

    chat_result = await completed_chat(
        problem=session.problem,
        steps=session.steps,
        exchanges=session.exchanges,
        student_input=student_response,
        session_id=str(session.id),
        user_id=str(session.user_id),
        subject=getattr(session, "subject", Subject.MATH),
    )

    _add_exchange(session, "tutor", chat_result.feedback)
    await db.commit()
    return StepResponse(
        action="conversation",
        feedback=chat_result.feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
    )


async def _complete_session(
    db: AsyncSession, session: Session,
) -> StepResponse:
    """Mark a session as completed (works for both learn and practice modes)."""
    session.current_step = session.total_steps
    session.status = SessionStatus.COMPLETED
    feedback = (
        "Correct! Problem complete!"
        if session.mode == SessionMode.PRACTICE
        else "Correct! You've solved the problem!"
    )
    _add_exchange(session, "tutor", feedback)
    await db.commit()
    return StepResponse(
        action="completed",
        feedback=feedback,
        current_step=session.current_step,
        total_steps=session.total_steps,
        is_correct=True,
    )


async def _respond_practice_mode(
    db: AsyncSession,
    session: Session,
    student_response: str,
) -> StepResponse:
    """Handle a student response in practice mode (final-answer-only)."""
    final_step = session.steps[-1]
    correct_answer = final_step["final_answer"]

    _add_exchange(session, "student", student_response)

    is_correct = await check_answer(
        session.problem, correct_answer, student_response,
        session_id=str(session.id), user_id=str(session.user_id),
        subject=getattr(session, "subject", Subject.MATH),
    )

    if is_correct:
        return await _complete_session(db, session)

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
            user_id=str(session.user_id),
            subject=getattr(session, "subject", Subject.MATH),
        )
        _add_exchange(session, "tutor", chat_result.feedback)
        await db.commit()
        return StepResponse(
            action="conversation",
            feedback=chat_result.feedback,
            current_step=session.current_step,
            total_steps=session.total_steps,
        )

    # --- Final step: multiple-choice answer ---
    if request_advance:
        raise SessionError("You must provide an answer for the final step")

    correct_answer = step_data["final_answer"]
    _add_exchange(session, "student", student_response)

    # Direct string match (multiple-choice: student selects an exact option)
    is_correct = student_response.strip() == correct_answer.strip()

    if is_correct:
        return await _complete_session(db, session)

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
    request_advance: bool = False,
) -> StepResponse:
    """Process a student's response or action for the current step."""
    if session.status not in (SessionStatus.ACTIVE, SessionStatus.COMPLETED):
        raise SessionError("Session is not active")

    # Allow conversation on completed sessions ("I still have questions")
    if session.current_step >= session.total_steps:
        if student_response:
            return await _converse_completed(db, session, student_response)
        raise SessionError("All steps completed")

    # Practice mode: skip step enforcement and scaffolding
    if session.mode == SessionMode.PRACTICE:
        return await _respond_practice_mode(db, session, student_response)

    # Learn mode: steps shown upfront, chat scoped to step, final answer eval
    return await _respond_learn_mode(db, session, student_response, request_advance)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _add_exchange(session: Session, role: str, content: str) -> None:
    """Append an exchange to session history, keeping only the most recent."""
    exchanges = list(session.exchanges)
    exchanges.append({"role": role, "content": content, "timestamp": time.time()})
    if len(exchanges) > RECENT_EXCHANGES_LIMIT:
        exchanges = exchanges[-RECENT_EXCHANGES_LIMIT:]
    session.exchanges = exchanges
