"""FERPA / admin audit-log helpers.

Two related logs:
- `log_student_record_access` — every teacher/admin read of a student
  record. Powers FERPA disclosure-tracking reports.
- `log_admin_action` — every admin write (delete, role change, export,
  etc.). Powers procurement-required admin activity reports.

Both helpers are designed to be called from inside route handlers
after authorization has already been confirmed. They add a row to
the caller's existing transaction without flushing or committing, so
the log lives or dies with the surrounding work — if the request
rolls back, the audit entry rolls back too (we don't want to log
accesses that didn't actually return data).

Helpers never raise: a transient DB error in the audit write must not
break the underlying request. Failures are logged and dropped.
"""

import logging
import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.admin_audit_log import AdminAuditLog
from api.models.student_record_access_log import StudentRecordAccessLog

logger = logging.getLogger(__name__)


def _client_ip(request: Request | None) -> str | None:
    """Best-effort client IP. Falls back through X-Forwarded-For when
    we're behind a proxy (Railway / Vercel set this) to the direct
    connection address. Truncated to 45 chars for IPv6 column width.
    """
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    if request.client and request.client.host:
        return request.client.host[:45]
    return None


def _as_uuid(value: uuid.UUID | str | None) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


async def log_student_record_access(
    db: AsyncSession,
    *,
    accessor_user_id: uuid.UUID | str,
    accessor_role: str,
    target_student_id: uuid.UUID | str | None,
    record_type: str,
    record_id: uuid.UUID | str | None = None,
    accessor_school_id: uuid.UUID | str | None = None,
    request: Request | None = None,
) -> None:
    """Record one teacher/admin read of a student record.

    Caller is responsible for committing the surrounding transaction.
    """
    try:
        entry = StudentRecordAccessLog(
            accessor_user_id=_as_uuid(accessor_user_id),
            accessor_role=accessor_role,
            target_student_id=_as_uuid(target_student_id),
            record_type=record_type,
            record_id=_as_uuid(record_id),
            school_id=_as_uuid(accessor_school_id),
            ip_address=_client_ip(request),
        )
        db.add(entry)
    except Exception:
        logger.exception("Failed to log student record access")


async def log_admin_action(
    db: AsyncSession,
    *,
    admin_user_id: uuid.UUID | str,
    admin_role: str,
    action: str,
    target_type: str,
    target_id: uuid.UUID | str | None = None,
    metadata: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """Record one administrative action.

    Caller is responsible for committing the surrounding transaction.
    """
    try:
        entry = AdminAuditLog(
            admin_user_id=_as_uuid(admin_user_id),
            admin_role=admin_role,
            action=action,
            target_type=target_type,
            target_id=_as_uuid(target_id),
            action_metadata=metadata,
            ip_address=_client_ip(request),
        )
        db.add(entry)
    except Exception:
        logger.exception("Failed to log admin action")
