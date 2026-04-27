"""Admin LLM call analytics endpoint."""

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.user import User
from api.routes.admin_helpers import time_range

router = APIRouter()


@router.get("/llm-calls")
async def llm_calls(
    hours: int = Query(default=168, ge=1, le=2160),
    function: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    submission_id: str | None = Query(default=None),
    school_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)

    # Build base filter conditions
    base_filters = [LLMCall.created_at >= since]
    if user_id:
        base_filters.append(LLMCall.user_id == user_id)
    if submission_id:
        # Per-submission flight-recorder filter — pulls every Vision +
        # equivalence + agent + grading call for one homework so the
        # admin dashboard can render the full pipeline trace in one
        # place. Indexed on submission_id, instant.
        base_filters.append(LLMCall.submission_id == submission_id)
    if school_id == "internal":
        # The "Internal" pseudo-school — calls from users with
        # school_id IS NULL (founder, test accounts, non-school
        # learners). Drives the school-scope picker's Internal entry.
        base_filters.append(LLMCall.school_id.is_(None))
    elif school_id:
        # Scope to a specific school. Indexed; instant.
        base_filters.append(LLMCall.school_id == school_id)

    # Aggregated stats
    stats_query = (
        select(
            LLMCall.function,
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("total_cost"),
            func.avg(LLMCall.latency_ms).label("avg_latency"),
            func.avg(LLMCall.input_tokens).label("avg_input_tokens"),
            func.avg(LLMCall.output_tokens).label("avg_output_tokens"),
        )
        .where(*base_filters)
        .group_by(LLMCall.function)
        .order_by(func.sum(LLMCall.cost_usd).desc())
    )
    stats = (await db.execute(stats_query)).all()

    # By model
    model_stats = (await db.execute(
        select(
            LLMCall.model,
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("total_cost"),
        )
        .where(*base_filters)
        .group_by(LLMCall.model)
    )).all()

    # Calls per day (with latency)
    calls_by_day = (await db.execute(
        select(
            cast(LLMCall.created_at, Date).label("day"),
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("cost"),
            func.avg(LLMCall.latency_ms).label("avg_latency"),
        )
        .where(*base_filters)
        .group_by("day")
        .order_by("day")
    )).all()

    # Recent calls (paginated) — join user info
    calls_query = (
        select(LLMCall, User.email.label("user_email"), User.name.label("user_name"))
        .outerjoin(User, User.id == LLMCall.user_id)
        .where(*base_filters)
    )
    if function:
        calls_query = calls_query.where(LLMCall.function == function)
    calls_query = calls_query.order_by(LLMCall.created_at.desc()).offset(offset).limit(limit)
    calls = (await db.execute(calls_query)).all()

    total_query = select(func.count()).select_from(LLMCall).where(*base_filters)
    if function:
        total_query = total_query.where(LLMCall.function == function)
    total_count = (await db.execute(total_query)).scalar() or 0

    # Failure analysis
    failure_filters = [*base_filters, LLMCall.success.is_(False)]

    failure_count = (await db.execute(
        select(func.count()).select_from(LLMCall).where(*failure_filters)
    )).scalar() or 0

    total_calls_count = (await db.execute(
        select(func.count()).select_from(LLMCall).where(*base_filters)
    )).scalar() or 0

    failure_rate = round(failure_count / total_calls_count * 100, 1) if total_calls_count else 0.0

    failures_by_function = (await db.execute(
        select(
            LLMCall.function,
            func.count().label("count"),
            func.avg(LLMCall.retry_count).label("avg_retries"),
        )
        .where(*failure_filters)
        .group_by(LLMCall.function)
        .order_by(func.count().desc())
    )).all()

    recent_failures = (await db.execute(
        select(LLMCall, User.email, User.name)
        .outerjoin(User, User.id == LLMCall.user_id)
        .where(*failure_filters)
        .order_by(LLMCall.created_at.desc())
        .limit(10)
    )).all()

    # Users who have LLM calls in this period (for filter dropdown)
    user_rows = (await db.execute(
        select(User.id, User.email)
        .where(
            User.id.in_(
                select(func.distinct(LLMCall.user_id))
                .where(LLMCall.created_at >= since, LLMCall.user_id.isnot(None))
            )
        )
        .order_by(User.email)
    )).all()

    return {
        "failure_count": failure_count,
        "failure_rate": failure_rate,
        "failures_by_function": [
            {
                "function": r.function,
                "count": r.count,
                "avg_retries": round(r.avg_retries or 0, 1),
            }
            for r in failures_by_function
        ],
        "recent_failures": [
            {
                "id": str(c.id),
                "function": c.function,
                "model": c.model,
                "retry_count": c.retry_count,
                "output_text": c.output_text,
                "user_name": name or email or "Deleted User",
                "created_at": c.created_at.isoformat(),
            }
            for c, email, name in recent_failures
        ],
        "by_function": [
            {
                "function": r.function,
                "count": r.count,
                "total_cost": round(r.total_cost or 0, 4),
                "avg_latency_ms": round(r.avg_latency or 0, 1),
                "avg_input_tokens": round(r.avg_input_tokens or 0),
                "avg_output_tokens": round(r.avg_output_tokens or 0),
            }
            for r in stats
        ],
        "by_model": [
            {
                "model": r.model,
                "count": r.count,
                "total_cost": round(r.total_cost or 0, 4),
            }
            for r in model_stats
        ],
        "by_day": [
            {
                "day": str(r.day),
                "count": r.count,
                "cost": round(r.cost or 0, 4),
                "avg_latency": round(r.avg_latency or 0, 0),
            }
            for r in calls_by_day
        ],
        "calls": [
            {
                "id": str(c.id),
                "function": c.function,
                "model": c.model,
                "input_tokens": c.input_tokens,
                "output_tokens": c.output_tokens,
                "latency_ms": round(c.latency_ms, 1),
                "cost_usd": round(c.cost_usd, 6),
                "success": c.success,
                "retry_count": c.retry_count,
                "input_text": c.input_text,
                "output_text": c.output_text,
                "session_id": str(c.session_id) if c.session_id else None,
                "user_id": str(c.user_id) if c.user_id else None,
                "user_name": user_name or user_email or "Deleted User",
                "school_id": str(c.school_id) if c.school_id else None,
                "submission_id": str(c.submission_id) if c.submission_id else None,
                "metadata": c.call_metadata,
                "created_at": c.created_at.isoformat(),
            }
            for c, user_email, user_name in calls
        ],
        "total_count": total_count,
        "users": [
            {"id": str(r.id), "email": r.email}
            for r in user_rows
        ],
    }
