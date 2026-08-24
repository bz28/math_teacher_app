"""Daily cost tracking for LLM API calls.

Shared across all modules that make Claude calls to enforce a single
daily spend limit. Uses asyncio.Lock to prevent concurrent requests
from racing past the limit.

"Daily" means a UTC day. Everything else in this codebase timestamps in
UTC, and the cap resetting at the server's local midnight would mean the
spend window silently moves whenever the deploy region does.
"""

import asyncio
import datetime
import logging
from dataclasses import dataclass, field

from api.config import settings

logger = logging.getLogger(__name__)


class PlatformStopError(RuntimeError):
    """The platform said stop, and it is not this request's fault.

    Raised when a shared limit trips — the daily spend cap, the LLM
    circuit breaker — as opposed to something wrong with the specific
    work being attempted. Callers that retry need this distinction:
    a platform stop hits every in-flight job at once, so charging each
    one a retry burns whole batches of perfectly good work in minutes.

    A TYPE rather than a message convention on purpose. This started as
    a substring match on the exception text, which silently stopped
    working because the cap's wording ("Daily cost limit reached") and
    the guard's markers ("cost cap", "daily cap") were never the same
    words.
    """


@dataclass
class CostTracker:
    _total_usd: float = field(default=0.0, init=False)
    _reset_day: int = field(default=0, init=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)

    @staticmethod
    def _utc_day() -> int:
        return datetime.datetime.now(datetime.UTC).date().toordinal()

    def _maybe_reset(self) -> None:
        today = self._utc_day()
        if today != self._reset_day:
            self._total_usd = 0.0
            self._reset_day = today

    async def check_limit(self) -> None:
        """Raise if daily cost limit has been reached."""
        async with self._lock:
            self._maybe_reset()
            if self._total_usd >= settings.daily_cost_limit_usd:
                raise PlatformStopError(
                    f"Daily cost limit reached "
                    f"(${self._total_usd:.2f} >= ${settings.daily_cost_limit_usd:.2f})"
                )

    async def add(self, amount: float) -> None:
        """Track cost under lock to prevent concurrent modifications.

        Note: there is still a TOCTOU window between check_limit() and add()
        (the API call sits in between), so concurrent requests can overshoot
        the limit by up to N_concurrent * max_single_call_cost. For a $50
        daily limit this is bounded and acceptable.
        """
        async with self._lock:
            self._maybe_reset()
            self._total_usd += amount
            if self._total_usd >= settings.daily_cost_limit_usd:
                logger.error(
                    "Daily cost limit exceeded: $%.2f >= $%.2f",
                    self._total_usd,
                    settings.daily_cost_limit_usd,
                )

    def reset(self) -> None:
        """Reset accumulated spend to zero. Used by tests to keep the
        process-global tracker from bleeding cost across test cases."""
        self._total_usd = 0.0
        self._reset_day = self._utc_day()

    @property
    def total_usd(self) -> float:
        self._maybe_reset()
        return self._total_usd

    def remaining_budget(self) -> float:
        """Return remaining daily budget in USD."""
        self._maybe_reset()
        return max(0.0, settings.daily_cost_limit_usd - self._total_usd)


cost_tracker = CostTracker()
