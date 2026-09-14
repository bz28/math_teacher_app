"""Record homework uploads the platform turned away.

A rejected upload writes no submission row, so until now it left no
trace at all: a student blocked eleven times over two days by our own
size cap looked, in every dashboard, exactly like a student who never
opened the assignment. This module gives the rejection a row in the
activity log — ``"submission.rejected"`` — so the operator can see a
person being failed by the platform, not silence.

Two entry points, because rejections happen in two places:

- `record_submission_rejection` — the handler path. The route has
  authenticated the student and knows exactly what was wrong (a bad
  file, a file over its cap, a whole submission over the total).
- `note_transport_rejection` — the middleware path. The request-size
  limit rejects an oversized body BEFORE any handler runs, so nothing
  downstream knows it happened. The middleware hands us the ASGI scope;
  we recognise the submit route by path and read the bearer token to
  name the student. The token is decoded only on this cold path, never
  per request, so attribution costs nothing on the hot path.

Both write through their own session and never raise: a logging
failure must not change what the student is told.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import MutableMapping
from typing import Any

from sqlalchemy import select

from api.core.auth import decode_access_token
from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.user import User

logger = logging.getLogger(__name__)

# Why the upload was refused. One vocabulary for both paths so the
# dashboard can count them side by side.
REASON_UPLOAD_TOO_LARGE = "upload_too_large"        # transport cap, pre-handler
REASON_FILE_TOO_LARGE = "file_too_large"            # one file over its format cap
REASON_FILE_INVALID = "file_invalid"                # not a JPEG / PNG / PDF, or bad base64
REASON_SUBMISSION_TOO_LARGE = "submission_too_large"  # decoded total over the cap

# The one route whose rejection is a student being blocked from turning
# in homework. Anchored so a practice or tutor upload never lands here.
_SUBMIT_PATH = re.compile(
    r"^/v1/school/student/homework/(?P<assignment_id>[0-9a-fA-F-]{36})/submit/?$"
)


def reason_for_file_error(message: str) -> str:
    """Map `validate_and_decode_upload`'s ValueError onto a reason.

    The validator raises one exception type with a human message, and
    the size message is the only one that starts with "File too large".
    Matching the prefix here keeps the validator's public surface (and
    the message the student sees) untouched.
    """
    return (
        REASON_FILE_TOO_LARGE
        if message.startswith("File too large")
        else REASON_FILE_INVALID
    )


async def record_submission_rejection(
    *,
    actor_user_id: uuid.UUID | None,
    assignment_id: uuid.UUID | None,
    reason: str,
    request_bytes: int | None,
    decoded_bytes: int | None = None,
    detail: str | None = None,
    ip_address: str | None = None,
) -> None:
    """One activity-log row per rejected homework upload:
    ``"submission.rejected"``, targeting the assignment the student was
    trying to turn in.

    `actor_user_id` is null when the rejection happened before
    authentication AND the bearer token could not be read — the row
    still counts, marked unattributed on the dashboard. `request_bytes`
    is the transport size (base64 JSON, what the cap measured);
    `decoded_bytes` is the sum of the decoded files when the handler got
    far enough to know it.

    Opens its own session: the handler that calls this is about to
    raise, and its request session rolls back with it.
    """
    try:
        async with get_session_factory()() as db:
            school_id: uuid.UUID | None = None
            if assignment_id is not None:
                school_id = (await db.execute(
                    select(Course.school_id)
                    .join(Assignment, Assignment.course_id == Course.id)
                    .where(Assignment.id == assignment_id)
                )).scalar_one_or_none()

            metadata: dict[str, Any] = {
                "reason": reason,
                "request_bytes": request_bytes,
                "decoded_bytes": decoded_bytes,
                "detail": (detail or "")[:200] or None,
            }
            if actor_user_id is not None:
                # A teacher rehearsing as a preview student can be
                # blocked too; the row is kept but flagged so it never
                # counts as a child who couldn't turn in homework.
                is_preview = (await db.execute(
                    select(User.is_preview).where(User.id == actor_user_id)
                )).scalar_one_or_none()
                metadata["is_preview"] = bool(is_preview)

            db.add(ActivityLog(
                actor_user_id=actor_user_id,
                actor_role="student",
                school_id=school_id,
                action="submission.rejected",
                target_type="assignment",
                target_id=assignment_id,
                action_metadata=metadata,
                ip_address=(ip_address or None) and ip_address[:45],
            ))
            await db.commit()
    except Exception:
        logger.exception("Failed to record submission rejection")


# The raw ASGI scope, as the middleware holds it.
Scope = MutableMapping[str, Any]


def _header(scope: Scope, name: bytes) -> str | None:
    for k, v in scope.get("headers") or []:
        if k.lower() == name:
            return str(v.decode("latin-1"))
    return None


def _actor_from_bearer(scope: Scope) -> uuid.UUID | None:
    """The student behind an unauthenticated request, if the bearer
    token is present and valid. An expired or malformed token yields
    None and the rejection is recorded unattributed."""
    auth = _header(scope, b"authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    payload = decode_access_token(auth[7:].strip())
    if not payload:
        return None
    try:
        return uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        return None


def _client_ip(scope: Scope) -> str | None:
    xff = _header(scope, b"x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    client = scope.get("client")
    return str(client[0]) if client else None


async def note_transport_rejection(scope: Scope, request_bytes: int) -> None:
    """Called by the request-size middleware after it refuses a body.

    Ignores every route but the homework submit — an oversized request
    anywhere else is not a student blocked from turning in work.
    """
    if scope.get("method") != "POST":
        return
    m = _SUBMIT_PATH.match(scope.get("path") or "")
    if m is None:
        return
    await record_submission_rejection(
        actor_user_id=_actor_from_bearer(scope),
        assignment_id=uuid.UUID(m.group("assignment_id")),
        reason=REASON_UPLOAD_TOO_LARGE,
        request_bytes=request_bytes,
        detail="Request body too large",
        ip_address=_client_ip(scope),
    )
