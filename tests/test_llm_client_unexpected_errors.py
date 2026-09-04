"""An unexpected exception from the SDK must still leave a trace.

The 2026-09-03 outage: `anthropic` floated from 0.116.0 to 1.3.0, which
dropped the `temperature` kwarg. Every extraction, integrity check and AI
grading call raised

    TypeError: AsyncMessages.create() got an unexpected keyword argument
    'temperature'

`call_claude_vision` caught `anthropic.APIError` and `ValueError` — a
TypeError matched neither, so it escaped before anything was logged. The
database showed a submission with zero model calls AND zero failures,
which reads identically to "nothing was ever attempted". The only
evidence was a traceback in the platform log stream, and finding it took
Railway CLI access.

These tests pin the two halves of the fix: the row gets written, and the
exception still propagates unchanged so no behaviour depends on the
logging.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core.llm_client import LLMMode, call_claude_vision
from api.core.llm_schemas import DISTRACTOR_SCHEMA

# The literal shape of the failure that took production down.
_SDK_SIGNATURE_BREAK = TypeError(
    "AsyncMessages.create() got an unexpected keyword argument 'temperature'"
)


def _client_raising(exc: BaseException) -> Any:
    client = AsyncMock()
    client.messages.create = AsyncMock(side_effect=exc)
    return client


async def _call_vision_catching(exc: BaseException) -> list[dict[str, Any]]:
    """Drive call_claude_vision against an SDK that raises `exc`.

    Returns the _log_and_persist calls it made. Re-raises nothing — the
    caller asserts on propagation separately.
    """
    logged: list[dict[str, Any]] = []

    async def fake_log(*_args: Any, **kwargs: Any) -> None:
        logged.append(kwargs)

    with (
        patch("api.core.llm_client.get_client", return_value=_client_raising(exc)),
        patch("api.core.llm_client._log_and_persist", side_effect=fake_log),
    ):
        with pytest.raises(type(exc)):
            await call_claude_vision(
                [{"type": "text", "text": "x"}],
                mode=LLMMode.IMAGE_EXTRACT,
                tool_schema=DISTRACTOR_SCHEMA,
                temperature=0.0,
            )
    return logged


@pytest.mark.asyncio
async def test_sdk_signature_break_is_logged_as_a_failed_call() -> None:
    """The guard that would have made the outage a one-query diagnosis."""
    logged = await _call_vision_catching(_SDK_SIGNATURE_BREAK)

    assert logged, "an unexpected exception left NO llm_call row — still silent"
    row = logged[-1]
    assert row["success"] is False
    # The exception type has to reach the row. "unexpected keyword argument
    # 'temperature'" alone doesn't say it was a TypeError rather than a
    # rejected API parameter, and those have opposite fixes.
    assert "TypeError" in (row["output_text"] or "")
    assert "temperature" in (row["output_text"] or "")


@pytest.mark.asyncio
async def test_the_original_exception_propagates_unchanged() -> None:
    """Logging is a side effect, never a behaviour change.

    If the catch-all wrapped or swallowed, callers upstream would see a
    different type than before the fix — `_run_extraction_background`
    catches broadly, but the retry/circuit logic elsewhere does not.
    """
    with (
        patch(
            "api.core.llm_client.get_client",
            return_value=_client_raising(_SDK_SIGNATURE_BREAK),
        ),
        patch("api.core.llm_client._log_and_persist", new=AsyncMock()),
    ):
        with pytest.raises(TypeError) as caught:
            await call_claude_vision(
                [{"type": "text", "text": "x"}],
                mode=LLMMode.IMAGE_EXTRACT,
                tool_schema=DISTRACTOR_SCHEMA,
                temperature=0.0,
            )
    assert "temperature" in str(caught.value)


@pytest.mark.asyncio
async def test_a_failure_while_logging_does_not_mask_the_real_error() -> None:
    """The catch-all's own logging is wrapped for this reason.

    Without the inner try, a DB hiccup during the failure write would
    replace a clear "TypeError: unexpected keyword argument" with an
    unrelated database error — hiding the actual cause behind the
    symptom of recording it.
    """
    with (
        patch(
            "api.core.llm_client.get_client",
            return_value=_client_raising(_SDK_SIGNATURE_BREAK),
        ),
        patch(
            "api.core.llm_client._log_and_persist",
            side_effect=RuntimeError("logging backend is down"),
        ),
    ):
        with pytest.raises(TypeError):
            await call_claude_vision(
                [{"type": "text", "text": "x"}],
                mode=LLMMode.IMAGE_EXTRACT,
                tool_schema=DISTRACTOR_SCHEMA,
                temperature=0.0,
            )
