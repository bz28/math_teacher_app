"""Admin "Reports" — every teacher-filed problem report, open first.

GET  /admin/reports?status=open|resolved|all   — list, newest first
GET  /admin/reports/{id}                       — one report, in full
PATCH /admin/reports/{id}                      — resolve / reopen with a note

Read side is deliberately flat: the list carries everything the row
needs, the detail is the same shape. No student PII beyond the snapshot
the teacher already sees on their own review page.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.teacher_report import (
    REPORT_STATUS_OPEN,
    REPORT_STATUS_RESOLVED,
    REPORT_STATUSES,
    TeacherReport,
)

router = APIRouter()


class UpdateReportRequest(BaseModel):
    status: str
    resolution_note: str | None = Field(default=None, max_length=4000)


def _serialize(r: TeacherReport) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "created_at": r.created_at.isoformat(),
        "status": r.status,
        "kind": r.kind,
        "note": r.note,
        "page_url": r.page_url,
        "teacher_id": str(r.teacher_id) if r.teacher_id else None,
        "teacher_name": r.teacher_name,
        "teacher_email": r.teacher_email,
        "school_id": str(r.school_id) if r.school_id else None,
        "submission_id": str(r.submission_id) if r.submission_id else None,
        "assignment_id": str(r.assignment_id) if r.assignment_id else None,
        "assignment_title": r.assignment_title,
        "course_id": str(r.course_id) if r.course_id else None,
        "course_name": r.course_name,
        "section_id": str(r.section_id) if r.section_id else None,
        "student_id": str(r.student_id) if r.student_id else None,
        "student_name": r.student_name,
        "problem_id": str(r.problem_id) if r.problem_id else None,
        "problem_position": r.problem_position,
        "problem_question": r.problem_question,
        "ai_grade": r.ai_grade,
        "teacher_grade": r.teacher_grade,
        "resolution_note": r.resolution_note,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    }


@router.get("/reports")
async def list_reports(
    status_filter: str = Query(default=REPORT_STATUS_OPEN, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if status_filter not in (*REPORT_STATUSES, "all"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Bad status filter")
    q = select(TeacherReport).order_by(TeacherReport.created_at.desc()).limit(limit)
    if status_filter != "all":
        q = q.where(TeacherReport.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    counts: dict[str, int] = {
        row[0]: int(row[1]) for row in (await db.execute(
            select(TeacherReport.status, func.count()).group_by(TeacherReport.status)
        )).all()
    }
    return {
        "reports": [_serialize(r) for r in rows],
        "counts": {s: int(counts.get(s, 0)) for s in REPORT_STATUSES},
    }


@router.get("/reports/{report_id}")
async def get_report(
    report_id: uuid.UUID,
    _: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    r = (await db.execute(select(TeacherReport).where(TeacherReport.id == report_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return _serialize(r)


@router.patch("/reports/{report_id}")
async def update_report(
    report_id: uuid.UUID,
    body: UpdateReportRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if body.status not in REPORT_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Bad status")
    r = (await db.execute(select(TeacherReport).where(TeacherReport.id == report_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    r.status = body.status
    if body.resolution_note is not None:
        r.resolution_note = body.resolution_note.strip() or None
    if body.status == REPORT_STATUS_RESOLVED:
        r.resolved_at = datetime.now(UTC)
        r.resolved_by_id = current_user.user_id
    else:
        r.resolved_at = None
        r.resolved_by_id = None
    await db.commit()
    await db.refresh(r)
    return _serialize(r)
