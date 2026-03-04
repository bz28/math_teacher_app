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


class RequestSizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_size: int = 10 * 1024 * 1024) -> None:
        self.app = app
        self.max_size = max_size

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length and int(content_length) > self.max_size:
            response = Response(
                content='{"detail":"Request body too large"}',
                status_code=413,
                media_type="application/json",
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
