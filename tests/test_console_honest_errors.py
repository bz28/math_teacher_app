"""The console must be able to tell a broken endpoint from a dead server.

## The bug these pin

An operator opened /teachers/independent and saw:

    "Can't reach the backend. Either Railway is down or the service is
     restarting — check Railway status."

Railway was not down. The server was up and answering every other
request. Two separate defects stacked into that misdiagnosis:

1. `GET /admin/users?role=teacher&no_school=true` raised
   InvalidRequestError (an auto-correlated EXISTS with no FROM). That
   filter and its page are gone now that signup is invite-only.

2. An unhandled exception propagates past CORSMiddleware, so the 500
   reaching the browser carried NO `access-control-allow-origin`. The
   browser blocks such a response and `fetch` REJECTS, which the
   client cannot distinguish from an unreachable host — so a bug on
   ONE endpoint was reported to operators as a platform outage.

Together they turned "this page has a bug" into "the host is down",
which is the most expensive kind of wrong: it sends people to a status
page instead of the logs.
"""

from __future__ import annotations

from fastapi import APIRouter
from starlette.testclient import TestClient

from api.config import settings
from api.main import app

# Must be an origin the app is actually configured to allow —
# CORSMiddleware only stamps access-control-allow-origin for those, so
# testing with an unlisted origin would assert nothing about the fix.
ORIGIN = settings.cors_origins[0]


def test_a_crash_still_carries_cors_headers() -> None:
    """A 500 must be a real HTTP response, not a dropped connection.

    Without the catch-all handler the exception escapes past
    CORSMiddleware, the browser blocks the header-less 500, `fetch`
    rejects, and the console reports an outage for a server that is up.

    Uses its own app-level route so it tests the handler rather than
    any particular endpoint's bugs, and Starlette's TestClient with
    `raise_server_exceptions=False` so the client behaves like a real
    browser (receives the response) instead of re-raising into the
    test.
    """
    boom = APIRouter()

    @boom.get("/v1/__test_explode")
    async def _explode() -> dict[str, str]:
        raise RuntimeError("kaboom")

    app.include_router(boom)
    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            res = c.get("/v1/__test_explode", headers={"Origin": ORIGIN})

        assert res.status_code == 500
        # The header is the whole point: without it the browser discards
        # the response and the client cannot tell a bug from an outage.
        assert res.headers.get("access-control-allow-origin") == ORIGIN
        assert res.json()["detail"] == "Something went wrong on our end."
    finally:
        app.router.routes = [
            r for r in app.router.routes
            if getattr(r, "path", None) != "/v1/__test_explode"
        ]
