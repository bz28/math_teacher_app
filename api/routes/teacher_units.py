"""Teacher unit management — CRUD for organizing documents into units.

Units form a 2-level tree: top-level units (parent_unit_id IS NULL) and
optional subfolders one level deep. The depth limit is enforced here in
the route layer; the schema is permissive."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Document
from api.models.unit import Unit
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


class CreateUnitRequest(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None

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
    parent_id: uuid.UUID | None = None
    clear_parent: bool = False  # Set to True to move a subfolder back to top level


async def _get_unit_in_course(db: AsyncSession, unit_id: uuid.UUID, course_id: uuid.UUID) -> Unit:
    unit = (await db.execute(
        select(Unit).where(Unit.id == unit_id, Unit.course_id == course_id)
    )).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found")
    return unit


@router.get("/courses/{course_id}/units")
async def list_units(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    units = (await db.execute(
        select(Unit.id, Unit.name, Unit.position, Unit.parent_unit_id, Unit.created_at)
        .where(Unit.course_id == course_id)
        .order_by(Unit.position, Unit.created_at)
    )).all()
    return {"units": [{
        "id": str(u.id), "name": u.name,
        "position": u.position,
        "parent_id": str(u.parent_unit_id) if u.parent_unit_id else None,
        "created_at": u.created_at.isoformat(),
    } for u in units]}


@router.post("/courses/{course_id}/units", status_code=status.HTTP_201_CREATED)
async def create_unit(
    course_id: uuid.UUID, body: CreateUnitRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    # If a parent is specified, it must exist in the same course AND be a top-level unit.
    # We allow only 2 levels: parent (top-level) -> child (subfolder).
    if body.parent_id is not None:
        parent = await _get_unit_in_course(db, body.parent_id, course_id)
        if parent.parent_unit_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subfolders cannot contain subfolders (max 2 levels)",
            )

    # Position is auto-assigned among siblings (same parent in same course)
    max_pos = (await db.execute(
        select(Unit.position)
        .where(Unit.course_id == course_id, Unit.parent_unit_id == body.parent_id)
        .order_by(Unit.position.desc()).limit(1)
    )).scalar_one_or_none()
    next_pos = (max_pos or 0) + 1

    unit = Unit(
        course_id=course_id,
        parent_unit_id=body.parent_id,
        name=body.name,
        position=next_pos,
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    return {
        "id": str(unit.id), "name": unit.name,
        "position": unit.position,
        "parent_id": str(unit.parent_unit_id) if unit.parent_unit_id else None,
    }


@router.patch("/courses/{course_id}/units/{unit_id}")
async def update_unit(
    course_id: uuid.UUID, unit_id: uuid.UUID, body: UpdateUnitRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    unit = await _get_unit_in_course(db, unit_id, course_id)

    if body.name is not None:
        name = body.name.strip()
        if not name or len(name) > 200:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name must be 1-200 characters")
        unit.name = name

    if body.position is not None:
        unit.position = body.position

    # Handle move (parent change)
    if body.clear_parent:
        # Moving back to top level — only allowed if this unit has no children itself
        child_count = (await db.execute(
            select(Unit.id).where(Unit.parent_unit_id == unit_id).limit(1)
        )).scalar_one_or_none()
        if child_count is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move a folder with subfolders",
            )
        unit.parent_unit_id = None
    elif body.parent_id is not None:
        if body.parent_id == unit_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A unit cannot be its own parent")
        parent = await _get_unit_in_course(db, body.parent_id, course_id)
        if parent.parent_unit_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subfolders cannot contain subfolders (max 2 levels)",
            )
        # Block moving a parent (which has children) into another folder — would exceed depth
        child_count = (await db.execute(
            select(Unit.id).where(Unit.parent_unit_id == unit_id).limit(1)
        )).scalar_one_or_none()
        if child_count is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move a folder with subfolders into another folder",
            )
        unit.parent_unit_id = body.parent_id

    await db.commit()
    return {"status": "ok"}


@router.delete("/courses/{course_id}/units/{unit_id}")
async def delete_unit(
    course_id: uuid.UUID, unit_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Block deletion if any documents or bank items still reference
    this unit (or one of its subfolders). Teachers move them with the
    existing move-dialog before deleting the unit. Replaces the older
    "reassign-to-Uncategorized" fallback now that every doc/item must
    have a real unit. Subfolders themselves are still removed via
    ON DELETE CASCADE on parent_unit_id, but only after we confirm
    they're empty too."""
    from api.models.question_bank import QuestionBankItem
    await get_teacher_course(db, course_id, current_user.user_id)
    unit = await _get_unit_in_course(db, unit_id, course_id)

    subfolder_ids = [
        r[0] for r in (await db.execute(
            select(Unit.id).where(Unit.parent_unit_id == unit_id)
        )).all()
    ]
    affected_unit_ids = [unit_id, *subfolder_ids]

    doc_count = (await db.execute(
        select(func.count()).select_from(Document)
        .where(Document.unit_id.in_(affected_unit_ids))
    )).scalar_one()
    item_count = (await db.execute(
        select(func.count()).select_from(QuestionBankItem)
        .where(QuestionBankItem.unit_id.in_(affected_unit_ids))
    )).scalar_one()
    if doc_count or item_count:
        parts = []
        if doc_count:
            parts.append(f"{doc_count} document{'s' if doc_count != 1 else ''}")
        if item_count:
            parts.append(f"{item_count} question{'s' if item_count != 1 else ''}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Move {' and '.join(parts)} out of this unit before deleting it."
            ),
        )

    await db.delete(unit)
    await db.commit()
    return {"status": "ok"}
