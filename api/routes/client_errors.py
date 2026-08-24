"""Client-error intake — the mailbox for browser crashes.

The web app used to discard these in production (`ErrorBoundary.
componentDidCatch` logged to console only when NODE_ENV !== "production"),
so a crash in a real teacher's browser produced a retry card for her and
silence for us. This is where those reports land; the admin dashboard
reads them back.

Three properties this endpoint has to hold, because it is reached from a
page that is *already broken*:

1. **Optionally authenticated.** The login page can throw too, and a
   crash nobody is signed in for is exactly the one we'd otherwise never
   hear about. A bad/expired token is treated as anonymous rather than
   rejected — refusing the report would discard the evidence over a
   detail we don't need.
2. **Never rejects for size.** Fields are truncated, not 422'd. A
   half-truncated stack still names the bug; a rejected report tells us
   nothing.
3. **Rate limited.** It's an unauthenticated write reachable by any
   browser, and a render crash-loop can fire hundreds of times a second.
   The client de-dupes per page-load as well; this is the backstop.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import decode_access_token
from api.database import get_db
from api.middleware.rate_limit import limiter
from api.models.client_error import (
    MAX_MESSAGE_CHARS,
    MAX_ROUTE_CHARS,
    MAX_STACK_CHARS,
    MAX_USER_AGENT_CHARS,
    VALID_KINDS,
    ClientError,
)
from api.models.user import User

router = APIRouter(tags=["client-errors"])

# Bearer scheme that yields None instead of 401 when the header is
# missing — the whole point is accepting anonymous reports.
_optional_bearer = HTTPBearer(auto_error=False)

# Generous enough for a genuine crash-loop burst from one browser, tight
# enough that the table can't be flooded from a single address.
_RATE_LIMIT = "60/minute"


def _clip(value: str | None, limit: int) -> str | None:
    """Truncate to `limit`, marking the cut so a reader knows the stack
    continues rather than assuming it ended there."""
    if value is None:
        return None
    value = value.strip()
    if len(value) <= limit:
        return value or None
    return value[:limit] + "\n…[truncated]"


class ClientErrorIn(BaseModel):
    """One reported error. Every field except `message`, `kind`, and
    `fingerprint` is best-effort — the reporter runs inside a broken page
    and should send whatever it managed to collect rather than nothing."""

    kind: str
    message: str = Field(min_length=1)
    # Client-computed hash of message + top stack frames. Identical
    # crashes share one so the dashboard can collapse them to a count.
    fingerprint: str = Field(min_length=1, max_length=64)
    stack: str | None = None
    component_stack: str | None = None
    route: str | None = None
    context: dict[str, Any] | None = None


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(_RATE_LIMIT)
async def report_client_error(
    request: Request,
    body: ClientErrorIn,
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Record one client-side error. Always 204 — the caller is a broken
    page and has nothing useful to do with a failure here."""
    user_id: uuid.UUID | None = None
    user_role: str | None = None
    school_id: uuid.UUID | None = None

    # Best-effort identity. An expired or malformed token means we file
    # the report anonymously; it does NOT mean we drop it.
    if credentials is not None:
        payload = decode_access_token(credentials.credentials)
        if payload is not None:
            try:
                user_id = uuid.UUID(str(payload.get("sub")))
            except (ValueError, TypeError):
                user_id = None
            if user_id is not None:
                row = (await db.execute(
                    select(User.role, User.school_id).where(User.id == user_id)
                )).first()
                if row is None:
                    # Token references a deleted user — keep the report,
                    # drop the dangling FK.
                    user_id = None
                else:
                    user_role, school_id = row.role, row.school_id

    kind = body.kind if body.kind in VALID_KINDS else "unhandled"

    db.add(ClientError(
        user_id=user_id,
        user_role=user_role,
        school_id=school_id,
        kind=kind,
        message=_clip(body.message, MAX_MESSAGE_CHARS) or "(empty)",
        stack=_clip(body.stack, MAX_STACK_CHARS),
        component_stack=_clip(body.component_stack, MAX_STACK_CHARS),
        fingerprint=body.fingerprint[:64],
        route=_clip(body.route, MAX_ROUTE_CHARS),
        user_agent=_clip(
            request.headers.get("user-agent"), MAX_USER_AGENT_CHARS,
        ),
        context=body.context,
    ))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
