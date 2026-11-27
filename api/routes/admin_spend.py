"""Actual spend — what we paid for LLM calls, and where it went.

One endpoint for the Costs page's Spend tab, and the one place the
console computes a month, a projection, or a trend, so a school's page
and the Costs page can't disagree about "this month":

  headline   this month, last month, projected month-end (straight-line
             run rate, with a low-high range from the spread of recent
             full weeks), last 30 days vs the 30 before
  series     spend per day / week / month, ending now, empty buckets kept
  breakdown  the window's spend by school, teacher, student, function or
             model, each row a key the dashboard drills into

Whose call it is reads the one rule in api/core/llm_attribution.py; the
window reads admin_helpers.resolve_window. Internal traffic (calls stamped
with no school) and teachers' preview-as-student work are left out unless
asked for: neither is a customer's usage.
"""

import calendar
import uuid as uuid_lib
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import ColumnElement, and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.llm_attribution import call_owners, not_preview, school_calls
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.user import User
from api.routes.admin_helpers import (
    INTERNAL_SCHOOL_SENTINEL,
    Window,
    last_days,
    resolve_window,
)

router = APIRouter()

Bucket = Literal["day", "week", "month"]
GroupBy = Literal["school", "teacher", "student", "function", "model"]

# How far back the trend reaches, per bucket. Fixed rather than the
# breakdown's window: the chart is "how has spend moved", the table is
# "where did this window's spend go".
SERIES_PERIODS: dict[str, int] = {"day": 30, "week": 12, "month": 6}

# The widest window /spend groups over: a school year and change.
MAX_RANGE_DAYS = 366

# Full weeks the projection's range reads its spread from.
_RANGE_WEEKS = 8


def _utc_trunc(bucket: str) -> Any:
    """date_trunc in UTC whatever the session's TimeZone, so bucket edges
    line up with the Python-side calendar."""
    return func.date_trunc(bucket, func.timezone("UTC", LLMCall.created_at))


def _spend() -> Any:
    return func.coalesce(func.sum(LLMCall.cost_usd), 0.0)


def customer_calls() -> ColumnElement[bool]:
    """Calls a customer's usage caused: stamped with a school, not preview."""
    return and_(LLMCall.school_id.isnot(None), not_preview())


async def _total(db: AsyncSession, conds: list[Any], window: Window) -> float:
    return float((await db.execute(
        select(_spend()).where(*conds, window.covers(LLMCall.created_at)),
    )).scalar() or 0.0)


def _month_start(d: datetime) -> datetime:
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _week_start(d: datetime) -> datetime:
    """Monday 00:00 UTC — what Postgres date_trunc('week') returns."""
    return (d - timedelta(days=d.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )


def _step(start: datetime, bucket: str, n: int = 1) -> datetime:
    if bucket == "day":
        return start + timedelta(days=n)
    if bucket == "week":
        return start + timedelta(weeks=n)
    month = start.month - 1 + n
    return start.replace(year=start.year + month // 12, month=month % 12 + 1)


def _bucket_start(d: datetime, bucket: str) -> datetime:
    if bucket == "day":
        return d.replace(hour=0, minute=0, second=0, microsecond=0)
    if bucket == "week":
        return _week_start(d)
    return _month_start(d)


async def spend_series(
    db: AsyncSession, conds: list[Any], bucket: str, now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Spend per bucket, oldest first, the current (partial) bucket last.
    Buckets with no calls are kept as zeros, so a quiet week reads as a
    quiet week rather than vanishing from the chart."""
    now = now or datetime.now(UTC)
    periods = SERIES_PERIODS[bucket]
    first = _step(_bucket_start(now, bucket), bucket, -(periods - 1))
    trunc = _utc_trunc(bucket).label("bucket")
    rows = (await db.execute(
        select(trunc, _spend().label("cost"), func.count().label("calls"))
        .where(*conds, LLMCall.created_at >= first, LLMCall.created_at < now)
        .group_by(trunc)
    )).all()
    found = {r.bucket.replace(tzinfo=UTC): r for r in rows}
    out = []
    start = first
    for _ in range(periods):
        r = found.get(start)
        out.append({
            "start": start.date().isoformat(),
            "cost": round(float(r.cost), 4) if r else 0.0,
            "calls": int(r.calls) if r else 0,
            "partial": _step(start, bucket) > now,
        })
        start = _step(start, bucket)
    return out


async def spend_headline(
    db: AsyncSession, conds: list[Any], now: datetime | None = None,
) -> dict[str, Any]:
    """This month, last month, the month-end projection, and 30d vs prior."""
    now = now or datetime.now(UTC)
    month_start = _month_start(now)
    last_month_start = _step(month_start, "month", -1)
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    month_end = month_start + timedelta(days=days_in_month)

    this_month = await _total(db, conds, Window(month_start, now))
    last_month = await _total(db, conds, Window(last_month_start, month_start))
    last_30 = last_days(30, now)
    cost_30d = await _total(db, conds, last_30)
    cost_prev_30d = await _total(db, conds, last_30.previous())

    # The range: the rest of the month at the slowest and the fastest of
    # the last few FULL weeks. A quiet week is a slow week and counts —
    # unless it's before this spend ever began, when it's before we
    # existed. "Ever", not "in the range": a winter break at the start of
    # the range is still a real slow week for a year-old customer.
    this_week = _week_start(now)
    first_ever = (await db.execute(
        select(func.min(LLMCall.created_at)).where(*conds, LLMCall.created_at < this_week)
    )).scalar()
    weeks = (await db.execute(
        select(
            _utc_trunc("week").label("week"),
            _spend().label("cost"),
        )
        .where(
            *conds,
            LLMCall.created_at >= this_week - timedelta(weeks=_RANGE_WEEKS),
            LLMCall.created_at < this_week,
        )
        .group_by("week")
    )).all()
    weekly = {r.week.replace(tzinfo=UTC): float(r.cost) for r in weeks}
    full_weeks: list[float] = []
    if first_ever is not None:
        start = max(this_week - timedelta(weeks=_RANGE_WEEKS), _week_start(first_ever))
        while start < this_week:
            full_weeks.append(weekly.get(start, 0.0))
            start += timedelta(weeks=1)
    remaining_weeks = max((month_end - now).total_seconds(), 0.0) / 86400.0 / 7

    # Straight-line run rate: this month so far, per elapsed day, times the
    # month. In the month's first day there's no rate to read yet (a few
    # hours' spend over a clamped whole day reads ~1/8 of the truth), so
    # the rest of the month goes at the recent full weeks' average.
    elapsed_days = (now - month_start).total_seconds() / 86400.0
    if elapsed_days < 1.0 and full_weeks:
        projected = this_month + sum(full_weeks) / len(full_weeks) * remaining_weeks
    else:
        projected = this_month / max(elapsed_days, 1.0) * days_in_month
    if len(full_weeks) >= 2:
        low = this_month + min(full_weeks) * remaining_weeks
        high = this_month + max(full_weeks) * remaining_weeks
    else:
        low = high = projected

    return {
        "month_start": month_start.date().isoformat(),
        "this_month": round(this_month, 4),
        "last_month": round(last_month, 4),
        "projected_month_end": round(projected, 4),
        "projected_low": round(min(low, projected), 4),
        "projected_high": round(max(high, projected), 4),
        "range_weeks": len(full_weeks),
        "cost_30d": round(cost_30d, 4),
        "cost_prev_30d": round(cost_prev_30d, 4),
        "change_30d_pct": (
            round((cost_30d - cost_prev_30d) / cost_prev_30d * 100, 1)
            if cost_prev_30d else None
        ),
    }


async def _breakdown(
    db: AsyncSession, conds: list[Any], group_by: str,
) -> list[dict[str, Any]]:
    """The window's spend per `group_by`, biggest first.

    Teacher and student rows read the whose-call rule: a student's
    graded homework counts for the student AND their teacher. So those
    rows don't sum to the total, and the remainder (calls tied to no
    teacher, or no student) is its own row rather than silently dropped.
    """
    if group_by in ("function", "model"):
        col = LLMCall.function if group_by == "function" else LLMCall.model
        rows = (await db.execute(
            select(col.label("key"), func.count().label("calls"), _spend().label("cost"))
            .where(*conds).group_by(col)
        )).all()
        return [
            {"key": r.key, "label": r.key, "calls": int(r.calls), "cost": float(r.cost)}
            for r in rows
        ]

    if group_by == "school":
        rows = (await db.execute(
            select(
                LLMCall.school_id.label("key"), School.name.label("label"),
                func.count().label("calls"), _spend().label("cost"),
            )
            .outerjoin(School, School.id == LLMCall.school_id)
            .where(*conds).group_by(LLMCall.school_id, School.name)
        )).all()
        return [
            {
                "key": str(r.key) if r.key else INTERNAL_SCHOOL_SENTINEL,
                "label": r.label or "Internal",
                "calls": int(r.calls), "cost": float(r.cost),
            }
            for r in rows
        ]

    role = group_by  # "teacher" | "student"
    people = select(User.id).where(User.role == role)
    owners = call_owners(*conds, owners_in=people)
    rows = (await db.execute(
        select(
            owners.c.owner_id.label("key"), User.name.label("label"),
            User.school_id.label("school_id"),
            func.count().label("calls"), _spend().label("cost"),
        )
        .select_from(owners)
        .join(LLMCall, LLMCall.id == owners.c.call_id)
        .join(User, User.id == owners.c.owner_id)
        .group_by(owners.c.owner_id, User.name, User.school_id)
    )).all()
    out = [
        {
            "key": str(r.key), "label": r.label or "(no name)",
            "school_id": str(r.school_id) if r.school_id else None,
            "calls": int(r.calls), "cost": float(r.cost),
        }
        for r in rows
    ]
    # NOT EXISTS, not NOT IN: Postgres plans it as an anti-join, where NOT IN
    # over the owners union degrades to a rescan per row once it outgrows
    # work_mem.
    nobody = (await db.execute(
        select(func.count().label("calls"), _spend().label("cost"))
        .where(*conds, ~exists().where(owners.c.call_id == LLMCall.id))
    )).one()
    if nobody.calls:
        out.append({
            "key": None, "label": f"not tied to a {role}",
            "calls": int(nobody.calls), "cost": float(nobody.cost),
        })
    return out


@router.get("/spend")
async def spend(
    group_by: GroupBy = Query(default="function"),
    bucket: Bucket = Query(default="week"),
    hours: int = Query(default=720, ge=1, le=8760),
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    school_id: str | None = Query(default=None),
    include_internal: bool = Query(
        default=False,
        description="Include internal calls (no school) and teachers' "
        "preview-as-student work. Off by default: neither is customer usage.",
    ),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if school_id and school_id != INTERNAL_SCHOOL_SENTINEL:
        try:
            # Canonical form: UUID() also takes urn:/braced spellings the
            # driver would reject.
            school_id = str(uuid_lib.UUID(school_id))
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid school_id") from e

    now = datetime.now(UTC)
    window = resolve_window(hours, date_from, date_to)
    # An open-ended or year-spanning range would group all of history.
    if window.end - window.start > timedelta(days=MAX_RANGE_DAYS):
        raise HTTPException(
            status_code=400,
            detail=f"a range can span at most {MAX_RANGE_DAYS} days; give both 'from' and 'to'",
        )

    scope: list[Any] = []
    if school_id:
        scope.append(school_calls(
            None if school_id == INTERNAL_SCHOOL_SENTINEL else school_id,
        ))
    if not include_internal and school_id != INTERNAL_SCHOOL_SENTINEL:
        scope.append(customer_calls())
    in_window = [*scope, window.covers(LLMCall.created_at)]

    rows = await _breakdown(db, in_window, group_by)
    total = await _total(db, scope, window)
    total_calls = int((await db.execute(
        select(func.count()).select_from(LLMCall).where(*in_window),
    )).scalar() or 0)
    for r in rows:
        r["cost"] = round(r["cost"], 4)
        r["share"] = round(r["cost"] / total, 4) if total else 0.0
        r["cost_per_call"] = round(r["cost"] / r["calls"], 6) if r["calls"] else None
    rows.sort(key=lambda r: (r["key"] is None, -r["cost"], r["label"]))

    # The honesty note: how concentrated the window's spend is in one
    # school. With one paying customer a "projection" is that customer's
    # habits, not a market.
    schools = [r for r in (
        rows if group_by == "school"
        else await _breakdown(db, in_window, "school")
    ) if r["key"] != INTERNAL_SCHOOL_SENTINEL]
    school_total = sum(r["cost"] for r in schools)
    top = max(schools, key=lambda r: r["cost"], default=None)

    return {
        "window": {"start": window.start.isoformat(), "end": window.end.isoformat()},
        "include_internal": include_internal,
        "headline": await spend_headline(db, scope, now),
        "bucket": bucket,
        "series": await spend_series(db, scope, bucket, now),
        "group_by": group_by,
        "total_cost": round(total, 4),
        "total_calls": total_calls,
        "rows": rows,
        "concentration": {
            "schools_with_spend": sum(1 for r in schools if r["cost"] > 0),
            "top_school_id": top["key"] if top else None,
            "top_school_name": top["label"] if top else None,
            "top_school_share": (
                round(top["cost"] / school_total, 4) if top and school_total else None
            ),
        },
    }
