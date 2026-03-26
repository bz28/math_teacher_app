"""Admin dashboard endpoints: overview, LLM calls, sessions, users."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.quality_score import QualityScore
from api.models.session import Session
from api.models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])


def _time_range(hours: int) -> datetime:
    return datetime.now(UTC) - timedelta(hours=hours)


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


@router.get("/overview")
async def overview(
    hours: int = Query(default=24, ge=1, le=87600),
    grade: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)

    # Build session filters (optionally scoped to grade)
    session_filters = [Session.created_at >= since]
    llm_filters = [LLMCall.created_at >= since]
    if grade:
        grade_val = int(grade)
        grade_users = select(User.id).where(User.grade_level == grade_val).scalar_subquery()
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


# ---------------------------------------------------------------------------
# LLM Calls
# ---------------------------------------------------------------------------


@router.get("/llm-calls")
async def llm_calls(
    hours: int = Query(default=168, ge=1, le=2160),
    function: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)

    # Build base filter conditions
    base_filters = [LLMCall.created_at >= since]
    if user_id:
        base_filters.append(LLMCall.user_id == user_id)

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
                "user_name": name or email or None,
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
                "user_name": user_name or user_email or None,
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


# ---------------------------------------------------------------------------
# Quality Scores
# ---------------------------------------------------------------------------


@router.get("/quality")
async def quality_scores(
    hours: int = Query(default=168, ge=1, le=2160),
    only_failed: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)

    base_filters = [QualityScore.created_at >= since]
    if only_failed:
        base_filters.append(QualityScore.passed.is_(False))

    # Aggregate stats
    agg = (await db.execute(
        select(
            func.count().label("total"),
            func.sum(case((QualityScore.passed.is_(True), 1), else_=0)).label("passed"),
            func.avg(QualityScore.correctness).label("avg_correctness"),
            func.avg(QualityScore.optimality).label("avg_optimality"),
            func.avg(QualityScore.clarity).label("avg_clarity"),
            func.avg(QualityScore.flow).label("avg_flow"),
        ).where(*base_filters)
    )).one()

    total = agg.total or 0
    pass_rate = round((agg.passed or 0) / total * 100, 1) if total else 0.0

    # Recent scores with session problem
    rows = (await db.execute(
        select(QualityScore, Session.problem)
        .join(Session, Session.id == QualityScore.session_id)
        .where(*base_filters)
        .order_by(QualityScore.created_at.desc())
        .offset(offset)
        .limit(limit)
    )).all()

    return {
        "summary": {
            "total": total,
            "passed": agg.passed or 0,
            "pass_rate": pass_rate,
            "avg_correctness": round(agg.avg_correctness or 0, 2),
            "avg_optimality": round(agg.avg_optimality or 0, 2),
            "avg_clarity": round(agg.avg_clarity or 0, 2),
            "avg_flow": round(agg.avg_flow or 0, 2),
        },
        "scores": [
            {
                "id": str(qs.id),
                "session_id": str(qs.session_id),
                "problem": problem[:80],
                "correctness": qs.correctness,
                "optimality": qs.optimality,
                "clarity": qs.clarity,
                "flow": qs.flow,
                "passed": qs.passed,
                "issues": qs.issues,
                "created_at": qs.created_at.isoformat(),
            }
            for qs, problem in rows
        ],
        "total_count": total,
    }


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


@router.get("/sessions")
async def sessions(
    hours: int = Query(default=168, ge=1, le=87600),
    user_id: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)
    base_filters = [Session.created_at >= since]
    if user_id:
        base_filters.append(Session.user_id == user_id)

    # Total sessions
    total_count = (await db.execute(
        select(func.count()).select_from(Session).where(*base_filters)
    )).scalar() or 0

    # By mode
    by_mode = (await db.execute(
        select(
            Session.mode,
            func.count().label("count"),
        )
        .where(*base_filters)
        .group_by(Session.mode)
    )).all()

    # Sessions per day (for trend chart)
    sessions_by_day = (await db.execute(
        select(
            cast(Session.created_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(*base_filters)
        .group_by("day")
        .order_by("day")
    )).all()

    # Users dropdown for filter
    user_rows = (await db.execute(
        select(User.id, User.email)
        .where(
            User.id.in_(
                select(func.distinct(Session.user_id))
                .where(Session.created_at >= since)
            )
        )
        .order_by(User.email)
    )).all()

    return {
        "total_count": total_count,
        "by_mode": [
            {"mode": r.mode, "count": r.count}
            for r in by_mode
        ],
        "sessions_by_day": [
            {"day": str(r.day), "count": r.count}
            for r in sessions_by_day
        ],
        "users": [
            {"id": str(r.id), "email": r.email}
            for r in user_rows
        ],
    }


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users")
async def users(
    hours: int = Query(default=720, ge=1, le=2160),
    sort_by: str = Query(default="total_cost", pattern=r"^(total_cost|session_count|last_active|name)$"),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)

    # Total users
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar() or 0

    # Active users (7d)
    active_7d = (await db.execute(
        select(func.count(func.distinct(Session.user_id)))
        .where(Session.created_at >= _time_range(168))
    )).scalar() or 0

    # Total spend (all users, in period)
    total_spend = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0))
        .where(LLMCall.created_at >= since)
    )).scalar() or 0.0

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

    # Per-user cost subquery
    user_cost = (
        select(
            LLMCall.user_id,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("total_cost"),
            func.count().label("llm_call_count"),
        )
        .where(LLMCall.created_at >= since, LLMCall.user_id.isnot(None))
        .group_by(LLMCall.user_id)
        .subquery()
    )

    # Per-user session subquery
    user_sessions = (
        select(
            Session.user_id,
            func.count().label("session_count"),
            func.max(Session.created_at).label("last_active"),
        )
        .where(Session.created_at >= since)
        .group_by(Session.user_id)
        .subquery()
    )

    # Sort column mapping
    sort_columns = {
        "total_cost": func.coalesce(user_cost.c.total_cost, 0.0).desc(),
        "session_count": func.coalesce(user_sessions.c.session_count, 0).desc(),
        "last_active": func.coalesce(user_sessions.c.last_active, User.created_at).desc(),
        "name": User.name.asc(),
    }

    # All users with cost + session data
    all_users = (await db.execute(
        select(
            User.id,
            User.email,
            User.name,
            User.role,
            User.grade_level,
            User.created_at,
            func.coalesce(user_sessions.c.session_count, 0).label("session_count"),
            func.coalesce(user_cost.c.total_cost, 0.0).label("total_cost"),
            func.coalesce(user_cost.c.llm_call_count, 0).label("llm_call_count"),
            user_sessions.c.last_active,
        )
        .outerjoin(user_cost, user_cost.c.user_id == User.id)
        .outerjoin(user_sessions, user_sessions.c.user_id == User.id)
        .order_by(sort_columns.get(sort_by, sort_columns["total_cost"]))
    )).all()

    return {
        "total_users": total_users,
        "active_7d": active_7d,
        "total_spend": round(total_spend, 4),
        "registrations_by_day": [
            {"day": str(r.day), "count": r.count}
            for r in registrations_by_day
        ],
        "users": [
            {
                "id": str(r.id),
                "email": r.email,
                "name": r.name,
                "role": r.role,
                "grade_level": r.grade_level,
                "session_count": r.session_count,
                "total_cost": round(r.total_cost, 4),
                "llm_call_count": r.llm_call_count,
                "avg_cost_per_session": round(r.total_cost / r.session_count, 4) if r.session_count else 0.0,
                "last_active": r.last_active.isoformat() if r.last_active else None,
                "registered": r.created_at.isoformat(),
            }
            for r in all_users
        ],
    }


# ---------------------------------------------------------------------------
# User Management
# ---------------------------------------------------------------------------


class UpdateRoleRequest(BaseModel):
    role: str


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: UpdateRoleRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.role not in ("student", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role must be 'student' or 'admin'")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Prevent removing your own admin role
    if str(user.id) == str(current_user.user_id) and body.role != "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove your own admin role")

    user.role = body.role
    await db.commit()
    return {"status": "ok", "role": body.role}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Prevent deleting yourself
    if str(user.id) == str(current_user.user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")

    await db.delete(user)
    await db.commit()
    return {"status": "ok"}
