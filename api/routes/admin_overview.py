"""Admin overview dashboard endpoint."""

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.session import Session
from api.models.user import User
from api.routes.admin_helpers import time_range

router = APIRouter()


@router.get("/overview")
async def overview(
    hours: int = Query(default=24, ge=1, le=87600),
    grade: int | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)

    # Build session filters (optionally scoped to grade)
    session_filters = [Session.created_at >= since]
    llm_filters = [LLMCall.created_at >= since]
    if grade is not None:
        grade_users = select(User.id).where(User.grade_level == grade).scalar_subquery()
        session_filters.append(Session.user_id.in_(grade_users))
        llm_filters.append(LLMCall.user_id.in_(grade_users))

    # Sessions in period
    total_sessions = (await db.execute(
        select(func.count()).where(*session_filters)
    )).scalar() or 0

    # Active users in period
    active_users = (await db.execute(
        select(func.count(func.distinct(Session.user_id))).where(*session_filters)
    )).scalar() or 0

    # New users registered in period
    new_users = (await db.execute(
        select(func.count()).select_from(User).where(User.created_at >= since)
    )).scalar() or 0

    # Total cost in period
    total_cost = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(*llm_filters)
    )).scalar() or 0.0

    # Avg latency in period
    avg_latency = (await db.execute(
        select(func.avg(LLMCall.latency_ms)).where(*llm_filters, LLMCall.success.is_(True))
    )).scalar() or 0.0

    # Error rate in period
    total_calls = (await db.execute(
        select(func.count()).select_from(LLMCall).where(*llm_filters)
    )).scalar() or 0
    failed_calls = (await db.execute(
        select(func.count()).select_from(LLMCall).where(
            *llm_filters, LLMCall.success.is_(False),
        )
    )).scalar() or 0
    error_rate = round(failed_calls / total_calls * 100, 1) if total_calls else 0.0

    # Sessions per day
    sessions_by_day = (await db.execute(
        select(
            cast(Session.created_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(*session_filters)
        .group_by("day")
        .order_by("day")
    )).all()

    # Cost per day
    cost_by_day = (await db.execute(
        select(
            cast(LLMCall.created_at, Date).label("day"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
        )
        .where(*llm_filters)
        .group_by("day")
        .order_by("day")
    )).all()

    # Sessions by mode
    by_mode = (await db.execute(
        select(
            Session.mode,
            func.count().label("count"),
        )
        .where(*session_filters)
        .group_by(Session.mode)
    )).all()

    # Sessions by subject
    by_subject = (await db.execute(
        select(
            Session.subject,
            func.count().label("count"),
        )
        .where(*session_filters)
        .group_by(Session.subject)
    )).all()

    # Deleted accounts (lifetime counter)
    deleted_accounts = (await db.execute(
        text("SELECT value FROM app_stats WHERE key = 'deleted_accounts'")
    )).scalar() or 0

    # Top spenders in period
    spender_filters = [LLMCall.created_at >= since]
    top_spenders = (await db.execute(
        select(
            User.name,
            User.email,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("total_cost"),
        )
        .join(LLMCall, LLMCall.user_id == User.id)
        .where(*spender_filters)
        .group_by(User.id, User.name, User.email)
        .order_by(func.sum(LLMCall.cost_usd).desc())
        .limit(3)
    )).all()

    return {
        "total_sessions": total_sessions,
        "active_users": active_users,
        "new_users": new_users,
        "deleted_accounts": deleted_accounts,
        "total_cost": round(total_cost, 4),
        "total_calls": total_calls,
        "failed_calls": failed_calls,
        "error_rate": error_rate,
        "avg_latency_ms": round(avg_latency, 0),
        "by_mode": [{"mode": r.mode, "count": r.count} for r in by_mode],
        "by_subject": [{"subject": r.subject, "count": r.count} for r in by_subject],
        "sessions_by_day": [{"day": str(r.day), "count": r.count} for r in sessions_by_day],
        "cost_by_day": [{"day": str(r.day), "cost": round(r.cost, 4)} for r in cost_by_day],
        "top_spenders": [
            {
                "name": r.name or r.email,
                "total_cost": round(r.total_cost, 4),
            }
            for r in top_spenders
        ],
    }
