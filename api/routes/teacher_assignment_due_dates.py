"""Due dates on a homework, draft or published: one for every section, or
one per section. See api/services/due_dates.py for what an edit does to
work already turned in."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import record_activity
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.routes.teacher_assignments import get_teacher_assignment
from api.services.due_dates import apply_due_dates, section_due_dates

router = APIRouter()


class DueDatesRequest(BaseModel):
    # The homework's date: every section follows it. Leave out to keep it.
    due_at: datetime | None = None
    clear_due_at: bool = False
    # A date per section, on top of (after) `due_at`.
    section_due_dates: dict[uuid.UUID, datetime] = {}
    # Report what the edit would do without saving it.
    dry_run: bool = False


class SectionDueDate(BaseModel):
    section_id: uuid.UUID
    name: str
    due_at: datetime | None


class DueDatesResponse(BaseModel):
    due_at: datetime | None
    section_due_dates: list[SectionDueDate]
    # Turn-ins that become late or stop being late.
    lateness_changed: int
    # Graded turn-ins whose score moves with the late penalty …
    grades_changed: int
    # … and of those, published ones: they show as changed until republished.
    published_grades_changed: int
    saved: bool


@router.post("/assignments/{assignment_id}/due-dates")
async def set_due_dates(
    assignment_id: uuid.UUID,
    body: DueDatesRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> DueDatesResponse:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    if a.type == "practice":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Practice sets have no due date",
        )
    dates = [body.due_at, *body.section_due_dates.values()]
    if any(d is not None and d.tzinfo is None for d in dates):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Due dates need a time zone",
        )
    set_due = body.clear_due_at or body.due_at is not None
    change = await apply_due_dates(
        db, a,
        due_at=None if body.clear_due_at else body.due_at,
        set_due=set_due,
        section_due=body.section_due_dates,
    )
    sections = [SectionDueDate(**d) for d in await section_due_dates(db, a)]
    out = DueDatesResponse(
        due_at=a.due_at,
        section_due_dates=sections,
        lateness_changed=change.lateness_changed,
        grades_changed=change.grades_changed,
        published_grades_changed=change.published_grades_changed,
        saved=not body.dry_run,
    )
    if body.dry_run:
        await db.rollback()
        return out
    await record_activity(
        db, current_user, "assignment.due_dates", "assignment", a.id,
        {
            "title": a.title,
            "due_at": a.due_at.isoformat() if a.due_at else None,
            "sections": {str(s.section_id): s.due_at.isoformat() if s.due_at else None for s in sections},
            "lateness_changed": change.lateness_changed,
        },
    )
    await db.commit()
    return out
