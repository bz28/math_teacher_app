"""Shared utilities for admin route modules."""

from datetime import UTC, datetime, timedelta


def time_range(hours: int) -> datetime:
    """Return a datetime `hours` ago from now (UTC)."""
    return datetime.now(UTC) - timedelta(hours=hours)
