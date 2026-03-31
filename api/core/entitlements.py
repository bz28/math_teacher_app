"""Entitlement system for feature gating and subscription checks."""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings

FREE_DAILY_SESSION_LIMIT = 5


class Entitlement(enum.StrEnum):
    CREATE_SESSION = "create_session"
    WORK_DIAGNOSIS = "work_diagnosis"


class EntitlementError(Exception):
    """Raised when a user lacks a required entitlement."""

    def __init__(self, entitlement: Entitlement, message: str, *, is_limit: bool = False):
        self.entitlement = entitlement
        self.message = message
        self.is_limit = is_limit
        super().__init__(message)


def is_pro(user: object) -> bool:
    """Check if a user has an active pro subscription."""
    tier = getattr(user, "subscription_tier", "free")
    status = getattr(user, "subscription_status", "none")
    expires_at = getattr(user, "subscription_expires_at", None)

    if tier != "pro":
        return False

    if status in ("active", "trial"):
        return True

    # Grace period: subscription still valid if expires_at is in the future
    if expires_at is not None and expires_at > datetime.now(UTC):
        return True

    return False


async def get_daily_session_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Count sessions created today (UTC) for a user."""
    from api.models.session import Session

    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.count())
        .select_from(Session)
        .where(Session.user_id == user_id, Session.created_at >= today_start)
    )
    return result.scalar_one()


async def check_entitlement(
    db: AsyncSession, user: object, entitlement: Entitlement
) -> None:
    """Verify a user is entitled to perform an action. Raises EntitlementError if not."""
    if settings.bypass_subscription:
        return

    if is_pro(user):
        return

    user_id = getattr(user, "id")

    if entitlement == Entitlement.CREATE_SESSION:
        count = await get_daily_session_count(db, user_id)
        if count >= FREE_DAILY_SESSION_LIMIT:
            raise EntitlementError(
                entitlement,
                f"Free plan limited to {FREE_DAILY_SESSION_LIMIT} problems per day."
                " Upgrade to Pro for unlimited access.",
                is_limit=True,
            )
        return

    if entitlement == Entitlement.WORK_DIAGNOSIS:
        raise EntitlementError(entitlement, "Work diagnosis requires a Pro subscription")
