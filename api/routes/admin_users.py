"""Admin user management endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.entitlements import (
    FREE_DAILY_CHAT_LIMIT,
    FREE_DAILY_IMAGE_SCAN_LIMIT,
    FREE_DAILY_SESSION_LIMIT,
    today_start,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.session import Session
from api.models.user import User

router = APIRouter()


def _time_range(hours: int) -> datetime:
    return datetime.now(UTC) - timedelta(hours=hours)


@router.get("/users")
async def users(
    hours: int = Query(default=720, ge=1, le=2160),
    sort_by: str = Query(default="total_cost", pattern=r"^(total_cost|session_count|last_active|name)$"),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=100),
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

    # Daily usage subqueries (today)
    today = today_start()

    daily_sessions = (
        select(
            LLMCall.user_id,
            func.count().label("daily_sessions"),
        )
        .where(
            LLMCall.created_at >= today,
            LLMCall.user_id.isnot(None),
            LLMCall.function.in_(["decompose", "decompose_diagnosis"]),
        )
        .group_by(LLMCall.user_id)
        .subquery()
    )

    daily_chats = (
        select(
            LLMCall.user_id,
            func.count().label("daily_chats"),
        )
        .where(
            LLMCall.created_at >= today,
            LLMCall.user_id.isnot(None),
            LLMCall.function.in_(["step_chat", "judge"]),
        )
        .group_by(LLMCall.user_id)
        .subquery()
    )

    daily_scans = (
        select(
            LLMCall.user_id,
            func.count().label("daily_scans"),
        )
        .where(
            LLMCall.created_at >= today,
            LLMCall.user_id.isnot(None),
            LLMCall.function == "image_extract",
        )
        .group_by(LLMCall.user_id)
        .subquery()
    )

    # Sort column mapping
    sort_columns = {
        "total_cost": func.coalesce(user_cost.c.total_cost, 0.0).desc(),
        "session_count": func.coalesce(user_sessions.c.session_count, 0).desc(),
        "last_active": func.coalesce(user_sessions.c.last_active, User.created_at).desc(),
        "name": User.name.asc(),
    }

    # Search filter
    search_filters = []
    if search:
        term = f"%{search}%"
        search_filters.append(User.name.ilike(term) | User.email.ilike(term))

    # Count of users matching search (for pagination)
    count_query = select(func.count()).select_from(User)
    if search_filters:
        count_query = count_query.where(*search_filters)
    filtered_count = (await db.execute(count_query)).scalar() or 0

    # All users with cost + session data (paginated)
    users_query = (
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
            User.subscription_tier,
            User.subscription_status,
            func.coalesce(daily_sessions.c.daily_sessions, 0).label("daily_sessions"),
            func.coalesce(daily_chats.c.daily_chats, 0).label("daily_chats"),
            func.coalesce(daily_scans.c.daily_scans, 0).label("daily_scans"),
        )
        .outerjoin(user_cost, user_cost.c.user_id == User.id)
        .outerjoin(user_sessions, user_sessions.c.user_id == User.id)
        .outerjoin(daily_sessions, daily_sessions.c.user_id == User.id)
        .outerjoin(daily_chats, daily_chats.c.user_id == User.id)
        .outerjoin(daily_scans, daily_scans.c.user_id == User.id)
    )
    if search_filters:
        users_query = users_query.where(*search_filters)
    users_query = (
        users_query
        .order_by(sort_columns.get(sort_by, sort_columns["total_cost"]))
        .limit(limit)
        .offset(offset)
    )
    all_users = (await db.execute(users_query)).all()

    return {
        "total_users": total_users,
        "active_7d": active_7d,
        "total_spend": round(total_spend, 4),
        "filtered_count": filtered_count,
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
                "subscription_tier": r.subscription_tier,
                "subscription_status": r.subscription_status,
                "daily_usage": {
                    "sessions": r.daily_sessions,
                    "sessions_limit": None if r.subscription_tier == "pro" else FREE_DAILY_SESSION_LIMIT,
                    "chats": r.daily_chats,
                    "chats_limit": None if r.subscription_tier == "pro" else FREE_DAILY_CHAT_LIMIT,
                    "scans": r.daily_scans,
                    "scans_limit": None if r.subscription_tier == "pro" else FREE_DAILY_IMAGE_SCAN_LIMIT,
                },
            }
            for r in all_users
        ],
    }


class UpdateRoleRequest(BaseModel):
    role: str


class UpdateSubscriptionRequest(BaseModel):
    tier: str
    status: str


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


@router.patch("/users/{user_id}/subscription")
async def update_user_subscription(
    user_id: str,
    body: UpdateSubscriptionRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Manually set a user's subscription tier and status (e.g. grant Pro for free)."""
    valid_tiers = ("free", "pro")
    valid_statuses = ("none", "active", "trial", "cancelled", "expired", "billing_issue")
    if body.tier not in valid_tiers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tier must be one of: {', '.join(valid_tiers)}",
        )
    if body.status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Status must be one of: {', '.join(valid_statuses)}",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.subscription_tier = body.tier
    user.subscription_status = body.status
    if body.tier == "pro" and body.status == "active":
        user.subscription_provider = user.subscription_provider or "admin"
    await db.commit()
    return {"status": "ok", "tier": body.tier, "subscription_status": body.status}


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
