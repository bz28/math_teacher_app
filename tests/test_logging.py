import json
import logging

from api.middleware.logging import JSONFormatter


def test_json_formatter_outputs_valid_json() -> None:
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="test message",
        args=None,
        exc_info=None,
    )
    record.request_id = "req-123"  # type: ignore[attr-defined]
    output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["message"] == "test message"
    assert parsed["request_id"] == "req-123"
    assert parsed["level"] == "INFO"


def test_json_formatter_includes_extra_fields() -> None:
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg="request",
        args=None,
        exc_info=None,
    )
    record.method = "GET"  # type: ignore[attr-defined]
    record.path = "/v1/health"  # type: ignore[attr-defined]
    record.status_code = 200  # type: ignore[attr-defined]
    record.duration_ms = 5.12  # type: ignore[attr-defined]
    output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["method"] == "GET"
    assert parsed["path"] == "/v1/health"
    assert parsed["status_code"] == 200
    assert parsed["duration_ms"] == 5.12
