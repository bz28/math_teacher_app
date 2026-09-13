"""`call_claude_vision` must stream, and must keep its accounting intact.

Why this file exists: two students had homework permanently stranded in
production (2026-09-09 and 2026-09-10) because extraction ran as a
NON-streaming request under a 90s ceiling. Extraction latency tracks
output volume almost linearly (r=0.83 measured over production calls),
a dense page runs 5-8k output tokens, and Anthropic's throughput varies
about 2x (42 vs 94 output tok/s observed). At p50 57.7s / p95 87.2s the
ceiling had under three seconds of headroom, so on the slow half of that
range the same page needed ~175s and died.

Retrying could not save it: a retry re-runs the identical request inside
the same slow window, which is why BOTH production failures landed on an
identical 271s (3 x 90s, every attempt timing out). One of those two
submissions replays at 114s — past the old ceiling, fine under this one.

Streaming re-bases the timeout onto time-between-chunks, so a slow read
arrives slowly instead of being discarded whole. These tests pin that
choice, because reverting to `messages.create` would silently restore
the outage and nothing else in the suite would notice.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.core.llm_client import (
    VISION_STREAM_TIMEOUT_S,
    LLMMode,
    call_claude_vision,
)
from api.core.llm_schemas import DISTRACTOR_SCHEMA


def _final_message() -> Any:
    """A Message shaped like the one `get_final_message()` returns.

    Deliberately carries real usage numbers: the streaming switch is only
    safe if cost accounting survives it, and the cheapest way for that to
    regress is for usage to quietly arrive as zeros.
    """
    usage = MagicMock()
    usage.input_tokens = 1234
    usage.output_tokens = 5678
    usage.cache_read_input_tokens = 90
    usage.cache_creation_input_tokens = 12

    block = MagicMock()
    block.type = "tool_use"
    block.name = DISTRACTOR_SCHEMA["name"]
    block.input = {"distractors": ["a", "b", "c"]}

    msg = MagicMock()
    msg.stop_reason = "tool_use"
    msg.content = [block]
    msg.usage = usage
    return msg


def _streaming_client() -> tuple[Any, MagicMock]:
    """A client whose `messages.stream(...)` works as an async CM.

    Returns (client, stream_callable) so tests can assert on the kwargs
    the production code actually passed.
    """
    stream_ctx = AsyncMock()
    stream_ctx.__aenter__.return_value = AsyncMock(
        get_final_message=AsyncMock(return_value=_final_message()),
    )
    stream_ctx.__aexit__.return_value = False

    # `stream(...)` is CALLED, not awaited — a sync Mock returning the
    # async context manager is the faithful shape.
    stream_callable = MagicMock(return_value=stream_ctx)

    client = AsyncMock()
    client.messages.stream = stream_callable
    return client, stream_callable


async def _run_vision(client: Any) -> list[dict[str, Any]]:
    """Drive a successful vision call, returning what it logged.

    Token counts ride POSITIONALLY on `_log_and_persist(model, mode,
    input_tokens, output_tokens, ...)`, so capturing kwargs alone would
    silently drop the two numbers this switch is most likely to break.
    They are folded into the same dict under their real names.
    """
    logged: list[dict[str, Any]] = []

    async def fake_log(*args: Any, **kwargs: Any) -> None:
        row = dict(kwargs)
        if len(args) >= 4:
            row["input_tokens"] = args[2]
            row["output_tokens"] = args[3]
        logged.append(row)

    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", side_effect=fake_log),
    ):
        await call_claude_vision(
            [{"type": "text", "text": "x"}],
            mode=LLMMode.IMAGE_EXTRACT,
            tool_schema=DISTRACTOR_SCHEMA,
        )
    return logged


@pytest.mark.asyncio
async def test_vision_streams_and_never_calls_create() -> None:
    """The regression guard. `messages.create` is the outage."""
    client, stream_callable = _streaming_client()
    await _run_vision(client)

    assert stream_callable.called, "vision did not stream — did it revert to create()?"
    # AsyncMock auto-creates `.create`; the point is that nothing invoked it.
    assert not client.messages.create.called, (
        "vision called messages.create — a non-streaming request has to "
        "produce its whole body inside one timeout, which is exactly what "
        "stranded two students' homework in production"
    )


@pytest.mark.asyncio
async def test_the_stream_timeout_is_the_named_constant() -> None:
    """Sized as a stall detector, not a generation budget.

    A literal here would read as a total-duration cap and invite someone
    to 'tune' it back down to the p95 it used to sit under.
    """
    client, stream_callable = _streaming_client()
    await _run_vision(client)

    assert stream_callable.call_args.kwargs["timeout"] == VISION_STREAM_TIMEOUT_S
    # Above the slowest read on record (179s) — a value at or under the old
    # 90s ceiling would reintroduce the bug with a different spelling.
    assert VISION_STREAM_TIMEOUT_S > 90.0


@pytest.mark.asyncio
async def test_streaming_preserves_token_and_cache_accounting() -> None:
    """Cost tracking must survive the switch.

    `get_final_message()` returns the same Message the non-streaming path
    returned, so usage flows through untouched. If a future refactor reads
    usage off stream events instead, these numbers are where it breaks —
    silently, and only visible as an under-reported bill.
    """
    client, _ = _streaming_client()
    logged = await _run_vision(client)

    assert logged, "a successful vision call wrote no llm_calls row"
    row = logged[-1]
    assert row["success"] is True
    assert row["input_tokens"] == 1234
    assert row["output_tokens"] == 5678
    assert row["cache_read_tokens"] == 90
    assert row["cache_write_tokens"] == 12


@pytest.mark.asyncio
async def test_tool_result_is_extracted_from_the_final_message() -> None:
    """The payload callers depend on still comes back.

    Every one of the nine call sites reads a dict off this return value;
    if streaming changed the shape, they would all break at once.
    """
    client, _ = _streaming_client()

    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", new=AsyncMock()),
    ):
        result = await call_claude_vision(
            [{"type": "text", "text": "x"}],
            mode=LLMMode.IMAGE_EXTRACT,
            tool_schema=DISTRACTOR_SCHEMA,
        )

    assert result == {"distractors": ["a", "b", "c"]}
