"""Calendar arithmetic behind every month, week and projection the admin
console shows (api/routes/admin_spend.py) — where date bugs hide."""

from datetime import UTC, datetime

from api.routes.admin_spend import _bucket_start, _month_start, _step


def test_last_month_of_january_is_december_of_the_prior_year() -> None:
    now = datetime(2026, 1, 15, 12, 0, 0, tzinfo=UTC)
    start = _month_start(now)
    assert start == datetime(2026, 1, 1, tzinfo=UTC)
    assert _step(start, "month", -1) == datetime(2025, 12, 1, tzinfo=UTC)
    assert _step(start, "month") == datetime(2026, 2, 1, tzinfo=UTC)


def test_month_steps_cross_year_ends_both_ways() -> None:
    assert _step(datetime(2026, 12, 1, tzinfo=UTC), "month") == datetime(2027, 1, 1, tzinfo=UTC)
    assert _step(datetime(2026, 3, 1, tzinfo=UTC), "month", -5) == datetime(2025, 10, 1, tzinfo=UTC)


def test_first_moment_and_last_moment_of_a_month() -> None:
    assert _month_start(datetime(2026, 5, 1, tzinfo=UTC)) == datetime(2026, 5, 1, tzinfo=UTC)
    assert _month_start(datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC)) == datetime(
        2026, 1, 1, tzinfo=UTC,
    )


def test_week_buckets_start_on_monday_like_postgres() -> None:
    # 2026-11-26 is a Thursday.
    assert _bucket_start(datetime(2026, 11, 26, 19, 0, tzinfo=UTC), "week") == datetime(
        2026, 11, 23, tzinfo=UTC,
    )
    assert _bucket_start(datetime(2026, 11, 23, 0, 0, tzinfo=UTC), "week") == datetime(
        2026, 11, 23, tzinfo=UTC,
    )
