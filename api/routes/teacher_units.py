"""Teacher unit management — CRUD for organizing documents into units."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Document
from api.models.unit import Unit
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


class CreateUnitRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 200:
            raise ValueError("Name must be 1-200 characters")
        return v


class UpdateUnitRequest(BaseModel):
    name: str | None = None
    position: int | None = None


@router.get("/courses/{course_id}/units")
async def list_units(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    units = (await db.execute(
        select(Unit.id, Unit.name, Unit.position, Unit.created_at)
        .where(Unit.course_id == course_id)
        .order_by(Unit.position, Unit.created_at)
    )).all()
    return {"units": [{
        "id": str(u.id), "name": u.name,
        "position": u.position, "created_at": u.created_at.isoformat(),
    } for u in units]}


@router.post("/courses/{course_id}/units", status_code=status.HTTP_201_CREATED)
async def create_unit(
    course_id: uuid.UUID, body: CreateUnitRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    # Auto-assign position as max + 1
    max_pos = (await db.execute(
        select(Unit.position).where(Unit.course_id == course_id).order_by(Unit.position.desc()).limit(1)
    )).scalar_one_or_none()
    next_pos = (max_pos or 0) + 1

    unit = Unit(course_id=course_id, name=body.name, position=next_pos)
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    return {"id": str(unit.id), "name": unit.name, "position": unit.position}


@router.patch("/courses/{course_id}/units/{unit_id}")
async def update_unit(
    course_id: uuid.UUID, unit_id: uuid.UUID, body: UpdateUnitRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    unit = (await db.execute(
        select(Unit).where(Unit.id == unit_id, Unit.course_id == course_id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found")

    if body.name is not None:
        name = body.name.strip()
        if not name or len(name) > 200:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name must be 1-200 characters")
        unit.name = name
    if body.position is not None:
        unit.position = body.position

    await db.commit()
    return {"status": "ok"}


@router.delete("/courses/{course_id}/units/{unit_id}")
async def delete_unit(
    course_id: uuid.UUID, unit_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    unit = (await db.execute(
        select(Unit).where(Unit.id == unit_id, Unit.course_id == course_id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found")

    # Move documents to uncategorized (unit_id = NULL)
    await db.execute(
        update(Document).where(Document.unit_id == unit_id).values(unit_id=None)
    )
    await db.delete(unit)
    await db.commit()
    return {"status": "ok"}
