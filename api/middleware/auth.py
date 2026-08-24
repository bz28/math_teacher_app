from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import decode_access_token
from api.database import get_db

if TYPE_CHECKING:
    from api.models.user import User

logger = logging.getLogger(__name__)

security = HTTPBearer()


class CurrentUser:
    """The identity a route acts as.

    `user_id` is the SCOPE — every teacher route reads it to decide whose
    courses, sections and students may be seen. When an admin is reading a
    teacher's data (see `require_teacher`), `user_id` is the TEACHER's, so
    all 74 of those routes work unchanged.

    `acting_admin_id` is then the real human behind the request. The two
    must never be conflated in an audit trail: a FERPA record saying the
    teacher read her own students, when in fact an admin did, corrupts the
    exact log that exists to answer "who looked at this child's record".
    Use `accessor_id` / `accessor_role` for anything auditing WHO ACTED,
    and `user_id` for anything deciding WHAT MAY BE SEEN.
    """

    def __init__(
        self,
        user_id: uuid.UUID,
        role: str,
        name: str = "",
        acting_admin_id: uuid.UUID | None = None,
    ):
        self.user_id = user_id
        self.role = role
        self.name = name
        self.acting_admin_id = acting_admin_id

    @property
    def accessor_id(self) -> uuid.UUID:
        """The real human to attribute an access to."""
        return self.acting_admin_id or self.user_id

    @property
    def accessor_role(self) -> str:
        """The real human's role. An admin reading as a teacher is still
        an admin in the audit trail."""
        return "admin" if self.acting_admin_id else self.role


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = uuid.UUID(str(payload["sub"]))

    # Verify user is still active on every request
    from api.models.user import User

    result = await db.execute(
        select(User.is_active, User.name, User.email, User.role).where(User.id == user_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not row.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    # Read role from the DB, not the JWT — a role change (e.g. admin demotion via
    # PATCH /admin/users/{id}/role) must take effect immediately, not at token
    # expiry. The query above already runs each request, so this is free.
    return CurrentUser(user_id=user_id, role=str(row.role), name=row.name or row.email)


async def get_current_user_full(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Return the full User ORM object for the current authenticated user."""
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = uuid.UUID(str(payload["sub"]))

    from api.models.user import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    return user


async def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency that enforces admin role. Use via Depends(require_admin)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


# How long a "reading as" note stays de-duplicated in this process before
# the same admin/teacher pair is logged again. A page load fires many
# requests; one activity row per hour is a legible session marker, whereas
# one per request would drown the log it is meant to make readable.
_VIEW_AS_LOG_TTL = timedelta(hours=1)
# (admin_id, teacher_id) -> when an activity row was last written for it.
# Process-local on purpose: a restart re-logs, erring toward MORE audit.
_view_as_logged: dict[tuple[uuid.UUID, uuid.UUID], datetime] = {}


async def require_teacher(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Enforce teacher (or admin) role, and resolve WHOSE data is in scope.

    Normally the scope is the caller's own id and this is a role check.

    An admin may additionally pass `?as_teacher=<uuid>` to READ a teacher's
    data — the pilot-debugging path ("show me exactly what she sees"). It
    returns a CurrentUser whose `user_id` is the teacher's, so all 74
    routes scoping on `current_user.user_id` work unchanged, while
    `acting_admin_id` preserves who is really asking.

    Three guards, all enforced HERE rather than per-route, so no future
    endpoint can forget one:

    - **Admin only.** Anyone else passing the param is refused outright,
      never silently ignored — ignoring it would return the caller's OWN
      data for a request that asked for someone else's, and they would
      believe they had scoped a read that they hadn't.
    - **GET only.** The load-bearing guard. Writing as a teacher must be
      impossible, not merely discouraged: the product's central promise is
      that a teacher approves every grade, and an admin publishing under
      her name would break it invisibly. Because the refusal lives in the
      dependency there is no write path to audit, and nothing depends on
      remembering to disable a button.
    - **Target must be a teacher.** A student or admin id would hand
      teacher-shaped queries an identity they were never written for.
    """
    if current_user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")

    target = await resolve_view_as(request, current_user, db)
    if target is None:
        return current_user
    return CurrentUser(
        user_id=target[0],
        role="teacher",
        name=target[1],
        acting_admin_id=current_user.user_id,
    )


async def resolve_view_as(
    request: Request, current_user: CurrentUser, db: AsyncSession,
) -> tuple[uuid.UUID, str] | None:
    """Resolve `?as_teacher=` to (teacher_id, name), or None when absent.

    Shared by `require_teacher` (which scopes the 74 data routes) and
    `/auth/me` (which drives the CLIENT's identity — the app shell and 22
    role gates). Both must agree: if only the data routes honour the
    parameter, the admin sees her data rendered inside the WRONG shell,
    which was the first bug this feature shipped with.

    Returns None when the parameter is absent. Raises on every invalid
    use, so the guards live in exactly one place.
    """
    raw = request.query_params.get("as_teacher")
    if not raw:
        return None

    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin may read as another teacher",
        )
    if request.method != "GET":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Reading as a teacher is read-only — this action would "
                "change data and must be done from your own account."
            ),
        )
    try:
        target_id = uuid.UUID(raw)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="as_teacher must be a UUID",
        ) from None

    from api.models.user import User as UserModel

    row = (await db.execute(
        select(UserModel.id, UserModel.role, UserModel.name)
        .where(UserModel.id == target_id)
    )).first()
    if row is None or row.role != "teacher":
        # 404 for both "no such user" and "not a teacher", so the param
        # can't be used to enumerate which ids exist or what role they hold.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found",
        )

    await _log_view_as(db, current_user, row.id, row.name or "")

    # ── The actual read-only guarantee ──────────────────────────────
    #
    # The GET-only check above is a cheap early gate with a clear
    # message. It is NOT what makes this safe, and treating it as such
    # was the first design's mistake: "GET" is a convention, not an
    # enforcement, and this codebase has GET routes that legitimately
    # write. `teacher_assignments.list_submissions` finalizes abandoned
    # integrity checks on read and commits them — a terminal, teacher-
    # facing verdict on a child's integrity record, written by a plain
    # GET. Auditing all 28 GET routes today would not help either,
    # because nothing stops the 29th from writing tomorrow.
    #
    # So the guarantee is moved to where writes actually happen. Postgres
    # refuses every INSERT/UPDATE/DELETE on this transaction — ORM and
    # raw SQL alike, on any route, known or not, now or later. Audit
    # writes are unaffected: they run on their own sessions (see
    # _log_view_as and log_student_record_access).
    #
    # `db.info` carries the flag so a handler that KNOWS it does a lazy
    # write can skip it cleanly instead of erroring (see
    # integrity_pipeline.finalize_if_abandoned). Anything that does not
    # know fails loudly, which is the correct direction to fail.
    db.info["view_as_read_only"] = True
    await db.execute(text("SET TRANSACTION READ ONLY"))
    return row.id, row.name or ""


async def _log_view_as(
    db: AsyncSession, admin: CurrentUser, teacher_id: uuid.UUID, teacher_name: str,
) -> None:
    """Write one `admin.view_as_teacher` activity row per admin/teacher
    pair per hour. Never raises — an audit failure must not break a read
    that is already authorized (same contract as log_student_record_access).
    """
    key = (admin.user_id, teacher_id)
    now = datetime.now(UTC)
    last = _view_as_logged.get(key)
    if last is not None and now - last < _VIEW_AS_LOG_TTL:
        return

    # Its OWN session and its OWN commit. `record_activity` only calls
    # db.add() and leaves committing to the caller, so on a pure-read
    # request — which is most of this feature — nothing ever committed and
    # the row died with the session. The audit trail for "an admin read a
    # whole class" was therefore usually EMPTY, saved only by the accident
    # of some other handler committing for its own reasons.
    #
    # The request session is also read-only in this mode, so it could not
    # carry this write even if someone did commit it.
    try:
        from api.core.audit_log import record_activity
        from api.database import get_session_factory

        async with get_session_factory()() as audit_db:
            await record_activity(
                audit_db, admin,
                action="admin.view_as_teacher",
                target_type="user",
                target_id=teacher_id,
                metadata={"teacher_name": teacher_name},
            )
            await audit_db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("failed to log view-as for teacher %s", teacher_id)
        return
    # Set the suppression key ONLY after the row is durable. Setting it
    # first meant one failed write silenced logging for a full hour.
    _view_as_logged[key] = now
