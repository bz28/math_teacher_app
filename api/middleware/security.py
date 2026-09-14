import logging
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
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


logger = logging.getLogger(__name__)

# Told about every body this middleware refuses: the raw ASGI scope and
# the byte count that tripped the cap. Exists because a rejection here
# happens before any handler runs — without a hook, nothing downstream
# ever learns that a student was turned away.
RejectHook = Callable[[Scope, int], Awaitable[None]]


class RequestSizeLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        max_size: int = 10 * 1024 * 1024,
        on_reject: RejectHook | None = None,
    ) -> None:
        self.app = app
        self.max_size = max_size
        self.on_reject = on_reject

    async def _note_rejection(self, scope: Scope, size: int) -> None:
        """Best-effort: the hook must never change what the client gets."""
        if self.on_reject is None:
            return
        try:
            await self.on_reject(scope, size)
        except Exception:
            logger.exception("request-size reject hook failed")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Fast-reject if Content-Length is declared and too large
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length and int(content_length) > self.max_size:
            await self._note_rejection(scope, int(content_length))
            response = Response(
                content='{"detail":"Request body too large"}',
                status_code=413,
                media_type="application/json",
            )
            await response(scope, receive, send)
            return

        # Track actual bytes received (catches chunked transfers without Content-Length)
        bytes_received = 0
        max_size = self.max_size

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
                # No Content-Length, so the only size we know is how far
                # the body got before it crossed the cap — a lower bound.
                await self._note_rejection(scope, bytes_received)
                response = Response(
                    content='{"detail":"Request body too large"}',
                    status_code=413,
                    media_type="application/json",
                )
                await response(scope, receive, send)
            else:
                raise
