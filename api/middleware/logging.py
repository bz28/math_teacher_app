import json
import logging
import sys
import time
import uuid
from collections.abc import MutableMapping
from typing import Any

from starlette.types import ASGIApp, Receive, Scope, Send


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data: dict[str, object] = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("request_id", "session_id", "user_id", "method", "path", "status_code", "duration_ms"):
            if hasattr(record, key):
                log_data[key] = getattr(record, key)
        if record.exc_info and record.exc_info[1]:
            log_data["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_data)


# Our own top-level logger namespace. LOG_LEVEL applies HERE, not to the
# root, so third-party libraries never inherit DEBUG.
#
# This is deliberately an allowlist of ours rather than a blocklist of
# theirs. Vendor SDKs log request and response bodies at DEBUG:
# `anthropic/_base_client.py` dumps full request options (and on
# pydantic v2 the `content` exclusion does NOT apply, so that is the
# base64 of a student's homework photo), and `stripe/_util.log_debug`
# emits complete request params and response bodies — a teacher's email,
# name and address. An enumerated blocklist only covers the vendors
# someone remembered; capping the root and opting our own namespace in
# means the next dependency added is safe by default.
#
# LOG_LEVEL=DEBUG is set in production today, so this is what makes
# honouring LOG_LEVEL safe at all.
_OWN_LOGGER_NAMESPACE = "api"


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    resolved = getattr(logging, level.upper(), logging.INFO)
    # A record is gated by its ORIGINATING logger's effective level, not
    # by root's, so our namespace still emits DEBUG through root's
    # handler while everything else is floored at INFO.
    root.setLevel(max(resolved, logging.INFO))
    logging.getLogger(_OWN_LOGGER_NAMESPACE).setLevel(resolved)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


class LoggingMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = str(uuid.uuid4())
        # Check for incoming request ID header
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"x-request-id":
                request_id = header_value.decode()
                break

        scope["state"] = {**scope.get("state", {}), "request_id": request_id}
        start = time.monotonic()
        status_code = 500

        async def send_wrapper(message: MutableMapping[str, Any]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status", 500))
            await send(message)

        await self.app(scope, receive, send_wrapper)

        duration_ms = round((time.monotonic() - start) * 1000, 2)
        method = scope.get("method", "")
        path = scope.get("path", "")
        logger = logging.getLogger("api.access")
        logger.info(
            "%s %s %s %.2fms",
            method,
            path,
            status_code,
            duration_ms,
            extra={
                "request_id": request_id,
                "method": method,
                "path": path,
                "status_code": status_code,
                "duration_ms": duration_ms,
            },
        )
