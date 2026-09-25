"""call_claude_json re-asks the model when an array field comes back unparseable.

Prod (Sep 2026): the solve call returned `steps` as a JSON *string* with
unescaped quotes. `_normalize_arrays` left it in place, the call logged as a
success, and `_parse_decomposition` then raised outside the retry loop — so
the bank item was saved as "(solution failed — please solve manually)".
`_normalize_arrays` now raises; these pin that the raise reaches the retry
loop and that the retry is a fresh model call, not a re-parse.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core.llm_client import LLMMode, call_claude_json
from api.core.llm_schemas import DECOMPOSITION_SCHEMA

_BAD_STEPS = '[{"title": "t", "description": "the form **"If $p$, then $q$"**"}]'
_GOOD_STEPS = [{"title": "t", "description": 'the form **"If $p$, then $q$"**'}]


def _response(steps: Any) -> SimpleNamespace:
    return SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(
            type="tool_use",
            input={"steps": steps, "final_answer": "x", "answer_type": "text"},
        )],
        usage=SimpleNamespace(
            input_tokens=10, output_tokens=5,
            cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
    )


@pytest.mark.asyncio
async def test_unparseable_array_is_retried_with_a_fresh_call() -> None:
    create = AsyncMock(side_effect=[_response(_BAD_STEPS), _response(_GOOD_STEPS)])
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    logged: list[dict[str, Any]] = []

    async def fake_log(*_args: Any, **kwargs: Any) -> None:
        logged.append(kwargs)

    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", side_effect=fake_log),
        patch("api.core.llm_client.asyncio.sleep", new=AsyncMock()),
    ):
        result = await call_claude_json(
            "system", "user", LLMMode.DECOMPOSE, tool_schema=DECOMPOSITION_SCHEMA,
        )

    assert result["steps"] == _GOOD_STEPS
    assert create.await_count == 2  # the model was asked again
    # The bad attempt is recorded as a failure naming the field, not a success.
    assert [row["success"] for row in logged] == [False, True]
    assert "'steps'" in logged[0]["output_text"]


@pytest.mark.asyncio
async def test_persistently_unparseable_array_fails_loudly() -> None:
    create = AsyncMock(return_value=_response(_BAD_STEPS))
    client = SimpleNamespace(messages=SimpleNamespace(create=create))

    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", new=AsyncMock()),
        patch("api.core.llm_client.asyncio.sleep", new=AsyncMock()),
    ):
        with pytest.raises(RuntimeError, match="'steps'"):
            await call_claude_json(
                "system", "user", LLMMode.DECOMPOSE,
                tool_schema=DECOMPOSITION_SCHEMA, max_retries=3,
            )
    assert create.await_count == 3
