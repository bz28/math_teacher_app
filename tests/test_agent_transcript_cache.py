"""Rolling prompt-cache breakpoint on the integrity agent's transcript.

The agent re-sends the entire conversation on every round trip, so
without a cache breakpoint a 10-turn check pays full input price for the
early turns ten times over. `_with_transcript_cache` marks the tail of
the last message so the prefix is cached and each later turn reads it at
0.1x instead of writing it again at 1.0x.

Covers:
1. Plain-string content (the kickoff message and every student turn) is
   promoted to a block list so it can carry cache_control.
2. Block-list content (assistant turns, tool_result turns) gets the
   breakpoint on its LAST block only.
3. The caller's transcript is not mutated — callers keep and persist it
   across turns, so a leaked cache_control key would accumulate.
4. Degenerate content is passed through untouched rather than crashing
   the agent loop.
5. The breakpoint is applied inside the helper, so an existing harness
   cassette key (hashed from the caller's args) still matches.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core.llm_client import _with_transcript_cache, call_claude_conversation

_EPHEMERAL = {"type": "ephemeral"}


def test_string_content_is_promoted_to_a_cached_block() -> None:
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "<student_message>hi</student_message>"},
    ]
    out = _with_transcript_cache(messages)
    assert out[-1]["content"] == [{
        "type": "text",
        "text": "<student_message>hi</student_message>",
        "cache_control": _EPHEMERAL,
    }]


def test_breakpoint_lands_on_the_last_block_only() -> None:
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "opener"},
        {"role": "assistant", "content": [
            {"type": "text", "text": "thinking out loud"},
            {"type": "tool_use", "id": "t1", "name": "finish_check", "input": {}},
        ]},
    ]
    out = _with_transcript_cache(messages)
    blocks = out[-1]["content"]
    assert "cache_control" not in blocks[0]
    assert blocks[1]["cache_control"] == _EPHEMERAL
    # Earlier messages are left exactly as-is — one rolling breakpoint,
    # not one per message.
    assert out[0]["content"] == "opener"


def test_callers_transcript_is_not_mutated() -> None:
    """The pipeline keeps this list across turns and persists from it."""
    blocks = [{"type": "text", "text": "keep me clean"}]
    messages: list[dict[str, Any]] = [{"role": "assistant", "content": blocks}]

    _with_transcript_cache(messages)

    assert blocks == [{"type": "text", "text": "keep me clean"}]
    assert messages[0]["content"] is blocks
    assert "cache_control" not in blocks[0]


@pytest.mark.parametrize("content", [None, "", [], 42])
def test_degenerate_content_passes_through(content: Any) -> None:
    messages: list[dict[str, Any]] = [{"role": "user", "content": content}]
    assert _with_transcript_cache(messages) is messages


def test_empty_transcript_passes_through() -> None:
    assert _with_transcript_cache([]) == []


@pytest.mark.asyncio
async def test_conversation_sends_cached_transcript_without_touching_caller() -> None:
    """End-to-end: the wire payload carries the breakpoint, the caller's
    list does not (so the cassette key, hashed from the caller's args
    before this function runs, is unchanged)."""
    from types import SimpleNamespace

    response = SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(type="text", text="ok")],
        usage=SimpleNamespace(
            input_tokens=10, output_tokens=5,
            cache_read_input_tokens=2_048, cache_creation_input_tokens=128,
        ),
    )
    create = AsyncMock(return_value=response)
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    messages: list[dict[str, Any]] = [{"role": "user", "content": "hello"}]

    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client.fire_and_forget_persist") as persist,
    ):
        await call_claude_conversation(
            "system", messages, "integrity_agent", tool_schemas=[],
        )

    sent = create.call_args.kwargs["messages"]
    assert sent[-1]["content"][-1]["cache_control"] == _EPHEMERAL
    assert messages == [{"role": "user", "content": "hello"}]
    # And the cache traffic is now accounted for on the logged row.
    assert persist.call_args.kwargs["cache_read_tokens"] == 2_048
    assert persist.call_args.kwargs["cache_write_tokens"] == 128
