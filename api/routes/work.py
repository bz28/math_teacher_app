"""Work submission endpoints: submit handwritten work for diagnosis."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.session import get_owned_session
from api.core.step_decomposition import decompose_problem
from api.core.work_diagnosis import diagnose_work
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user
from api.models.work_submission import WorkSubmission
from api.schemas.work import DiagnosisResult, DiagnosisStep, SubmitWorkRequest, SubmitWorkResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/work", tags=["work"])


@router.post("/submit", response_model=SubmitWorkResponse)
async def submit_work(
    body: SubmitWorkRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubmitWorkResponse:
    """Submit a photo of handwritten work for diagnosis against the optimal solution."""
    # Look up session and verify ownership
    try:
        session = await get_owned_session(db, body.session_id, current_user.user_id)
    except Exception as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        if "not your" in error_msg.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)

    # Validate problem_index
    if body.problem_index < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid problem index",
        )

    # Extract problem data from session
    problem_text = session.problem

    # Get user's answer and correctness from session steps
    # Practice sessions have a single step with final_answer
    if not session.steps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session has no steps",
        )
    final_step = session.steps[-1]
    correct_answer = final_step.get("final_answer", "")

    # Determine user's answer from exchanges (last student message)
    user_answer = ""
    user_was_correct = session.status == "completed"
    for exchange in reversed(session.exchanges):
        if exchange.get("role") == "student":
            user_answer = exchange.get("content", "")
            break

    # Step 1: Generate optimal steps via decompose_problem() if not already cached
    step_descriptions: list[str] = []
    if len(session.steps) > 1:
        # Session already has full decomposition (learn mode or previously cached)
        step_descriptions = [s.get("description", "") for s in session.steps if s.get("description")]
    else:
        # Practice/mock test — only has final answer, need to decompose
        user_id_str = str(current_user.user_id)
        try:
            decomposition = await decompose_problem(problem_text, user_id=user_id_str)
        except RuntimeError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Failed to generate solution steps",
            )

        step_descriptions = decomposition.steps
        correct_answer = decomposition.final_answer

        # Cache the full steps on the session for learn mode reuse
        steps_data = [{"description": s} for s in decomposition.steps]
        last = steps_data[-1]
        last["final_answer"] = decomposition.final_answer
        if decomposition.distractors:
            import random
            choices = [decomposition.final_answer] + decomposition.distractors[:3]
            random.shuffle(choices)
            last["choices"] = choices
        session.steps = steps_data
        session.total_steps = len(steps_data)
        await db.flush()

    # Step 2: Call Claude Vision to diagnose work against optimal steps
    try:
        diagnosis_result = await diagnose_work(
            image_base64=body.image_base64,
            problem_text=problem_text,
            steps=step_descriptions,
            final_answer=correct_answer,
            user_answer=user_answer,
            user_was_correct=user_was_correct,
            session_id=str(session.id),
            user_id=str(current_user.user_id),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to diagnose work",
        )

    # Save WorkSubmission record
    submission = WorkSubmission(
        user_id=current_user.user_id,
        session_id=session.id,
        problem_index=body.problem_index,
        diagnosis=diagnosis_result,
        summary=diagnosis_result["summary"],
        has_issues=diagnosis_result["has_issues"],
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)

    # Build response
    diagnosis = DiagnosisResult(
        steps=[DiagnosisStep(**s) for s in diagnosis_result["steps"]],
        summary=diagnosis_result["summary"],
        has_issues=diagnosis_result["has_issues"],
        overall_feedback=diagnosis_result["overall_feedback"],
    )

    return SubmitWorkResponse(id=submission.id, diagnosis=diagnosis)
