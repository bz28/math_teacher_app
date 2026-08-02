"""Turn a crash into a real HTTP response, inside the CORS layer.

## Why this is middleware and not an exception handler

The obvious fix — `@app.exception_handler(Exception)` — does not work,
and it is worth writing down why so nobody "simplifies" back to it.

Starlette handles that registration in `ServerErrorMiddleware`, which
sits OUTSIDE every middleware you add, including CORS. It does produce
a JSON body, but the response never travels back out through
`CORSMiddleware`, so it carries no `access-control-allow-origin`.
Measured against a real server: the handler returned
`{"detail": ...}` with status 500 and still no CORS header.

A browser DISCARDS a cross-origin response with no such header and
rejects the `fetch`. Client-side that is indistinguishable from the
server being unreachable — so a bug on ONE endpoint got reported to
operators as a platform outage ("Either Railway is down or the service
is restarting") while the server was up and serving every other
request. That sends people to a status page instead of the logs.

Registering this INNERMOST means an exception from a route is caught
below CORS, and the 500 we return then travels outward through
`CORSMiddleware`, which stamps the header on the way past.

The body stays deliberately vague — internals do not belong in a
browser — but the STATUS is honest, and status is what the client
branches on. Nothing is swallowed: the traceback is logged.
"""

import logging

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


class UnhandledErrorMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint,
    ) -> Response:
        try:
            return await call_next(request)
        except Exception:
            # exc_info via .exception() — the traceback is the whole
            # point of catching this here rather than letting it fly.
            logger.exception(
                "Unhandled error on %s %s", request.method, request.url.path,
            )
            return JSONResponse(
                status_code=500,
                content={"detail": "Something went wrong on our end."},
            )
