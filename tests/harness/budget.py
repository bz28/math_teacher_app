"""A hard spending cap for a live (recording) eval run.

Every live model call is priced from its usage as it comes back, and a new
call is refused before it starts once the run's spend plus a reserve for
the calls already in flight would pass the cap: the run stops with a clear
message instead of running over. Replayed calls (cassette hits) cost
nothing and never reach either hook.

    with spending_cap("unit-5-proofs", cap_usd=5.0) as spend:
        ...  # run the cases
    print(spend.row())
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

# $ per million tokens: (input, output, cache read, cache write).
_SONNET = (3.0, 15.0, 0.30, 3.75)
_RATES = {"sonnet": _SONNET, "haiku": (1.0, 5.0, 0.10, 1.25)}
# A model not named above is priced high, so the cap errs on the safe side.
_UNKNOWN = (15.0, 75.0, 1.50, 18.75)


class SpendingCapError(RuntimeError):
    """The next call could take the run past its cap."""


def _rates(model: str) -> tuple[float, float, float, float]:
    m = model.lower()
    return next((r for k, r in _RATES.items() if k in m), _UNKNOWN)


def price(model: str, tokens_in: int, tokens_out: int, cache_read: int = 0, cache_write: int = 0) -> float:
    i, o, r, w = _rates(model)
    return (tokens_in * i + tokens_out * o + cache_read * r + cache_write * w) / 1_000_000


@dataclass
class Spend:
    name: str
    cap_usd: float
    # The most one call can cost (4096 output tokens and a long prompt at
    # Sonnet rates is about $0.10), held back for each call in flight.
    reserve_usd: float = 0.15
    usd: float = 0.0
    calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    cache_read: int = 0
    cache_write: int = 0
    in_flight: int = 0
    by_mode: dict[str, float] = field(default_factory=dict)
    stopped: str = ""

    def before_call(self) -> None:
        if self.usd + (self.in_flight + 1) * self.reserve_usd > self.cap_usd:
            self.stopped = (
                f"SPENDING CAP: set {self.name!r} stopped at ${self.usd:.2f} of ${self.cap_usd:.2f} "
                f"({self.calls} calls, {self.in_flight} in flight); the next call could pass the cap."
            )
            raise SpendingCapError(self.stopped)
        self.in_flight += 1

    def after_call(self, model: str, mode: str, tokens_in: int, tokens_out: int,
                   cache_read: int, cache_write: int) -> None:
        cost = price(model, tokens_in, tokens_out, cache_read, cache_write)
        self.in_flight = max(0, self.in_flight - 1)
        self.usd += cost
        self.calls += 1
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        self.cache_read += cache_read
        self.cache_write += cache_write
        self.by_mode[mode] = self.by_mode.get(mode, 0.0) + cost

    def row(self, problems: int = 0) -> dict[str, Any]:
        return {
            "set": self.name, "calls": self.calls, "tokens_in": self.tokens_in, "tokens_out": self.tokens_out,
            "cache_read": self.cache_read, "cache_write": self.cache_write, "usd": round(self.usd, 4),
            "problems": problems, "usd_per_problem": round(self.usd / problems, 4) if problems else None,
            "by_mode": {k: round(v, 4) for k, v in sorted(self.by_mode.items())}, "stopped": self.stopped,
        }


@contextlib.contextmanager
def spending_cap(name: str, cap_usd: float = 5.0) -> Iterator[Spend]:
    """Price every live call of the block and refuse the one that could
    pass `cap_usd`. Hooks the client's own cost check (run before each live
    call) and its call log (run after each, with the usage)."""
    from api.core import llm_client

    spend = Spend(name, cap_usd)
    real_log = llm_client._log_and_persist
    tracker = llm_client.cost_tracker
    real_check = tracker.check_limit

    async def check() -> None:
        spend.before_call()
        await real_check()

    async def log(model: str, mode: str, input_tokens: int, output_tokens: int, *args: Any, **kwargs: Any) -> None:
        spend.after_call(model, mode, input_tokens, output_tokens,
                         int(kwargs.get("cache_read_tokens") or 0), int(kwargs.get("cache_write_tokens") or 0))
        await real_log(model, mode, input_tokens, output_tokens, *args, **kwargs)

    llm_client._log_and_persist = log  # type: ignore[assignment]
    tracker.check_limit = check  # type: ignore[method-assign]
    try:
        yield spend
    finally:
        llm_client._log_and_persist = real_log  # type: ignore[assignment]
        tracker.check_limit = real_check  # type: ignore[method-assign]
