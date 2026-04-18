"""Teacher-level preferences (UI-configurable defaults).

Today the surface is minimal — auto-generate practice on publish and
default practice count. Extensible; more fields can land on User and
surface here without changing the endpoint shape beyond the Pydantic
schema.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.user import User

router = APIRouter()


class TeacherPreferencesResponse(BaseModel):
    auto_generate_practice_on_publish: bool
    default_practice_count: int


class UpdateTeacherPreferencesRequest(BaseModel):
    # Both fields optional — PATCH semantics. Pass only what changes.
    auto_generate_practice_on_publish: bool | None = None
    default_practice_count: int | None = Field(default=None, ge=1, le=20)


@router.get("/preferences", response_model=TeacherPreferencesResponse)
async def get_preferences(
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> TeacherPreferencesResponse:
    user = (await db.execute(
        select(User).where(User.id == current_user.user_id)
    )).scalar_one()
    return TeacherPreferencesResponse(
        auto_generate_practice_on_publish=user.auto_generate_practice_on_publish,
        default_practice_count=user.default_practice_count,
    )


@router.patch("/preferences", response_model=TeacherPreferencesResponse)
async def update_preferences(
    body: UpdateTeacherPreferencesRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> TeacherPreferencesResponse:
    user = (await db.execute(
        select(User).where(User.id == current_user.user_id)
    )).scalar_one()
    if body.auto_generate_practice_on_publish is not None:
        user.auto_generate_practice_on_publish = body.auto_generate_practice_on_publish
    if body.default_practice_count is not None:
        if not 1 <= body.default_practice_count <= 20:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="default_practice_count must be between 1 and 20",
            )
        user.default_practice_count = body.default_practice_count
    await db.commit()
    return TeacherPreferencesResponse(
        auto_generate_practice_on_publish=user.auto_generate_practice_on_publish,
        default_practice_count=user.default_practice_count,
    )
