"""Practice endpoints: generate similar problems and check answers."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.entitlements import Entitlement, check_entitlement
from api.core.practice import check_answer, generate_practice_problems
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
    """Generate similar practice problems for a given problem."""
    await check_entitlement(db, user, Entitlement.CREATE_SESSION)
    source = body.problems if body.problems else (body.problem or "")
    try:
        problems = await generate_practice_problems(
            source, body.count,
            user_id=str(user.id), subject=body.subject,
            image_base64=body.image_base64,
        )
    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to generate practice problems",
        )

    return PracticeGenerateResponse(
        problems=[
            PracticeProblem(
                question=p["question"],
                answer=p["answer"],
                distractors=p.get("distractors", []),
            )
            for p in problems
        ],
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
