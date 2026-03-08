"""Admin dashboard endpoints: overview, LLM calls, sessions, users."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user
from api.models.llm_call import LLMCall
from api.models.session import Session
from api.models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(current_user: CurrentUser) -> CurrentUser:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def _date_range(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


@router.get("/overview")
async def overview(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _require_admin(current_user)

    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    week_ago = _date_range(7)

    # Sessions today
    sessions_today = (await db.execute(
        select(func.count()).where(Session.created_at >= today_start)
    )).scalar() or 0

    sessions_yesterday = (await db.execute(
        select(func.count()).where(
            Session.created_at >= yesterday_start,
            Session.created_at < today_start,
        )
    )).scalar() or 0

    # LLM cost today
    cost_today = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(LLMCall.created_at >= today_start)
    )).scalar() or 0.0

    cost_yesterday = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            LLMCall.created_at >= yesterday_start,
            LLMCall.created_at < today_start,
        )
    )).scalar() or 0.0

    # Active users (7 day)
    active_users = (await db.execute(
        select(func.count(func.distinct(Session.user_id))).where(Session.created_at >= week_ago)
    )).scalar() or 0

    # Completion rate (7 day)
    total_sessions_week = (await db.execute(
        select(func.count()).where(Session.created_at >= week_ago)
    )).scalar() or 0

    completed_sessions_week = (await db.execute(
        select(func.count()).where(
            Session.created_at >= week_ago,
            Session.status == "completed",
        )
    )).scalar() or 0

    completion_rate = round(completed_sessions_week / total_sessions_week * 100, 1) if total_sessions_week else 0.0

    # Sessions per day (last 7 days)
    sessions_by_day = (await db.execute(
        select(
            cast(Session.created_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(Session.created_at >= week_ago)
        .group_by("day")
        .order_by("day")
    )).all()

    # Cost per day (last 7 days)
    cost_by_day = (await db.execute(
        select(
            cast(LLMCall.created_at, Date).label("day"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
        )
        .where(LLMCall.created_at >= week_ago)
        .group_by("day")
        .order_by("day")
    )).all()

    # Recent sessions
    recent_sessions = (await db.execute(
        select(Session)
        .order_by(Session.created_at.desc())
        .limit(10)
    )).scalars().all()

    return {
        "sessions_today": sessions_today,
        "sessions_yesterday": sessions_yesterday,
        "cost_today": round(cost_today, 4),
        "cost_yesterday": round(cost_yesterday, 4),
        "active_users_7d": active_users,
        "completion_rate_7d": completion_rate,
        "sessions_by_day": [{"day": str(r.day), "count": r.count} for r in sessions_by_day],
        "cost_by_day": [{"day": str(r.day), "cost": round(r.cost, 4)} for r in cost_by_day],
        "recent_sessions": [
            {
                "id": str(s.id),
                "problem": s.problem[:60],
                "mode": s.mode,
                "status": s.status,
                "total_steps": s.total_steps,
                "current_step": s.current_step,
                "created_at": s.created_at.isoformat(),
            }
            for s in recent_sessions
        ],
    }


# ---------------------------------------------------------------------------
# LLM Calls
# ---------------------------------------------------------------------------


@router.get("/llm-calls")
async def llm_calls(
    days: int = Query(default=7, ge=1, le=90),
    function: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _require_admin(current_user)

    since = _date_range(days)

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
        .where(LLMCall.created_at >= since)
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
        .where(LLMCall.created_at >= since)
        .group_by(LLMCall.model)
    )).all()

    # Calls per day
    calls_by_day = (await db.execute(
        select(
            cast(LLMCall.created_at, Date).label("day"),
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("cost"),
        )
        .where(LLMCall.created_at >= since)
        .group_by("day")
        .order_by("day")
    )).all()

    # Recent calls (paginated)
    calls_query = (
        select(LLMCall)
        .where(LLMCall.created_at >= since)
    )
    if function:
        calls_query = calls_query.where(LLMCall.function == function)
    calls_query = calls_query.order_by(LLMCall.created_at.desc()).offset(offset).limit(limit)
    calls = (await db.execute(calls_query)).scalars().all()

    total_count = (await db.execute(
        select(func.count()).select_from(LLMCall).where(LLMCall.created_at >= since)
    )).scalar() or 0

    return {
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
            {"day": str(r.day), "count": r.count, "cost": round(r.cost or 0, 4)}
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
                "created_at": c.created_at.isoformat(),
            }
            for c in calls
        ],
        "total_count": total_count,
    }


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


@router.get("/sessions")
async def sessions(
    days: int = Query(default=30, ge=1, le=90),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _require_admin(current_user)

    since = _date_range(days)

    # Completion rate over time (by day)
    completion_by_day = (await db.execute(
        select(
            cast(Session.created_at, Date).label("day"),
            func.count().label("total"),
            func.sum(case((Session.status == "completed", 1), else_=0)).label("completed"),
        )
        .where(Session.created_at >= since)
        .group_by("day")
        .order_by("day")
    )).all()

    # By mode
    by_mode = (await db.execute(
        select(
            Session.mode,
            func.count().label("count"),
            func.sum(case((Session.status == "completed", 1), else_=0)).label("completed"),
        )
        .where(Session.created_at >= since)
        .group_by(Session.mode)
    )).all()

    # Averages
    avg_stats = (await db.execute(
        select(
            func.avg(Session.total_steps).label("avg_steps"),
            func.avg(Session.current_step).label("avg_progress"),
        )
        .where(Session.created_at >= since)
    )).one()

    # Top problems
    top_problems = (await db.execute(
        select(
            Session.problem,
            func.count().label("count"),
            func.sum(case((Session.status == "completed", 1), else_=0)).label("completed"),
        )
        .where(Session.created_at >= since)
        .group_by(Session.problem)
        .order_by(func.count().desc())
        .limit(20)
    )).all()

    # Recent sessions (paginated)
    recent = (await db.execute(
        select(Session)
        .where(Session.created_at >= since)
        .order_by(Session.created_at.desc())
        .offset(offset)
        .limit(limit)
    )).scalars().all()

    # Abandoned sessions
    abandoned = (await db.execute(
        select(Session)
        .where(
            Session.created_at >= since,
            Session.status == "abandoned",
        )
        .order_by(Session.created_at.desc())
        .limit(10)
    )).scalars().all()

    total_count = (await db.execute(
        select(func.count()).select_from(Session).where(Session.created_at >= since)
    )).scalar() or 0

    return {
        "completion_by_day": [
            {
                "day": str(r.day),
                "total": r.total,
                "completed": r.completed,
                "rate": round(r.completed / r.total * 100, 1) if r.total else 0,
            }
            for r in completion_by_day
        ],
        "by_mode": [
            {
                "mode": r.mode,
                "count": r.count,
                "completed": r.completed,
                "rate": round(r.completed / r.count * 100, 1) if r.count else 0,
            }
            for r in by_mode
        ],
        "averages": {
            "avg_steps": round(avg_stats.avg_steps or 0, 1),
            "avg_progress": round(avg_stats.avg_progress or 0, 1),
        },
        "top_problems": [
            {
                "problem": r.problem[:80],
                "count": r.count,
                "completed": r.completed,
                "rate": round(r.completed / r.count * 100, 1) if r.count else 0,
            }
            for r in top_problems
        ],
        "sessions": [
            {
                "id": str(s.id),
                "problem": s.problem[:80],
                "mode": s.mode,
                "status": s.status,
                "problem_type": s.problem_type,
                "current_step": s.current_step,
                "total_steps": s.total_steps,
                "created_at": s.created_at.isoformat(),
            }
            for s in recent
        ],
        "abandoned": [
            {
                "id": str(s.id),
                "problem": s.problem[:80],
                "mode": s.mode,
                "current_step": s.current_step,
                "total_steps": s.total_steps,
                "created_at": s.created_at.isoformat(),
            }
            for s in abandoned
        ],
        "total_count": total_count,
    }


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users")
async def users(
    days: int = Query(default=30, ge=1, le=90),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _require_admin(current_user)

    since = _date_range(days)

    # Total users
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar() or 0

    # Registrations over time
    registrations_by_day = (await db.execute(
        select(
            cast(User.created_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(User.created_at >= since)
        .group_by("day")
        .order_by("day")
    )).all()

    # Active users (7d)
    active_7d = (await db.execute(
        select(func.count(func.distinct(Session.user_id)))
        .where(Session.created_at >= _date_range(7))
    )).scalar() or 0

    # Sessions per user distribution
    sessions_per_user = (await db.execute(
        select(
            Session.user_id,
            func.count().label("session_count"),
        )
        .where(Session.created_at >= since)
        .group_by(Session.user_id)
    )).all()

    # Build distribution buckets
    buckets = {"1": 0, "2-5": 0, "6-20": 0, "20+": 0}
    for row in sessions_per_user:
        c = row.session_count
        if c == 1:
            buckets["1"] += 1
        elif c <= 5:
            buckets["2-5"] += 1
        elif c <= 20:
            buckets["6-20"] += 1
        else:
            buckets["20+"] += 1

    # Most active users
    top_users_rows = (await db.execute(
        select(
            User.id,
            User.email,
            User.grade_level,
            func.count(Session.id).label("session_count"),
            func.max(Session.created_at).label("last_active"),
        )
        .join(Session, Session.user_id == User.id)
        .where(Session.created_at >= since)
        .group_by(User.id, User.email, User.grade_level)
        .order_by(func.count(Session.id).desc())
        .limit(10)
    )).all()

    return {
        "total_users": total_users,
        "active_7d": active_7d,
        "registrations_by_day": [
            {"day": str(r.day), "count": r.count}
            for r in registrations_by_day
        ],
        "session_distribution": buckets,
        "top_users": [
            {
                "id": str(r.id),
                "email": r.email,
                "grade_level": r.grade_level,
                "session_count": r.session_count,
                "last_active": r.last_active.isoformat() if r.last_active else None,
            }
            for r in top_users_rows
        ],
    }
