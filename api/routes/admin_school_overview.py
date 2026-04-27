"""Per-school Overview tile aggregations.

Single endpoint feeding the dashboard's school-scope Overview page —
cost row, top spenders, quality row, and health row. Kept in one
endpoint rather than four to keep the page's loading state simple.

The `school_id` path segment can be either a real school UUID or the
literal `internal` sentinel — the latter scopes to LLMCall rows where
`school_id IS NULL` (the founder, test accounts, and any non-school
learners). Tiles that only make sense for real schools (top classes,
top teachers, integrity disposition) come back empty in the internal
scope; the frontend hides those cards. Cost / failed-call tiles still
work because LLMCall is the only table that meaningfully extends to
the no-school bucket.
"""

import calendar
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.school import School

router = APIRouter()

INTERNAL_SCHOOL_SENTINEL = "internal"


def _month_window(now: datetime) -> tuple[datetime, datetime, datetime]:
    """Return (this_month_start, last_month_start, this_month_end_exclusive)."""
    this_month_start = now.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0,
    )
    if this_month_start.month == 1:
        last_month_start = this_month_start.replace(
            year=this_month_start.year - 1, month=12,
        )
    else:
        last_month_start = this_month_start.replace(
            month=this_month_start.month - 1,
        )
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    this_month_end = this_month_start + timedelta(days=days_in_month)
    return this_month_start, last_month_start, this_month_end


def _llm_school_filter(school_id: str) -> Any:
    """Build the LLMCall filter for a scope-id (real UUID or 'internal')."""
    if school_id == INTERNAL_SCHOOL_SENTINEL:
        return LLMCall.school_id.is_(None)
    return LLMCall.school_id == school_id


@router.get("/schools/{school_id}/overview")
async def school_overview(
    school_id: str = Path(..., description="School UUID or 'internal'"),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    is_internal = school_id == INTERNAL_SCHOOL_SENTINEL

    # Resolve the school name once so the page header is decided
    # server-side. 404 if the caller passed a bogus id — saves the
    # frontend from rendering "Loading…" forever on a typo URL.
    school_name: str
    if is_internal:
        school_name = "Internal (no-school)"
    else:
        row = (await db.execute(
            select(School.name).where(School.id == school_id)
        )).first()
        if row is None:
            raise HTTPException(status_code=404, detail="School not found")
        school_name = row.name

    now = datetime.now(UTC)
    this_month_start, last_month_start, this_month_end = _month_window(now)
    llm_school = _llm_school_filter(school_id)

    # ---------- Cost row ----------
    this_month_cost = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            llm_school,
            LLMCall.created_at >= this_month_start,
        )
    )).scalar() or 0.0

    last_month_cost = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            llm_school,
            LLMCall.created_at >= last_month_start,
            LLMCall.created_at < this_month_start,
        )
    )).scalar() or 0.0

    # Linear projection — this-month / days-elapsed × days-in-month.
    # Crude on day 1 (one day of data implies the full month at that
    # rate) but the dashboard only shows the number after a meaningful
    # window has elapsed; teachers will read it as "if usage stays
    # flat".
    days_elapsed = max((now - this_month_start).days + 1, 1)
    days_in_month = (this_month_end - this_month_start).days
    projected_month_end = this_month_cost / days_elapsed * days_in_month

    # By-function breakdown for the stacked bar.
    by_function_rows = (await db.execute(
        select(
            LLMCall.function,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
            func.count().label("count"),
        )
        .where(llm_school, LLMCall.created_at >= this_month_start)
        .group_by(LLMCall.function)
        .order_by(func.sum(LLMCall.cost_usd).desc())
    )).all()

    # 12-week sparkline. Buckets are stamped to the Monday of each
    # ISO week so the labels are stable across years.
    twelve_weeks_ago = (
        now - timedelta(days=now.weekday() + 7 * 11)
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    week_bucket = func.date_trunc("week", LLMCall.created_at).label("week")
    weekly_rows = (await db.execute(
        select(
            week_bucket,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
        )
        .where(llm_school, LLMCall.created_at >= twelve_weeks_ago)
        .group_by("week")
        .order_by("week")
    )).all()

    # Cost per submission (this month, school-wide).
    distinct_subs_this_month = (await db.execute(
        select(func.count(func.distinct(LLMCall.submission_id))).where(
            llm_school,
            LLMCall.created_at >= this_month_start,
            LLMCall.submission_id.isnot(None),
        )
    )).scalar() or 0
    cost_per_submission = (
        this_month_cost / distinct_subs_this_month
        if distinct_subs_this_month
        else 0.0
    )

    return {
        "school_id": school_id,
        "school_name": school_name,
        "is_internal": is_internal,
        "generated_at": now.isoformat(),
        "cost": {
            "this_month": round(this_month_cost, 4),
            "last_month": round(last_month_cost, 4),
            "projected_month_end": round(projected_month_end, 4),
            "cost_per_submission": round(cost_per_submission, 4),
            "by_function": [
                {
                    "function": r.function,
                    "cost": round(r.cost, 4),
                    "count": r.count,
                }
                for r in by_function_rows
            ],
            "trend_12_weeks": [
                {
                    "week_start": r.week.date().isoformat() if r.week else None,
                    "cost": round(r.cost, 4),
                }
                for r in weekly_rows
            ],
        },
    }
