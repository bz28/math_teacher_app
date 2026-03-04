"""Session endpoints: create, get, respond, explain-back."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.session import (
    RateLimitError,
    SessionError,
    StepResponse,
    create_session,
    get_session,
    handle_explain_back,
    respond_to_step,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user
from api.models.session import Session as SessionModel
from api.schemas.session import (
    CreateSessionRequest,
    ExplainBackRequest,
    RespondRequest,
    SessionResponse,
    StepDetail,
    StepResponseSchema,
    StepTrackingInfo,
)

router = APIRouter(prefix="/session", tags=["session"])


def _session_to_response(session: SessionModel) -> SessionResponse:
    """Convert a Session model to a SessionResponse schema."""
    s = session
    return SessionResponse(
        id=s.id,
        problem=s.problem,
        problem_type=s.problem_type,
        current_step=s.current_step,
        total_steps=s.total_steps,
        status=s.status,
        mode=s.mode,
        steps=[StepDetail(**step) for step in s.steps],
        step_tracking={
            k: StepTrackingInfo(**v) for k, v in s.step_tracking.items()
        },
    )


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create(
    body: CreateSessionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    """Start a new tutoring session for a problem."""
    try:
        session = await create_session(db, current_user.user_id, body.problem, body.mode)
    except RateLimitError as e:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    return _session_to_response(session)


@router.get("/{session_id}", response_model=SessionResponse)
async def get(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    """Get the current state of a tutoring session."""
    try:
        session = await get_session(db, session_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if session.user_id != current_user.user_id:
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
        session = await get_session(db, session_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if session.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    try:
        result = await respond_to_step(db, session, body.student_response, body.request_hint)
    except SessionError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not isinstance(result, StepResponse):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unexpected response type")

    return StepResponseSchema(
        action=result.action,
        feedback=result.feedback,
        current_step=result.current_step,
        total_steps=result.total_steps,
        is_correct=result.is_correct,
        similar_problem=result.similar_problem,
    )


@router.post("/{session_id}/explain-back", response_model=StepResponseSchema)
async def explain_back(
    session_id: uuid.UUID,
    body: ExplainBackRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StepResponseSchema:
    """Submit an explain-back response for the current step."""
    try:
        session = await get_session(db, session_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if session.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    try:
        result = await handle_explain_back(db, session, body.student_explanation)
    except SessionError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return StepResponseSchema(
        action=result.action,
        feedback=result.feedback,
        current_step=result.current_step,
        total_steps=result.total_steps,
        is_correct=result.is_correct,
        similar_problem=result.similar_problem,
    )
