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
3. **Rate limited, but loosely.** It's an unauthenticated write reachable
   by any browser. The limit is keyed on IP and a whole school shares one,
   so it is set high enough that a classroom-wide crash still gets through
   — see the note on `_RATE_LIMIT`. Honest traffic is bounded client-side;
   the server limit exists for hostile floods, not for browsers.
"""

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from slowapi.util import get_remote_address
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

def _client_key(request: Request) -> str:
    """Rate-limit key: the real client IP, not the proxy's.

    slowapi's default `get_remote_address` returns `request.client.host`,
    which behind Railway's proxy is the PROXY's address for every request
    on the platform — i.e. one global bucket, where a single noisy client
    exhausts the budget for everyone. That is the opposite of a per-client
    limit, and it silently breaks precisely when volume is highest.

    So key on X-Forwarded-For the way `audit_log._client_ip` already does.
    XFF is client-settable in principle, but this service is only reachable
    through the platform proxy, which overwrites it — and the failure mode
    of trusting it (a spoofer gets their own bucket) is strictly better
    than the failure mode of ignoring it (everyone shares one).

    Scoped to this route deliberately: the same flaw affects every
    @limiter.limit route including auth, but changing login throttling is
    a security change that deserves its own review, not a ride-along on a
    crash-reporting PR.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    return get_remote_address(request)


# A school sits behind ONE NAT gateway — thirty students and their teacher
# share a single address — so a bad deploy that crashes a whole classroom
# arrives as one key sending a burst. A tight limit would drop most of it:
# the cap would bite hardest exactly when the incident is biggest.
#
# Honest traffic is bounded client-side instead (report-error.ts de-dupes
# by fingerprint and stops at 25 per page load), so browsers cannot
# approach this number however badly they break. What is left for the
# server limit is stopping a hostile flood, which 300/min still does.
#
# Do not tighten this to a "sensible-looking" 60 without reading the above.
_RATE_LIMIT = "300/minute"


# Appended to a truncated value so a reader knows the text continues
# rather than assuming it ended there.
_TRUNCATION_MARKER = "\n…[truncated]"


def _clip(value: str | None, limit: int) -> str | None:
    """Truncate to AT MOST `limit` characters, marker included.

    The marker is part of the budget, not added on top of it. Appending it
    afterwards produced `limit + 13` characters, which for the two
    varchar(512) columns (`route`, `user_agent`) overflowed the column and
    made the INSERT raise — losing the entire crash report, silently, in
    the one code path whose whole purpose is to stop reports being lost.

    `user_agent` is the sharp edge: it comes from the request header, not
    from anything the page chooses, and corporate/AV-injected agent strings
    on locked-down school laptops routinely exceed 512 characters. So the
    machines this feature exists to serve were the ones guaranteed to hit
    it.
    """
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) <= limit:
        return value
    # Degenerate case: a limit too small to hold the marker at all.
    if limit <= len(_TRUNCATION_MARKER):
        return value[:limit]
    return value[: limit - len(_TRUNCATION_MARKER)] + _TRUNCATION_MARKER


# Ceiling on the serialized `context` blob. Every other field is clipped;
# without this one the endpoint is an UNAUTHENTICATED, unbounded write into
# the production database — bounded only by the 10MB request cap, with no
# retention to reclaim it. 4KB is far more than any real context (an API
# path plus a status code) and small enough that flooding is pointless.
_MAX_CONTEXT_CHARS = 4_000


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
    # Free-form, so it cannot be validated by shape — bounded by size
    # instead, in the validator below.
    context: dict[str, Any] | None = None

    @field_validator("context")
    @classmethod
    def _bound_context(
        cls, v: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Drop an oversized context rather than rejecting the report.

        Same principle as the field clipping: a crash report without its
        extra detail still names the bug, whereas a refused report tells us
        nothing. Dropping also means a hostile payload costs the sender a
        round trip and gains them nothing stored."""
        if v is None:
            return None
        try:
            if len(json.dumps(v)) > _MAX_CONTEXT_CHARS:
                return {"_dropped": "context exceeded size limit"}
        except (TypeError, ValueError):
            return {"_dropped": "context was not serializable"}
        return v


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(_RATE_LIMIT, key_func=_client_key)
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
