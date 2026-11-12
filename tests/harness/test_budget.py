"""The eval's hard spending cap (tests/harness/budget.py)."""

from __future__ import annotations

import pytest

from api.core import llm_client
from tests.harness.budget import Spend, SpendingCapError, price, spending_cap


def test_prices_at_the_stated_rates() -> None:
    # Sonnet: $3/M in, $15/M out, $0.30/M cache read, $3.75/M cache write.
    assert price("claude-sonnet-4-6", 1_000_000, 0) == pytest.approx(3.0)
    assert price("claude-sonnet-4-6", 0, 1_000_000) == pytest.approx(15.0)
    assert price("claude-sonnet-4-6", 0, 0, 1_000_000, 1_000_000) == pytest.approx(0.30 + 3.75)
    # A model it doesn't know is priced high, never low.
    assert price("some-new-model", 1_000_000, 0) > 3.0


def test_refuses_the_call_that_could_pass_the_cap() -> None:
    spend = Spend("s", cap_usd=1.0, reserve_usd=0.15)
    for _ in range(3):
        spend.before_call()
        spend.after_call("claude-sonnet-4-6", "m", 10_000, 10_000, 0, 0)  # $0.18 each
    assert spend.usd == pytest.approx(0.54) and spend.calls == 3
    spend.before_call()  # 0.54 + 0.15 <= 1.0
    spend.before_call()  # 0.54 + 2 × 0.15 <= 1.0
    spend.before_call()  # 0.54 + 3 × 0.15 <= 1.0
    with pytest.raises(SpendingCapError, match="set 's' stopped at \\$0.54"):
        spend.before_call()  # 0.54 + 4 × 0.15 > 1.0
    assert spend.stopped


@pytest.mark.asyncio
async def test_hooks_the_client_and_restores_it() -> None:
    real_log, real_check = llm_client._log_and_persist, llm_client.cost_tracker.check_limit
    with spending_cap("s", cap_usd=5.0) as spend:
        assert llm_client._log_and_persist is not real_log
        await llm_client.cost_tracker.check_limit()
        assert spend.in_flight == 1
    assert llm_client._log_and_persist is real_log
    assert llm_client.cost_tracker.check_limit == real_check


@pytest.mark.asyncio
async def test_a_live_call_past_the_cap_never_starts() -> None:
    with spending_cap("s", cap_usd=0.1), pytest.raises(SpendingCapError):
        await llm_client.cost_tracker.check_limit()
