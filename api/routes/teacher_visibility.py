"""Teacher visibility management — control which units/docs sections can see."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.section import Section
from api.models.visibility import SectionVisibility
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


class ToggleVisibilityRequest(BaseModel):
    section_id: uuid.UUID
    target_type: str  # "unit" | "document"
    target_id: uuid.UUID


@router.get("/courses/{course_id}/visibility")
async def get_visibility(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    # Get all section IDs for this course
    section_ids = (await db.execute(
        select(Section.id).where(Section.course_id == course_id)
    )).scalars().all()

    if not section_ids:
        return {"hidden_units": {}, "hidden_docs": {}}

    # Fetch all visibility records for these sections
    rows = (await db.execute(
        select(SectionVisibility)
        .where(
            SectionVisibility.section_id.in_(section_ids),
            SectionVisibility.is_hidden.is_(True),
        )
    )).scalars().all()

    # Group by section
    hidden_units: dict[str, list[str]] = {}
    hidden_docs: dict[str, list[str]] = {}

    for r in rows:
        sid = str(r.section_id)
        tid = str(r.target_id)
        if r.target_type == "unit":
            hidden_units.setdefault(sid, []).append(tid)
        elif r.target_type == "document":
            hidden_docs.setdefault(sid, []).append(tid)

    return {"hidden_units": hidden_units, "hidden_docs": hidden_docs}


@router.post("/courses/{course_id}/visibility/toggle")
async def toggle_visibility(
    course_id: uuid.UUID,
    body: ToggleVisibilityRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    # Validate target_type
    if body.target_type not in ("unit", "document"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_type must be 'unit' or 'document'")

    # Validate section belongs to this course
    section = (await db.execute(
        select(Section).where(Section.id == body.section_id, Section.course_id == course_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found in this course")

    # Find existing record
    existing = (await db.execute(
        select(SectionVisibility).where(
            SectionVisibility.section_id == body.section_id,
            SectionVisibility.target_type == body.target_type,
            SectionVisibility.target_id == body.target_id,
        )
    )).scalar_one_or_none()

    if existing:
        # Toggle: if hidden → unhide (delete), if not hidden → hide
        if existing.is_hidden:
            await db.delete(existing)
            new_state = False
        else:
            existing.is_hidden = True
            new_state = True
    else:
        # No record = visible by default → create hidden record
        db.add(SectionVisibility(
            section_id=body.section_id,
            target_type=body.target_type,
            target_id=body.target_id,
            is_hidden=True,
        ))
        new_state = True

    await db.commit()
    return {"is_hidden": new_state}
