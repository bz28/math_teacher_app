"""Shared utilities for admin route modules."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.selectable import Subquery

from api.models.activity_log import ActivityLog

# The literal `school_id` value the dashboard sends to scope a query
# to LLMCall rows with `school_id IS NULL`. Post-bp1000059 every
# teacher/student is linked to a school (real or synthetic
# 'individual'), so the bucket is now admin/system calls plus the
# legacy pre-backfill snapshots from indie teachers. Defined here so
# the wire contract stays in one place and the dashboard's
# INTERNAL_SCHOOL_ID matches trivially.
INTERNAL_SCHOOL_SENTINEL = "internal"


def time_range(hours: int) -> datetime:
    """Return a datetime `hours` ago from now (UTC)."""
    return datetime.now(UTC) - timedelta(hours=hours)


@dataclass(frozen=True)
class Window:
    """A reporting window [start, end). The one definition every admin
    number reads its "last 30 days" (or 7, or a custom range) from, so two
    pages can't disagree about what "this month's spend" covers."""

    start: datetime
    end: datetime

    def covers(self, col: InstrumentedAttribute[datetime]) -> ColumnElement[bool]:
        return and_(col >= self.start, col < self.end)

    def previous(self) -> "Window":
        """The same-length window immediately before this one."""
        return Window(self.start - (self.end - self.start), self.start)


def last_days(days: int, now: datetime | None = None) -> Window:
    """The rolling window ending now. `days=30` is the console's default."""
    end = now or datetime.now(UTC)
    return Window(end - timedelta(days=days), end)


def resolve_window(
    hours: int, date_from: date | None = None, date_to: date | None = None,
) -> Window:
    """A preset (`hours` back from now) unless a custom range is given.

    A custom range is whole UTC days, both ends inclusive: from=2026-11-01
    to=2026-11-07 is the seven days of that week. Either end alone is
    allowed (open-ended to now, or from the beginning).
    """
    if date_from is None and date_to is None:
        end = datetime.now(UTC)
        return Window(end - timedelta(hours=hours), end)
    start = (
        datetime.combine(date_from, time.min, tzinfo=UTC)
        if date_from else datetime(2000, 1, 1, tzinfo=UTC)
    )
    end = (
        datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC)
        if date_to else datetime.now(UTC)
    )
    if end <= start:
        raise HTTPException(status_code=400, detail="'from' must be on or before 'to'")
    return Window(start, end)


def activity_last_action_sq(
    group_col: InstrumentedAttribute[Any], since: datetime | None = None
) -> Subquery:
    """Subquery of the most-recent ActivityLog action per `group_col`.

    `group_col` is the ActivityLog column that attributes an action to
    an entity — `ActivityLog.actor_user_id` for a per-user rollup, or
    `ActivityLog.school_id` for a per-school one. Returns a grouped
    subquery with columns `gid` (the group key) and `last_action_at`
    (`max(performed_at)`), so it joins in as a single round trip
    (no N+1), matching the count/cost subquery pattern already used in
    these routes.

    Pass `since` to bound the lookback to the same window the caller's
    other recency signal uses (e.g. the `/users` session window), so
    the two are directly comparable under `greatest()`. Omit it for an
    all-time rollup (e.g. `/schools`, whose submission recency is
    all-time).

    Folds teacher writes that leave no session/submission (grade,
    publish) into an entity's "last active" signal — the gap the
    session/submission-only recency fields miss.
    """
    filters: list[Any] = [group_col.isnot(None)]
    if since is not None:
        filters.append(ActivityLog.performed_at >= since)
    return (
        select(
            group_col.label("gid"),
            func.max(ActivityLog.performed_at).label("last_action_at"),
        )
        .where(*filters)
        .group_by(group_col)
        .subquery()
    )
