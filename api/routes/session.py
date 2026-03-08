"""Session endpoints: create, get, respond, similar."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.session import (
    RateLimitError,
    SessionError,
    StepResponse,
    create_session,
    get_session,
    respond_to_step,
)
from api.core.step_decomposition import generate_similar_problem
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user
from api.models.session import Session as SessionModel
from api.schemas.session import (
    CreateSessionRequest,
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
        result = await respond_to_step(
            db, session, body.student_response, body.request_hint,
            body.request_show_step, body.request_advance,
        )
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
        step_description=result.step_description,
    )


@router.post("/{session_id}/similar")
async def similar(
    session_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Generate a similar problem on demand (only after session is completed)."""
    try:
        session = await get_session(db, session_id)
    except SessionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if session.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session")

    if session.status != "completed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session not completed yet")

    problem = await generate_similar_problem(session.problem)
    return {"similar_problem": problem}


