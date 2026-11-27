"""Teacher's "I handled this" action on an integrity check — split from
integrity_check.py to keep that file under the size limit. Sets only the
check's resolution: the AI's disposition and the grade are untouched."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Submission
from api.models.integrity_check import IntegrityCheckSubmission
from api.routes.teacher_assignments import get_teacher_assignment

router = APIRouter(tags=["integrity"])


class ResolveRequest(BaseModel):
    """Teacher's session-level resolution of an integrity check. The
    outcome is what the teacher decided after reviewing — it does NOT
    change the AI's disposition. All three outcomes clear the flag from
    the roster's needs-attention aggregate."""
    resolution: Literal["cleared", "confirmed_concern", "contacted"]


class UndoResolveOut(BaseModel):
    """The resolution the undo put back ("unresolved" when the check had
    never been resolved before)."""
    resolution: str


@router.post(
    "/teacher/integrity/submissions/{submission_id}/resolve", status_code=204,
)
async def teacher_resolve_integrity(
    submission_id: uuid.UUID,
    body: ResolveRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Set the teacher's session-level resolution on an integrity check.

    This is the "I handled this" action — it does NOT touch the AI's
    disposition (the agent's verdict stands), but it clears the flag
    from the roster's needs-attention aggregate so a reviewed
    submission stops showing as flagged forever. Owner-of-course gated,
    like the other teacher integrity endpoints. Idempotent: re-resolving
    with a new outcome just updates the outcome and re-stamps who/when.
    Remembers what it replaced so `.../resolve/undo` can put it back.
    Never touches a grade."""
    check = await _owned_check(db, submission_id, current_user)
    check.prev_resolution = check.resolution
    check.prev_resolved_by = check.resolved_by
    check.prev_resolved_at = check.resolved_at
    check.resolution = body.resolution
    check.resolved_by = current_user.user_id
    check.resolved_at = datetime.now(UTC)
    await db.commit()


@router.post(
    "/teacher/integrity/submissions/{submission_id}/resolve/undo",
    response_model=UndoResolveOut,
)
async def teacher_undo_resolve_integrity(
    submission_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> UndoResolveOut:
    """Undo the latest resolve: put back exactly what it replaced — the
    outcome and who/when, or unresolved with no resolver. One level:
    a second undo (or an undo with no resolve to undo) is a 409, and so
    is undoing a resolve someone else made since — a teacher's Undo
    only ever takes back their own latest resolve. Never touches the
    AI's disposition or a grade."""
    check = await _owned_check(db, submission_id, current_user)
    if check.prev_resolution is None or check.resolved_by != current_user.user_id:
        raise HTTPException(status_code=409, detail="Nothing to undo")
    check.resolution = check.prev_resolution
    check.resolved_by = check.prev_resolved_by
    check.resolved_at = check.prev_resolved_at
    check.prev_resolution = None
    check.prev_resolved_by = None
    check.prev_resolved_at = None
    await db.commit()
    return UndoResolveOut(resolution=check.resolution)


async def _owned_check(
    db: AsyncSession, submission_id: uuid.UUID, current_user: CurrentUser,
) -> IntegrityCheckSubmission:
    """The submission's integrity check, 404 unless the teacher owns the
    course (same gate as the other teacher integrity endpoints)."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    check = (await db.execute(
        select(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == submission_id,
        )
    )).scalar_one_or_none()
    if check is None:
        raise HTTPException(status_code=404, detail="Integrity check not found")
    return check


