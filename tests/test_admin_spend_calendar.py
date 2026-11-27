"""Unit tests for admin_school_overview helper math.

Full integration tests against the endpoint require admin-auth
fixtures + a multi-school seed pattern that doesn't yet exist in
this codebase; deferred. These pure-function tests at least lock
in the calendar wraparound and projection math, which is where
date-arithmetic bugs typically hide.
"""

from datetime import UTC, datetime

from api.routes.admin_school_overview import _month_window


def test_month_window_january_wraps_to_december() -> None:
    """Last-month start in January should land on December of prior year."""
    now = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)
    this_start, last_start, this_end = _month_window(now)
    assert this_start == datetime(2026, 1, 1, tzinfo=UTC)
    assert last_start == datetime(2025, 12, 1, tzinfo=UTC)
    # 31 days in January 2026
    assert this_end == datetime(2026, 2, 1, tzinfo=UTC)


def test_month_window_mid_year() -> None:
    """A non-edge month gets the obvious previous-month start."""
    now = datetime(2026, 7, 20, 0, 0, 0, tzinfo=UTC)
    this_start, last_start, this_end = _month_window(now)
    assert this_start == datetime(2026, 7, 1, tzinfo=UTC)
    assert last_start == datetime(2026, 6, 1, tzinfo=UTC)
    assert this_end == datetime(2026, 8, 1, tzinfo=UTC)


def test_month_window_february_leap_year() -> None:
    """February in a leap year should produce a 29-day window."""
    now = datetime(2024, 2, 15, tzinfo=UTC)
    this_start, _last_start, this_end = _month_window(now)
    assert (this_end - this_start).days == 29


def test_month_window_february_non_leap() -> None:
    """February in a non-leap year should produce a 28-day window."""
    now = datetime(2025, 2, 15, tzinfo=UTC)
    this_start, _last_start, this_end = _month_window(now)
    assert (this_end - this_start).days == 28


def test_month_window_first_day_of_month() -> None:
    """At midnight on the first, this_month_start should equal `now`."""
    now = datetime(2026, 5, 1, 0, 0, 0, tzinfo=UTC)
    this_start, last_start, _this_end = _month_window(now)
    assert this_start == now
    assert last_start == datetime(2026, 4, 1, tzinfo=UTC)


def test_month_window_last_moment_of_month() -> None:
    """Just before midnight on the 31st should still anchor to the 1st."""
    now = datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC)
    this_start, _last, this_end = _month_window(now)
    assert this_start == datetime(2026, 1, 1, tzinfo=UTC)
    assert this_end == datetime(2026, 2, 1, tzinfo=UTC)
