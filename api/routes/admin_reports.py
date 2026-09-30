"""Admin "Reports" — every teacher-filed problem report, open first.

GET  /admin/reports?status=open|resolved|all   — list, newest first
GET  /admin/reports/{id}                       — one report, in full

Every report carries a `page_label`: the teacher page it was filed from,
named the way the teacher saw it ("Class page · Algebra I") rather than
as a path of UUIDs.
PATCH /admin/reports/{id}                      — resolve / reopen with a note

Read side is deliberately flat: the list carries everything the row
needs, the detail is the same shape. No student PII beyond the snapshot
the teacher already sees on their own review page.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.section import Section
from api.models.teacher_report import (
    REPORT_STATUS_OPEN,
    REPORT_STATUS_RESOLVED,
    REPORT_STATUSES,
    TeacherReport,
)
from api.models.user import User

router = APIRouter()


class UpdateReportRequest(BaseModel):
    status: str
    resolution_note: str | None = Field(default=None, max_length=4000)


# The teacher web app's routes, as the console should name them. A
# sidebar report carries nothing but the URL it was filed from, and a
# path of UUIDs tells the founder nothing — so the ids are resolved to
# the names the teacher saw. Route shapes: web/src/app/(app)/school/teacher.
_UUID = r"[0-9a-fA-F-]{36}"
_ROUTES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"^/school/teacher/courses/(?P<course>{_UUID})/homework/(?P<hw>{_UUID})"
                rf"/sections/(?P<section>{_UUID})/review/?$"), "Homework review"),
    (re.compile(rf"^/school/teacher/courses/(?P<course>{_UUID})/homework/(?P<hw>{_UUID})/review/?$"),
     "Homework review"),
    (re.compile(rf"^/school/teacher/courses/(?P<course>{_UUID})/homework/(?P<hw>{_UUID})/?$"), "Homework"),
    (re.compile(rf"^/school/teacher/courses/(?P<course>{_UUID})/grades/(?P<section>{_UUID})"
                rf"/students/(?P<student>{_UUID})/?$"), "Student grades"),
    (re.compile(rf"^/school/teacher/courses/(?P<course>{_UUID})/?$"), "Class page"),
    (re.compile(r"^/school/teacher/?$"), "Teacher home"),
]
# Course-page tabs live in ?tab= (web .../courses/[id]/page.tsx TABS).
_COURSE_TABS = {
    "sections": "Sections", "materials": "Materials", "homework": "Homework",
    "practice": "Practice", "insights": "Student Insights", "submissions": "Submissions",
    "grades": "Grades", "settings": "Settings",
}


def _route_of(page_url: str | None) -> tuple[str, dict[str, uuid.UUID], str | None] | None:
    """(route label, the ids in the path, course tab) — or None when the
    URL isn't a known teacher route."""
    if not page_url:
        return None
    parsed = urlparse(page_url)
    for pattern, label in _ROUTES:
        m = pattern.match(parsed.path)
        if m:
            try:
                ids = {k: uuid.UUID(v) for k, v in m.groupdict().items()}
            except ValueError:
                return None
            tab = parse_qs(parsed.query).get("tab", [None])[0] if label == "Class page" else None
            return label, ids, _COURSE_TABS.get(tab or "")
    return None


def _generic_label(page_url: str | None) -> str:
    """A readable name for a page we don't have a route for: its last
    path segment that isn't an id ("/history" → "History")."""
    if not page_url:
        return "No page recorded"
    segments = [s for s in urlparse(page_url).path.split("/") if s]
    for seg in reversed(segments):
        if not re.fullmatch(_UUID, seg):
            return seg.replace("-", " ").replace("_", " ").capitalize()
    return "Home"


async def _page_labels(db: AsyncSession, reports: list[TeacherReport]) -> dict[uuid.UUID, str]:
    """A readable "where" for each report's page_url, names resolved in
    one query per table however many reports there are."""
    routes = {r.id: _route_of(r.page_url) for r in reports}
    wanted: dict[str, set[uuid.UUID]] = {"course": set(), "hw": set(), "section": set(), "student": set()}
    for route in routes.values():
        if route:
            for key, value in route[1].items():
                wanted[key].add(value)

    async def names(model: Any, column: Any, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not ids:
            return {}
        rows = (await db.execute(select(model.id, column).where(model.id.in_(ids)))).all()
        return {row[0]: row[1] for row in rows if row[1]}

    found = {
        "course": await names(Course, Course.name, wanted["course"]),
        "hw": await names(Assignment, Assignment.title, wanted["hw"]),
        "section": await names(Section, Section.name, wanted["section"]),
        "student": await names(User, User.name, wanted["student"]),
    }
    labels: dict[uuid.UUID, str] = {}
    for r in reports:
        route = routes[r.id]
        if route is None:
            labels[r.id] = _generic_label(r.page_url)
            continue
        label, ids, tab = route
        # The most specific names first: the homework, then its class.
        order = ("hw", "section") if "hw" in ids else ("course", "section", "student")
        parts = [label, *(found[k][ids[k]] for k in order if k in ids and ids[k] in found[k])]
        if tab:
            parts.append(tab)
        labels[r.id] = " · ".join(parts)
    return labels


def _serialize(r: TeacherReport, page_label: str | None = None) -> dict[str, Any]:
    return {
        "page_label": page_label,
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
    labels = await _page_labels(db, list(rows))
    return {
        "reports": [_serialize(r, labels[r.id]) for r in rows],
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
    return _serialize(r, (await _page_labels(db, [r]))[r.id])


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
    return _serialize(r, (await _page_labels(db, [r]))[r.id])
