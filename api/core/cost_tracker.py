"""Daily cost tracking for LLM API calls.

Shared across all modules that make Claude calls to enforce a single
daily spend limit.
"""

import datetime
import logging
from dataclasses import dataclass, field

from api.config import settings

logger = logging.getLogger(__name__)


@dataclass
class CostTracker:
    _total_usd: float = field(default=0.0, init=False)
    _reset_day: int = field(default=0, init=False)

    def _maybe_reset(self) -> None:
        today = datetime.date.today().toordinal()
        if today != self._reset_day:
            self._total_usd = 0.0
            self._reset_day = today

    def check_limit(self) -> None:
        """Raise if daily cost limit has been reached."""
        self._maybe_reset()
        if self._total_usd >= settings.daily_cost_limit_usd:
            raise RuntimeError(
                f"Daily cost limit reached "
                f"(${self._total_usd:.2f} >= ${settings.daily_cost_limit_usd:.2f})"
            )

    def add(self, amount: float) -> None:
        self._maybe_reset()
        self._total_usd += amount
        if self._total_usd >= settings.daily_cost_limit_usd:
            logger.error(
                "Daily cost limit exceeded: $%.2f >= $%.2f",
                self._total_usd,
                settings.daily_cost_limit_usd,
            )

    @property
    def total_usd(self) -> float:
        self._maybe_reset()
        return self._total_usd


cost_tracker = CostTracker()
