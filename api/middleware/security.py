import re
import uuid
from collections.abc import MutableMapping
from typing import Any

from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        scope["state"] = {**scope.get("state", {}), "request_id": request_id}

        async def send_with_headers(message: MutableMapping[str, Any]) -> None:
            if message["type"] == "http.response.start":
                extra = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"x-xss-protection", b"0"),
                    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
                    (b"content-security-policy", b"default-src 'self'"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    (b"x-request-id", request_id.encode()),
                ]
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)

        await self.app(scope, receive, send_with_headers)


# POST routes whose bodies carry base64 files, mapped to their larger
# request caps by api/middleware/setup.py. Each route still enforces its
# own per-file and total caps on the decoded files.
UPLOAD_DOCUMENT = re.compile(r"^/v1/teacher/courses/[^/]+/documents/?$")
UPLOAD_WORKSHEET = re.compile(r"^/v1/teacher/courses/[^/]+/question-bank/upload/?$")
UPLOAD_SUBMISSION = re.compile(
    r"^/v1/school/student/(?:homework/(?:[^/]+/submit|page-orientation)"
    r"|submissions/[^/]+/retake)/?$"
)


def _bearer_status(scope: Scope) -> str:
    """"valid", "invalid" (a Bearer token that doesn't verify, e.g. expired)
    or "absent". FastAPI reads the whole body before auth dependencies run,
    so the large-body cap goes only to verified tokens."""
    from api.core.auth import decode_access_token

    for name, value in scope.get("headers", []):
        if name == b"authorization":
            scheme, _, token = value.decode("latin-1").partition(" ")
            if scheme.lower() != "bearer":
                return "absent"
            return "valid" if decode_access_token(token.strip()) is not None else "invalid"
    return "absent"


class RequestSizeLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        max_size: int = 10 * 1024 * 1024,
        upload_caps: list[tuple[re.Pattern[str], int]] | None = None,
    ) -> None:
        self.app = app
        self.max_size = max_size
        self.upload_caps = upload_caps or []

    def limit_for(self, scope: Scope) -> tuple[int, int]:
        """(byte cap, status to refuse with past it). An upload with an
        expired token is refused with 401, not 413: clients refresh their
        session on a 401 and retry, while a 413 would tell a student her
        in-limits file is too large."""
        if scope.get("method") != "POST":
            return self.max_size, 413
        path = scope.get("path", "")
        for pattern, cap in self.upload_caps:
            if pattern.match(path):
                status = _bearer_status(scope)
                if status == "valid":
                    return cap, 413
                return self.max_size, 401 if status == "invalid" else 413
        return self.max_size, 413

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Fast-reject if Content-Length is declared and too large
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        max_size, refuse_status = self.limit_for(scope)
        if content_length and int(content_length) > max_size:
            await self._refuse(refuse_status, scope, receive, send)
            return

        # Track actual bytes received (catches chunked transfers without Content-Length)
        bytes_received = 0

        async def receive_with_limit() -> Any:
            nonlocal bytes_received
            message = await receive()
            if message["type"] == "http.request":
                bytes_received += len(message.get("body", b""))
                if bytes_received > max_size:
                    raise ValueError("Request body too large")
            return message

        try:
            await self.app(scope, receive_with_limit, send)
        except ValueError as e:
            if "Request body too large" in str(e):
                await self._refuse(refuse_status, scope, receive, send)
            else:
                raise

    @staticmethod
    async def _refuse(status: int, scope: Scope, receive: Receive, send: Send) -> None:
        # 401 carries the same detail and header get_current_user sends, so
        # clients take their usual refresh-and-retry path.
        if status == 401:
            response = Response(
                content='{"detail":"Invalid or expired token"}',
                status_code=401,
                media_type="application/json",
                headers={"WWW-Authenticate": "Bearer"},
            )
        else:
            response = Response(
                content='{"detail":"Request body too large"}',
                status_code=413,
                media_type="application/json",
            )
        await response(scope, receive, send)
