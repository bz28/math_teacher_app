"""Practice endpoints: generate similar problems and check answers."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from api.core.practice import check_answer, generate_practice_problems
from api.middleware.auth import CurrentUser, get_current_user
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
async def generate(
    body: PracticeGenerateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PracticeGenerateResponse:
    """Generate similar practice problems for a given problem."""
    try:
        problems = await generate_practice_problems(body.problem, body.count, user_id=str(current_user.user_id))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate practice problems",
        )

    return PracticeGenerateResponse(
        problems=[PracticeProblem(question=p["question"], answer=p["answer"]) for p in problems],
    )


@router.post("/check", response_model=PracticeCheckResponse)
async def check(
    body: PracticeCheckRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PracticeCheckResponse:
    """Check if a user's answer is correct."""
    is_correct = await check_answer(
        body.question, body.correct_answer, body.user_answer,
        user_id=str(current_user.user_id),
    )
    return PracticeCheckResponse(is_correct=is_correct)
