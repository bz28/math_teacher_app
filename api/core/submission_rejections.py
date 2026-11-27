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
  file, a page too small to read, a whole submission over the total —
  `api/core/submission_uploads.py`'s `UploadRejected`).
- `note_transport_rejection` — the middleware path. The request-size
  limit rejects an oversized body BEFORE any handler runs, so nothing
  downstream knows it happened. The middleware hands us the ASGI scope;
  we recognise the turn-in and retake routes by path and read the bearer
  token to name the student. Only a verified student token is recorded:
  the route would refuse anyone else anyway, so an anonymous refusal is
  never a blocked student — and recording one would let anyone write
  rows (and hold a database connection) with a bare oversized header.
  The token is decoded only on this cold path, never per request.

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
from starlette.requests import Request

from api.core.audit_log import client_ip
from api.core.auth import decode_access_token
from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.user import User

logger = logging.getLogger(__name__)

# Why the upload was refused. One vocabulary for both paths so the
# dashboard can count them side by side.
REASON_UPLOAD_TOO_LARGE = "upload_too_large"        # transport cap, pre-handler
REASON_FILE_TOO_LARGE = "file_too_large"            # one file over its format cap
REASON_FILE_INVALID = "file_invalid"                # not a JPEG / PNG / PDF, or bad base64
REASON_SUBMISSION_TOO_LARGE = "submission_too_large"  # decoded total over the cap
REASON_PAGE_TOO_SMALL = "page_too_small"            # a page under the reader's size floor
REASON_PDFS_TOO_LARGE = "pdfs_too_large"            # the PDFs together over one model request

# The routes whose rejection is a student being blocked from turning in
# homework: the turn-in (which also takes a reopened homework's second
# turn-in) and the retake of flagged photos. Anchored so a practice or
# tutor upload never lands here.
_SUBMIT_PATH = re.compile(
    r"^/v1/school/student/homework/(?P<assignment_id>[0-9a-fA-F-]{36})/submit/?$"
)
_RETAKE_PATH = re.compile(
    r"^/v1/school/student/submissions/(?P<submission_id>[0-9a-fA-F-]{36})/retake/?$"
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
    actor_user_id: uuid.UUID,
    assignment_id: uuid.UUID,
    reason: str,
    request_bytes: int | None,
    decoded_bytes: int | None = None,
    detail: str | None = None,
    ip_address: str | None = None,
) -> None:
    """One activity-log row per rejected homework upload:
    ``"submission.rejected"``, targeting the assignment the student was
    trying to turn in.

    `request_bytes`
    is the transport size (base64 JSON, what the cap measured);
    `decoded_bytes` is the sum of the decoded files when the handler got
    far enough to know it.

    Opens its own session: the handler that calls this is about to
    raise, and its request session rolls back with it.
    """
    try:
        async with get_session_factory()() as db:
            school_id = (await db.execute(
                select(Course.school_id)
                .join(Assignment, Assignment.course_id == Course.id)
                .where(Assignment.id == assignment_id)
            )).scalar_one_or_none()

            # A teacher rehearsing as a preview student can be blocked
            # too; the row is kept but flagged so it never counts as a
            # child who couldn't turn in homework.
            is_preview = (await db.execute(
                select(User.is_preview).where(User.id == actor_user_id)
            )).scalar_one_or_none()
            metadata: dict[str, Any] = {
                "reason": reason,
                "request_bytes": request_bytes,
                "decoded_bytes": decoded_bytes,
                "detail": (detail or "")[:200] or None,
                "is_preview": bool(is_preview),
            }

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


def _student_from_bearer(request: Request) -> uuid.UUID | None:
    """The student behind a request no handler has authenticated: the
    bearer token's user, when the token verifies and is a student's.
    None otherwise — and then nothing is recorded."""
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "bearer":
        return None
    payload = decode_access_token(token.strip())
    if not payload or payload.get("role") != "student":
        return None
    try:
        return uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        return None


async def _turn_in_assignment(
    student_id: uuid.UUID,
    *,
    assignment_id: uuid.UUID | None = None,
    retake_of: uuid.UUID | None = None,
) -> uuid.UUID | None:
    """The homework this student may turn in at the refused route — the
    route's own gate, so a refusal is recorded exactly when the route
    would have let the student in: an existing, published homework sent
    to a section they're in (`_load_assignment_for_student`, which both
    submit and retake run first), and for a retake, their own submission.
    None otherwise: an id the route would 404 is not a blocked student."""
    # Imported here: the route module imports this one.
    from fastapi import HTTPException

    from api.routes.school_student_practice import _load_assignment_for_student

    async with get_session_factory()() as db:
        if retake_of is not None:
            assignment_id = (await db.execute(
                select(Submission.assignment_id).where(
                    Submission.id == retake_of, Submission.student_id == student_id,
                )
            )).scalar_one_or_none()
        user = await db.get(User, student_id)
        if assignment_id is None or user is None:
            return None
        try:
            return (await _load_assignment_for_student(db, assignment_id, user)).id
        except HTTPException:
            return None


async def note_transport_rejection(scope: MutableMapping[str, Any], request_bytes: int) -> None:
    """Called by the request-size middleware after it refuses a body as
    too large.

    Records only a signed-in student on the turn-in or the retake route
    (see the module docstring) — an oversized request anywhere else, or
    from anyone else, is not a student blocked from turning in work.
    """
    if scope.get("method") != "POST":
        return
    path = scope.get("path") or ""
    submit = _SUBMIT_PATH.match(path)
    retake = _RETAKE_PATH.match(path) if submit is None else None
    if submit is None and retake is None:
        return
    request = Request(scope)
    student_id = _student_from_bearer(request)
    if student_id is None:
        return
    try:
        assignment_id = await _turn_in_assignment(
            student_id,
            assignment_id=uuid.UUID(submit.group("assignment_id")) if submit else None,
            retake_of=uuid.UUID(retake.group("submission_id")) if retake else None,
        )
    except Exception:
        logger.exception("Couldn't resolve the refused turn-in's homework")
        return
    if assignment_id is None:
        return
    await record_submission_rejection(
        actor_user_id=student_id,
        assignment_id=assignment_id,
        reason=REASON_UPLOAD_TOO_LARGE,
        request_bytes=request_bytes,
        detail="Request body too large",
        ip_address=client_ip(request),
    )
