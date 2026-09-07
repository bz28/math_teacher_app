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


# Third-party loggers that must never emit DEBUG, however loud we set
# our own. The Anthropic SDK logs its full request options at DEBUG
# (`anthropic/_base_client.py`), and on pydantic v2 the `content`
# exclusion does NOT apply — so a single DEBUG line carries the base64
# of a student's homework photo into the log stream. httpx/httpcore are
# merely deafening. LOG_LEVEL=DEBUG is set in production today, so this
# ceiling is what makes honouring LOG_LEVEL safe at all.
_THIRD_PARTY_LOG_CEILING = ("anthropic", "httpx", "httpcore", "openai", "urllib3")


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    resolved = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(resolved)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    for name in _THIRD_PARTY_LOG_CEILING:
        logging.getLogger(name).setLevel(max(resolved, logging.INFO))


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
