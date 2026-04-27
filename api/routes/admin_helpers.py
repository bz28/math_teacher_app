"""Shared utilities for admin route modules."""

from datetime import UTC, datetime, timedelta

# The literal `school_id` value the dashboard sends to scope a query
# to "users with school_id IS NULL" — i.e. the founder, test
# accounts, and any non-school learners. Keeping this in one place
# means the wire contract is defined once for every admin endpoint
# and the dashboard's INTERNAL_SCHOOL_ID stays in sync trivially.
INTERNAL_SCHOOL_SENTINEL = "internal"


def time_range(hours: int) -> datetime:
    """Return a datetime `hours` ago from now (UTC)."""
    return datetime.now(UTC) - timedelta(hours=hours)
