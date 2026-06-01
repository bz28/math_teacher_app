"""Admin endpoints for querying FERPA + admin audit logs.

Surfaces both logs to the internal dashboard:
- GET /admin/audit-logs/student-access — every teacher/admin read of a
  student record. The canonical query a district lawyer or
  procurement officer asks for: "show me everyone who touched
  student X's records." Filterable by target student, accessor, or
  record type.
- GET /admin/audit-logs/admin-actions — every administrative write
  (delete, role change, export, etc.). Filterable by action name
  (supports "user.*" prefix glob) or accessor.

Both endpoints are paginated, admin-only, and return display-friendly
joins (names + emails for the involved users) so the dashboard
doesn't have to do follow-up lookups per row.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.admin_audit_log import AdminAuditLog
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User

router = APIRouter()


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


@router.get("/audit-logs/admin-actions")
async def admin_action_log(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    admin_user_id: uuid.UUID | None = Query(None),
    action: str | None = Query(
        None,
        description='Exact action ("user.delete") or prefix glob ("user.*").',
    ),
    target_type: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Paginated admin action log."""
    base = select(AdminAuditLog)
    if admin_user_id is not None:
        base = base.where(AdminAuditLog.admin_user_id == admin_user_id)
    if action:
        if action.endswith(".*"):
            base = base.where(AdminAuditLog.action.like(f"{action[:-1]}%"))
        else:
            base = base.where(AdminAuditLog.action == action)
    if target_type:
        base = base.where(AdminAuditLog.target_type == target_type)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0

    rows = (
        await db.execute(
            base.order_by(AdminAuditLog.performed_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    ids: set[uuid.UUID] = {r.admin_user_id for r in rows if r.admin_user_id}
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
                "admin_user_id": str(r.admin_user_id) if r.admin_user_id else None,
                "admin_name": _display(r.admin_user_id)["name"],
                "admin_email": _display(r.admin_user_id)["email"],
                "admin_role": r.admin_role,
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
