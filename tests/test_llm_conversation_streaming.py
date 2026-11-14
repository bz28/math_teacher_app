"""`call_claude_conversation(on_text=...)` streams without changing the call.

The integrity chat streams the agent's words to the student. The call that
produces them must stay the same call: same request, same return value,
same llm_calls row (usage, cache tokens, latency, metadata), same cassette
key — only the bytes arrive as they're written. The non-streamed path
(on_text=None: the opening turn, the mobile /turn) still uses `create`.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import tests.harness.cassette as cass_mod
from api.core.llm_client import call_claude_conversation


def _message() -> Any:
    return SimpleNamespace(
        stop_reason="tool_use",
        content=[
            SimpleNamespace(type="text", text="Why did you divide by 2?"),
            SimpleNamespace(
                type="tool_use", id="toolu_1", name="label_student_reply",
                input={"engagement": "answering"},
            ),
        ],
        usage=SimpleNamespace(
            input_tokens=321, output_tokens=45,
            cache_read_input_tokens=2_048, cache_creation_input_tokens=64,
        ),
    )


def _events() -> list[Any]:
    def delta(index: int, kind: str, **kw: Any) -> Any:
        return SimpleNamespace(
            type="content_block_delta", index=index,
            delta=SimpleNamespace(type=kind, **kw),
        )

    return [
        SimpleNamespace(type="message_start"),
        delta(0, "text_delta", text="Why did you "),
        delta(0, "text_delta", text="divide by 2?"),
        SimpleNamespace(type="content_block_stop", index=0),
        delta(1, "input_json_delta", partial_json='{"engagement"'),
        SimpleNamespace(type="message_stop"),
    ]


class _Stream:
    def __init__(self) -> None:
        self.get_final_message = AsyncMock(return_value=_message())

    def __aiter__(self) -> Any:
        async def gen() -> Any:
            for e in _events():
                yield e
        return gen()


def _client() -> Any:
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=_Stream())
    ctx.__aexit__ = AsyncMock(return_value=False)
    return SimpleNamespace(messages=SimpleNamespace(
        create=AsyncMock(return_value=_message()),
        stream=MagicMock(return_value=ctx),
    ))


async def _call(client: Any, on_text: Any) -> tuple[list[dict[str, Any]], Any]:
    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client.fire_and_forget_persist") as persist,
    ):
        blocks = await call_claude_conversation(
            "system", [{"role": "user", "content": "hello"}],
            "integrity_agent", tool_schemas=[], temperature=0.0,
            submission_id="sub", call_metadata={"loop_iter": 0},
            on_text=on_text,
        )
    return blocks, persist


@pytest.mark.asyncio
async def test_on_text_streams_text_deltas_only() -> None:
    seen: list[tuple[int, str]] = []

    async def on_text(i: int, t: str) -> None:
        seen.append((i, t))

    client = _client()
    await _call(client, on_text)
    assert seen == [(0, "Why did you "), (0, "divide by 2?")]
    assert not client.messages.create.called


@pytest.mark.asyncio
async def test_streamed_call_is_the_same_call() -> None:
    """Same request kwargs, same blocks back, same llm_calls row."""
    async def on_text(i: int, t: str) -> None:
        pass

    plain_client, streamed_client = _client(), _client()
    plain_blocks, plain_persist = await _call(plain_client, None)
    streamed_blocks, streamed_persist = await _call(streamed_client, on_text)

    assert not plain_client.messages.stream.called
    assert (
        streamed_client.messages.stream.call_args.kwargs
        == plain_client.messages.create.call_args.kwargs
    )
    assert streamed_blocks == plain_blocks
    plain_row = dict(plain_persist.call_args.kwargs)
    streamed_row = dict(streamed_persist.call_args.kwargs)
    plain_row.pop("latency_ms")
    streamed_row.pop("latency_ms")
    assert streamed_row == plain_row
    assert streamed_row["input_tokens"] == 321
    assert streamed_row["cache_read_tokens"] == 2_048


@pytest.mark.asyncio
async def test_cassette_key_ignores_on_text_and_replay_feeds_it(
    tmp_path: Any, monkeypatch: Any,
) -> None:
    """A streamed call hits the cassette a non-streamed one recorded (the
    callback isn't part of the key), and a replay hands the recorded
    text to the callback, so the harness drives the streamed path at $0."""
    monkeypatch.setenv("HARNESS_CASSETTE_DIR", str(tmp_path))
    monkeypatch.setenv("HARNESS_LLM_MODE", "record")
    cass_mod._instance = None
    try:
        recorded, _ = await _call(_client(), None)

        monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
        cass_mod._instance = None
        seen: list[tuple[int, str]] = []

        async def on_text(i: int, t: str) -> None:
            seen.append((i, t))

        live = _client()
        replayed, _ = await _call(live, on_text)
        assert replayed == recorded
        assert not live.messages.stream.called
        assert seen == [(0, "Why did you divide by 2?")]
    finally:
        cass_mod._instance = None
