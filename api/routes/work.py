"""Work submission endpoints: submit handwritten work for diagnosis."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.entitlements import Entitlement, check_entitlement
from api.core.step_decomposition import decompose_problem
from api.core.work_diagnosis import diagnose_work
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user, get_current_user_full
from api.models.user import User
from api.models.work_submission import WorkSubmission
from api.schemas.work import DiagnosisResult, DiagnosisStep, SubmitWorkRequest, SubmitWorkResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/work", tags=["work"])


@router.post("/submit", response_model=SubmitWorkResponse)
async def submit_work(
    body: SubmitWorkRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> SubmitWorkResponse:
    """Submit a photo of handwritten work for diagnosis against the optimal solution."""
    await check_entitlement(db, user, Entitlement.WORK_DIAGNOSIS)
    user_id_str = str(user.id)

    # Step 1: Generate optimal steps via decompose_problem()
    try:
        decomposition = await decompose_problem(
            body.problem_text, user_id=user_id_str, subject=body.subject,
        )
    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to generate solution steps",
        )

    step_descriptions = [s["description"] for s in decomposition.steps]
    correct_answer = decomposition.final_answer

    # Step 2: Call Claude Vision to diagnose work against optimal steps
    try:
        diagnosis_result = await diagnose_work(
            image_base64=body.image_base64,
            problem_text=body.problem_text,
            steps=step_descriptions,
            final_answer=correct_answer,
            user_answer=body.user_answer,
            user_was_correct=body.user_was_correct,
            user_id=user_id_str,
            subject=body.subject,
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
        user_id=user.id,
        session_id=None,
        problem_index=0,
        problem_text=body.problem_text,
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
