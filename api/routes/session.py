"""Session endpoints: create, get, respond, similar."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.practice import generate_practice_problems
from api.core.session import (
    RateLimitError,
    SessionError,
    create_session,
    get_owned_session,
    respond_to_step,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user
from api.models.session import Session as SessionModel
from api.models.session import SessionMode, SessionStatus
from api.core.subjects import VALID_SUBJECTS
from api.schemas.session import (
    CompleteMockTestRequest,
    CreateMockTestRequest,
    CreateSessionRequest,
    RespondRequest,
    SessionHistoryItem,
    SessionHistoryResponse,
    SessionResponse,
    StepDetail,
    StepResponseSchema,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/session", tags=["session"])


def _session_to_response(session: SessionModel) -> SessionResponse:
    """Convert a Session model to a SessionResponse schema.

    In learn mode, the final step's answer is hidden while the session
    is active so students can't inspect network traffic to cheat.
    """
    steps: list[StepDetail] = []
    for i, step in enumerate(session.steps):
        detail = StepDetail(**step)
        is_final = i == len(session.steps) - 1
        if (
            session.mode == "learn"
            and is_final
            and session.status != SessionStatus.COMPLETED
        ):
            detail.final_answer = ""
        steps.append(detail)

    return SessionResponse(
        id=session.id,
        problem=session.problem,
        problem_type=session.problem_type,
        current_step=session.current_step,
        total_steps=session.total_steps,
        status=session.status,
        mode=session.mode,
        subject=getattr(session, "subject", "math"),
        steps=steps,
    )


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create(
    body: CreateSessionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    """Start a new tutoring session for a problem."""
    try:
        session = await create_session(
            db, current_user.user_id, body.problem, body.mode, current_user.role,
            subject=body.subject,
        )
    except RateLimitError as e:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(e))
    except SessionError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        logger.exception("Failed to create session")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return _session_to_response(session)


@router.get("/history", response_model=SessionHistoryResponse)
async def history(
    subject: str = Query(...),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionHistoryResponse:
    """List past learn-mode sessions for a subject."""
    if subject not in VALID_SUBJECTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}",
        )

    query = (
        select(SessionModel)
        .where(
            SessionModel.user_id == current_user.user_id,
            SessionModel.subject == subject,
            SessionModel.mode == SessionMode.LEARN,
        )
        .order_by(SessionModel.created_at.desc())
        .offset(offset)
        .limit(limit + 1)
    )
    result = await db.execute(query)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    items = [
        SessionHistoryItem(
            id=s.id,
            problem=s.problem,
            status=s.status,
            total_steps=s.total_steps,
            created_at=s.created_at,
        )
        for s in rows[:limit]
    ]
    return SessionHistoryResponse(items=items, has_more=has_more)


@router.get("/{session_id}", response_model=SessionResponse)
async def get(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    """Get the current state of a tutoring session."""
    try:
        session = await get_owned_session(db, session_id, current_user.user_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    return _session_to_response(session)


@router.post("/{session_id}/respond", response_model=StepResponseSchema)
async def respond(
    session_id: uuid.UUID,
    body: RespondRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StepResponseSchema:
    """Submit a response for the current step or request a hint."""
    try:
        session = await get_owned_session(db, session_id, current_user.user_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    try:
        result = await respond_to_step(
            db, session, body.student_response, body.request_advance,
        )
    except SessionError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    return StepResponseSchema(
        action=result.action,
        feedback=result.feedback,
        current_step=result.current_step,
        total_steps=result.total_steps,
        is_correct=result.is_correct,
    )


@router.post("/{session_id}/similar")
async def similar(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Generate a similar problem on demand (only after session is completed)."""
    try:
        session = await get_owned_session(db, session_id, current_user.user_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    if session.status != SessionStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session not completed yet")

    try:
        problems = await generate_practice_problems(
            session.problem, 1,
            user_id=str(current_user.user_id),
            subject=getattr(session, "subject", "math"),
        )
        similar = problems[0]["question"] if problems else session.problem
    except RuntimeError:
        logger.exception("Failed to generate similar problem")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to generate similar problem",
        )
    return {"similar_problem": similar}


@router.post("/mock-test", status_code=status.HTTP_201_CREATED)
async def create_mock_test(
    body: CreateMockTestRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Record a mock test session for analytics (no LLM calls)."""
    session = SessionModel(
        user_id=current_user.user_id,
        problem=body.problem,
        problem_type="mock_test",
        mode=SessionMode.MOCK_TEST,
        status=SessionStatus.ACTIVE,
        total_steps=0,
        current_step=0,
        steps=[],
        exchanges=[],
    )
    db.add(session)
    await db.commit()
    return {"id": str(session.id)}


@router.post("/mock-test/{session_id}/complete")
async def complete_mock_test(
    session_id: uuid.UUID,
    body: CompleteMockTestRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Mark a mock test session as completed with score."""
    try:
        session = await get_owned_session(db, session_id, current_user.user_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    if session.mode != SessionMode.MOCK_TEST:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a mock test session")
    if session.status == SessionStatus.COMPLETED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already completed")

    session.status = SessionStatus.COMPLETED
    session.total_steps = body.total_questions
    session.current_step = body.correct_count
    await db.commit()
    return {"status": "ok"}
