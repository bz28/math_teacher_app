"""Prompt-cache token accounting.

Anthropic reports prompt-cache traffic in `cache_read_input_tokens` and
`cache_creation_input_tokens`, SEPARATE from `input_tokens`. We used to
read only `input_tokens`, which meant every cached call was
under-priced and a cache hit was indistinguishable from a short prompt —
so there was no way to tell whether the `cache_control` we send was ever
working.

Covers:
1. `_calc_cost` prices cache reads at 0.1x and writes at 1.25x the
   model's base input rate, on top of uncached input + output.
2. Zero cache traffic prices exactly as before (no drift for the
   uncached path, which is most calls).
3. `call_claude_json` pulls both usage fields off the response and
   forwards them to the persistence layer.
4. A response whose usage block omits the cache fields entirely (older
   SDK, or a call that touched no cache) degrades to 0/0 rather than
   raising inside the logging path of an otherwise-successful call.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core.llm_client import (
    _CACHE_READ_MULT,
    _CACHE_WRITE_MULT,
    MODEL_SONNET,
    _calc_cost,
    _usage_cache_tokens,
    call_claude_json,
)

# Sonnet base rates, mirrored from _PRICING.
_IN = 3.0 / 1_000_000
_OUT = 15.0 / 1_000_000

_SCHEMA: Any = {
    "name": "emit",
    "description": "emit a result",
    "input_schema": {
        "type": "object",
        "properties": {"ok": {"type": "boolean"}},
        "required": ["ok"],
    },
}


def test_calc_cost_prices_cache_traffic_at_platform_multipliers() -> None:
    cost = _calc_cost(
        MODEL_SONNET,
        input_tokens=1_000,
        output_tokens=500,
        cache_read_tokens=10_000,
        cache_write_tokens=2_000,
    )
    expected = (
        1_000 * _IN
        + 500 * _OUT
        + 10_000 * _IN * _CACHE_READ_MULT
        + 2_000 * _IN * _CACHE_WRITE_MULT
    )
    assert cost == pytest.approx(expected)

    # A read must be an order of magnitude cheaper than sending the same
    # tokens fresh — that discount is the whole point of caching.
    fresh = _calc_cost(MODEL_SONNET, input_tokens=10_000, output_tokens=0)
    cached = _calc_cost(
        MODEL_SONNET, input_tokens=0, output_tokens=0, cache_read_tokens=10_000,
    )
    assert cached == pytest.approx(fresh * _CACHE_READ_MULT)


def test_calc_cost_without_cache_traffic_is_unchanged() -> None:
    """The uncached path must not drift — it's still most calls."""
    assert _calc_cost(MODEL_SONNET, 1_000, 500) == pytest.approx(
        1_000 * _IN + 500 * _OUT,
    )
    assert _calc_cost(MODEL_SONNET, 1_000, 500, 0, 0) == pytest.approx(
        _calc_cost(MODEL_SONNET, 1_000, 500),
    )


def test_usage_cache_tokens_degrades_to_zero_when_fields_absent() -> None:
    """Both fields are absent on responses that touched no cache. Missing
    usage data must never raise inside the logging path."""
    assert _usage_cache_tokens(SimpleNamespace()) == (0, 0)
    assert _usage_cache_tokens(
        SimpleNamespace(cache_read_input_tokens=None,
                        cache_creation_input_tokens=None),
    ) == (0, 0)
    assert _usage_cache_tokens(
        SimpleNamespace(cache_read_input_tokens=7,
                        cache_creation_input_tokens=9),
    ) == (7, 9)


@pytest.mark.asyncio
async def test_call_claude_json_forwards_cache_tokens_to_persistence() -> None:
    response = SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", input={"ok": True})],
        usage=SimpleNamespace(
            input_tokens=120,
            output_tokens=30,
            cache_read_input_tokens=4_096,
            cache_creation_input_tokens=0,
        ),
    )
    client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=response)),
    )

    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client.fire_and_forget_persist") as persist,
    ):
        result = await call_claude_json(
            "system", "user", "ai_grading", tool_schema=_SCHEMA,
            model=MODEL_SONNET,
        )

    assert result == {"ok": True}
    kwargs = persist.call_args.kwargs
    assert kwargs["cache_read_tokens"] == 4_096
    assert kwargs["cache_write_tokens"] == 0
    # input_tokens stays the UNCACHED remainder — the cached prefix must
    # not be double-counted into it.
    assert kwargs["input_tokens"] == 120
    assert kwargs["cost_usd"] == pytest.approx(
        round(_calc_cost(MODEL_SONNET, 120, 30, 4_096, 0), 6),
    )
