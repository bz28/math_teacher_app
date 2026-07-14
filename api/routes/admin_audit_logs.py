"""Admin endpoints for querying FERPA + activity logs.

Surfaces both logs to the internal dashboard:
- GET /admin/audit-logs/student-access — every teacher/admin read of a
  student record. The canonical query a district lawyer or
  procurement officer asks for: "show me everyone who touched
  student X's records." Filterable by target student, accessor, or
  record type.
- GET /admin/activity — every notable actor write (admin OR teacher):
  assignment/generation/grade mutations, deletes, role changes, etc.
  Filterable by actor, actor role, action name (supports "grade.*"
  prefix glob), target type, school, and time window. Powers both the
  AuditLogs page and the per-teacher observability hub.

- GET /admin/audit-logs/timeline — the two logs above MERGED into one
  chronological stream with an access/write facet, so a FERPA
  record-read and the write that caused it sit side by side. Powers the
  redesigned compliance surface: date-range window, actor/target
  name-or-email search, school scope, facet + type filters, and a
  headline summary (total events, distinct actors, top action,
  events-per-day, distinct students accessed).
- GET /admin/audit-logs/timeline/export.csv — the same merged, filtered
  stream as a downloadable CSV. The compliance deliverable an operator
  hands a district: one filtered trail, one file.

All endpoints are paginated, admin-only, and return display-friendly
joins (names + emails for the involved users) so the dashboard
doesn't have to do follow-up lookups per row.
"""

import csv
import io
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import String, cast, distinct, func, literal, null, or_, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.selectable import Subquery

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.activity_log import ActivityLog
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])


async def _name_map(
    db: AsyncSession, user_ids: set[uuid.UUID]
) -> dict[str, dict[str, str | None]]:
    """Bulk-resolve user_ids to {name, email} for display in audit rows."""
    if not user_ids:
        return {}
    result = await db.execute(
        select(User.id, User.name, User.email).where(User.id.in_(user_ids))
    )
    return {
        str(r.id): {"name": r.name, "email": r.email} for r in result.all()
    }


@router.get("/audit-logs/student-access")
async def student_access_log(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    target_student_id: uuid.UUID | None = Query(None),
    accessor_user_id: uuid.UUID | None = Query(None),
    record_type: str | None = Query(None),
    school_id: uuid.UUID | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Paginated FERPA student-record access log.

    The (target_student_id, accessed_at) composite index makes the
    canonical "all access to one student" query a fast indexed range
    scan even at scale.
    """
    base = select(StudentRecordAccessLog)
    if target_student_id is not None:
        base = base.where(StudentRecordAccessLog.target_student_id == target_student_id)
    if accessor_user_id is not None:
        base = base.where(StudentRecordAccessLog.accessor_user_id == accessor_user_id)
    if record_type:
        base = base.where(StudentRecordAccessLog.record_type == record_type)
    if school_id is not None:
        base = base.where(StudentRecordAccessLog.school_id == school_id)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0

    rows = (
        await db.execute(
            base.order_by(StudentRecordAccessLog.accessed_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    ids: set[uuid.UUID] = set()
    for r in rows:
        if r.accessor_user_id:
            ids.add(r.accessor_user_id)
        if r.target_student_id:
            ids.add(r.target_student_id)
    names = await _name_map(db, ids)

    def _display(uid: uuid.UUID | None) -> dict[str, str | None]:
        if uid is None:
            return {"name": None, "email": None}
        return names.get(str(uid), {"name": None, "email": None})

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "entries": [
            {
                "id": str(r.id),
                "accessor_user_id": str(r.accessor_user_id) if r.accessor_user_id else None,
                "accessor_name": _display(r.accessor_user_id)["name"],
                "accessor_email": _display(r.accessor_user_id)["email"],
                "accessor_role": r.accessor_role,
                "target_student_id": str(r.target_student_id) if r.target_student_id else None,
                "target_student_name": _display(r.target_student_id)["name"],
                "record_type": r.record_type,
                "record_id": str(r.record_id) if r.record_id else None,
                "school_id": str(r.school_id) if r.school_id else None,
                "ip_address": r.ip_address,
                "accessed_at": r.accessed_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/activity")
async def activity_log(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    actor_user_id: uuid.UUID | None = Query(None),
    actor_role: str | None = Query(None, description='"admin" or "teacher".'),
    action: str | None = Query(
        None,
        description='Exact action ("grade.publish") or prefix glob ("grade.*").',
    ),
    target_type: str | None = Query(None),
    school_id: uuid.UUID | None = Query(None),
    hours: int | None = Query(None, ge=1, le=8760, description="Time window."),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Paginated role-agnostic activity log (admin + teacher writes)."""
    base = select(ActivityLog)
    if actor_user_id is not None:
        base = base.where(ActivityLog.actor_user_id == actor_user_id)
    if actor_role:
        base = base.where(ActivityLog.actor_role == actor_role)
    if action:
        if action.endswith(".*"):
            base = base.where(ActivityLog.action.like(f"{action[:-1]}%"))
        else:
            base = base.where(ActivityLog.action == action)
    if target_type:
        base = base.where(ActivityLog.target_type == target_type)
    if school_id is not None:
        base = base.where(ActivityLog.school_id == school_id)
    if hours is not None:
        since = datetime.now(UTC) - timedelta(hours=hours)
        base = base.where(ActivityLog.performed_at >= since)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0

    rows = (
        await db.execute(
            base.order_by(ActivityLog.performed_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    ids: set[uuid.UUID] = {r.actor_user_id for r in rows if r.actor_user_id}
    names = await _name_map(db, ids)

    def _display(uid: uuid.UUID | None) -> dict[str, str | None]:
        if uid is None:
            return {"name": None, "email": None}
        return names.get(str(uid), {"name": None, "email": None})

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "entries": [
            {
                "id": str(r.id),
                "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                "actor_name": _display(r.actor_user_id)["name"],
                "actor_email": _display(r.actor_user_id)["email"],
                "actor_role": r.actor_role,
                "school_id": str(r.school_id) if r.school_id else None,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": str(r.target_id) if r.target_id else None,
                "metadata": r.action_metadata,
                "ip_address": r.ip_address,
                "performed_at": r.performed_at.isoformat(),
            }
            for r in rows
        ],
    }


# ── Merged timeline (access ∪ write) ───────────────────────────────
#
# The two logs above are separate tables with different shapes. The
# compliance surface needs them interleaved on one clock so a
# record-read and the write that caused it read together. We normalize
# both into a common column set, UNION ALL them, and order by time —
# one indexed query does pagination, counts, and the summary rollups.

_ACCESS = "access"
_WRITE = "write"
_CSV_ROW_CAP = 100_000


class TimelineFilters:
    """Shared query params for the merged timeline and its CSV export.

    Used as a FastAPI dependency (`Depends()`) so both endpoints declare
    the identical filter surface exactly once.
    """

    def __init__(
        self,
        hours: int | None = Query(
            None, ge=1, le=8760, description="Time window in hours; omit for all-time."
        ),
        q: str | None = Query(
            None,
            description="Name/email substring (or a pasted UUID) matching the "
            "actor OR the target student — replaces the UUID-only inputs.",
        ),
        school_id: uuid.UUID | None = Query(None),
        facet: str | None = Query(
            None,
            description='"access" (record reads) or "write" (actions); omit for both.',
        ),
        type_filter: str | None = Query(
            None,
            alias="type",
            description="Prefix match on the write action or the access record "
            'type (e.g. "grade" or "grade.publish").',
        ),
        target_id: uuid.UUID | None = Query(
            None,
            description="Pivot to every event touching this record or student.",
        ),
    ) -> None:
        self.hours = hours
        self.q = (q or "").strip() or None
        self.school_id = school_id
        self.facet = facet if facet in (_ACCESS, _WRITE) else None
        self.type_filter = (type_filter or "").strip() or None
        self.target_id = target_id


async def _resolve_actor_ids(db: AsyncSession, q: str | None) -> set[uuid.UUID] | None:
    """Resolve a name/email substring (or pasted UUID) to matching user ids.

    None means "no search"; an empty set means "searched, matched nobody"
    (so the timeline correctly comes back empty rather than unfiltered).
    """
    if not q:
        return None
    ids: set[uuid.UUID] = set()
    try:
        ids.add(uuid.UUID(q))
    except ValueError:
        pass
    like = f"%{q}%"
    rows = await db.execute(
        select(User.id).where(or_(User.name.ilike(like), User.email.ilike(like)))
    )
    ids.update(r[0] for r in rows.all())
    return ids


async def _build_timeline_subquery(
    db: AsyncSession, f: TimelineFilters
) -> Subquery:
    """Normalize both logs into one UNION ALL subquery under the filters."""
    q_ids = await _resolve_actor_ids(db, f.q)
    since = datetime.now(UTC) - timedelta(hours=f.hours) if f.hours is not None else None
    # Tolerate the "grade.*" glob the old activity filter accepted.
    prefix = f.type_filter[:-2] if f.type_filter and f.type_filter.endswith(".*") else f.type_filter

    branches = []

    if f.facet != _WRITE:
        a = StudentRecordAccessLog
        acc = select(
            literal(_ACCESS).label("facet"),
            a.id.label("id"),
            a.accessor_user_id.label("actor_user_id"),
            a.accessor_role.label("actor_role"),
            a.school_id.label("school_id"),
            a.ip_address.label("ip_address"),
            a.accessed_at.label("at"),
            cast(null(), String).label("action"),
            a.record_type.label("record_type"),
            cast(null(), String).label("target_type"),
            a.record_id.label("target_id"),
            a.target_student_id.label("target_student_id"),
            cast(null(), JSONB).label("metadata"),
        )
        conds = []
        if since is not None:
            conds.append(a.accessed_at >= since)
        if f.school_id is not None:
            conds.append(a.school_id == f.school_id)
        if q_ids is not None:
            conds.append(
                or_(a.accessor_user_id.in_(q_ids), a.target_student_id.in_(q_ids))
            )
        if prefix:
            conds.append(a.record_type.ilike(f"{prefix}%"))
        if f.target_id is not None:
            conds.append(
                or_(a.record_id == f.target_id, a.target_student_id == f.target_id)
            )
        if conds:
            acc = acc.where(*conds)
        branches.append(acc)

    if f.facet != _ACCESS:
        w = ActivityLog
        wr = select(
            literal(_WRITE).label("facet"),
            w.id.label("id"),
            w.actor_user_id.label("actor_user_id"),
            w.actor_role.label("actor_role"),
            w.school_id.label("school_id"),
            w.ip_address.label("ip_address"),
            w.performed_at.label("at"),
            w.action.label("action"),
            cast(null(), String).label("record_type"),
            w.target_type.label("target_type"),
            w.target_id.label("target_id"),
            cast(null(), PGUUID(as_uuid=True)).label("target_student_id"),
            w.action_metadata.label("metadata"),
        )
        conds = []
        if since is not None:
            conds.append(w.performed_at >= since)
        if f.school_id is not None:
            conds.append(w.school_id == f.school_id)
        if q_ids is not None:
            conds.append(w.actor_user_id.in_(q_ids))
        if prefix:
            conds.append(w.action.ilike(f"{prefix}%"))
        if f.target_id is not None:
            conds.append(w.target_id == f.target_id)
        if conds:
            wr = wr.where(*conds)
        branches.append(wr)

    if len(branches) == 1:
        return branches[0].subquery("timeline")
    return union_all(*branches).subquery("timeline")


def _timeline_entry(
    r: Any, disp: Any
) -> dict[str, Any]:
    actor = disp(r.actor_user_id)
    return {
        "id": str(r.id),
        "facet": r.facet,
        "at": r.at.isoformat(),
        "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
        "actor_name": actor["name"],
        "actor_email": actor["email"],
        "actor_role": r.actor_role,
        "school_id": str(r.school_id) if r.school_id else None,
        "action": r.action,
        "record_type": r.record_type,
        "target_type": r.target_type,
        "target_id": str(r.target_id) if r.target_id else None,
        "target_student_id": str(r.target_student_id) if r.target_student_id else None,
        "target_student_name": disp(r.target_student_id)["name"],
        "ip_address": r.ip_address,
        "metadata": r.metadata,
    }


@router.get("/audit-logs/timeline")
async def audit_timeline(
    filters: TimelineFilters = Depends(),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Merged access+write audit timeline with a scope summary."""
    sub = await _build_timeline_subquery(db, filters)

    # One pass for the headline counts; `total` also drives pagination.
    total, distinct_actors, distinct_students = (
        await db.execute(
            select(
                func.count(),
                func.count(distinct(sub.c.actor_user_id)),
                func.count(distinct(sub.c.target_student_id)),
            ).select_from(sub)
        )
    ).one()

    # Top unified action ("grade.publish" for writes, "read:grades" for reads).
    action_label = func.coalesce(sub.c.action, func.concat("read:", sub.c.record_type))
    top = (
        await db.execute(
            select(action_label.label("label"), func.count().label("n"))
            .select_from(sub)
            .group_by(action_label)
            .order_by(func.count().desc())
            .limit(1)
        )
    ).first()

    # Events per day for the sparkline (oldest → newest).
    day = func.date_trunc("day", sub.c.at)
    by_day = (
        await db.execute(
            select(day.label("day"), func.count().label("n"))
            .select_from(sub)
            .group_by(day)
            .order_by(day)
        )
    ).all()

    rows = (
        await db.execute(
            select(sub).order_by(sub.c.at.desc()).limit(limit).offset(offset)
        )
    ).all()

    ids: set[uuid.UUID] = set()
    for r in rows:
        if r.actor_user_id:
            ids.add(r.actor_user_id)
        if r.target_student_id:
            ids.add(r.target_student_id)
    names = await _name_map(db, ids)

    def _disp(uid: uuid.UUID | None) -> dict[str, str | None]:
        if uid is None:
            return {"name": None, "email": None}
        return names.get(str(uid), {"name": None, "email": None})

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "summary": {
            "total": total,
            "distinct_actors": distinct_actors,
            "distinct_students": distinct_students,
            "top_action": top.label if top else None,
            "top_action_count": top.n if top else 0,
            "by_day": [
                {"day": d.day.date().isoformat(), "count": d.n} for d in by_day
            ],
        },
        "entries": [_timeline_entry(r, _disp) for r in rows],
    }


@router.get("/audit-logs/timeline/export.csv")
async def audit_timeline_csv(
    filters: TimelineFilters = Depends(),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The current filtered timeline as a CSV — the compliance deliverable."""
    sub = await _build_timeline_subquery(db, filters)
    rows = (
        await db.execute(
            select(sub).order_by(sub.c.at.desc()).limit(_CSV_ROW_CAP)
        )
    ).all()

    ids: set[uuid.UUID] = set()
    for r in rows:
        if r.actor_user_id:
            ids.add(r.actor_user_id)
        if r.target_student_id:
            ids.add(r.target_student_id)
    names = await _name_map(db, ids)

    def _field(uid: uuid.UUID | None, key: str) -> str:
        if uid is None:
            return ""
        return names.get(str(uid), {}).get(key) or ""

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Timestamp (UTC)",
            "Facet",
            "Actor",
            "Actor email",
            "Actor role",
            "Action / record type",
            "Target type",
            "Target ID",
            "Target student",
            "Target student ID",
            "IP address",
            "School ID",
            "Metadata",
        ]
    )
    for r in rows:
        label = r.action or (f"read:{r.record_type}" if r.record_type else "")
        writer.writerow(
            [
                r.at.isoformat(),
                r.facet,
                _field(r.actor_user_id, "name"),
                _field(r.actor_user_id, "email"),
                r.actor_role or "",
                label,
                r.target_type or "",
                str(r.target_id) if r.target_id else "",
                _field(r.target_student_id, "name"),
                str(r.target_student_id) if r.target_student_id else "",
                r.ip_address or "",
                str(r.school_id) if r.school_id else "",
                json.dumps(r.metadata) if r.metadata else "",
            ]
        )

    # UTF-8 BOM so Excel reads accented names correctly (matches the
    # gradebook export in teacher_grades.py).
    csv_text = "﻿" + output.getvalue()
    filename = f"audit-timeline-{datetime.now(UTC).date().isoformat()}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
