"""Practice endpoints: generate similar problems and check answers."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.entitlements import Entitlement, check_entitlement
from api.core.practice import check_answer, generate_similar_questions, solve_problem
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user, get_current_user_full
from api.middleware.rate_limit import limiter
from api.models.user import User
from api.schemas.practice import (
    PracticeCheckRequest,
    PracticeCheckResponse,
    PracticeGenerateRequest,
    PracticeGenerateResponse,
    PracticeProblem,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/practice", tags=["practice"])


@router.post("/generate", response_model=PracticeGenerateResponse)
@limiter.limit("10/minute")
async def generate(
    request: Request,
    body: PracticeGenerateRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> PracticeGenerateResponse:
    """Generate similar practice problems or solve a single problem.

    - Send `problems` (list) to batch-generate similar question texts (no answers).
    - Send `problem` with `count=0` to solve a single problem (returns answer + distractors).
    """
    await check_entitlement(db, user, Entitlement.CREATE_SESSION)

    try:
        # Batch generate similar question texts — solving is done separately by the frontend
        if body.problems:
            question_texts = await generate_similar_questions(
                body.problems,
                user_id=str(user.id),
                subject=body.subject,
                difficulty=body.difficulty,
            )
            return PracticeGenerateResponse(
                problems=[PracticeProblem(question=q, answer="", distractors=[]) for q in question_texts]
            )

        # Solve a single problem — decompose + distractors
        problem = body.problem or ""
        result = await solve_problem(
            problem,
            user_id=str(user.id),
            subject=body.subject,
            image_base64=body.image_base64,
        )
        return PracticeGenerateResponse(
            problems=[PracticeProblem(
                question=result["question"],
                answer=result["answer"],
                distractors=result.get("distractors", []),
            )]
        )

    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to generate practice problems",
        )


@router.post("/check", response_model=PracticeCheckResponse)
@limiter.limit("20/minute")
async def check(
    request: Request,
    body: PracticeCheckRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PracticeCheckResponse:
    """Check if a user's answer is correct."""
    try:
        is_correct = await check_answer(
            body.question, body.correct_answer, body.user_answer,
            user_id=str(current_user.user_id), subject=body.subject,
        )
    except RuntimeError:
        logger.exception("Answer check failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to check answer",
        )
    return PracticeCheckResponse(is_correct=is_correct)
