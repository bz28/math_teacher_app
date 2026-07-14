"""Shared utilities for admin route modules."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
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
