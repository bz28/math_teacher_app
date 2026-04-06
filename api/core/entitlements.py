"""Entitlement system for feature gating and subscription checks."""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings

FREE_DAILY_SESSION_LIMIT = 5
FREE_DAILY_CHAT_LIMIT = 20
FREE_DAILY_IMAGE_SCAN_LIMIT = 3


class Entitlement(enum.StrEnum):
    CREATE_SESSION = "create_session"
    CHAT_MESSAGE = "chat_message"
    IMAGE_SCAN = "image_scan"
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


async def is_school_enrolled(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Check if a student is enrolled in any section of an active school.

    Short-circuits: if the user has no enrollments at all (most users),
    we skip the expensive 5-table join entirely.
    """
    from api.models.course import Course
    from api.models.school import School
    from api.models.section import Section
    from api.models.section_enrollment import SectionEnrollment

    # Fast path: check if user has ANY enrollment (single-table, indexed)
    has_any = (await db.execute(
        select(SectionEnrollment.id)
        .where(SectionEnrollment.student_id == user_id)
        .limit(1)
    )).scalar_one_or_none()
    if has_any is None:
        return False

    # Slow path: verify at least one enrollment is in an active school.
    # Course has school_id directly now, so we can skip the user/teacher hop.
    result = await db.execute(
        select(SectionEnrollment.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .join(Course, Course.id == Section.course_id)
        .join(School, School.id == Course.school_id)
        .where(
            SectionEnrollment.student_id == user_id,
            School.is_active.is_(True),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


def today_start() -> datetime:
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def usage_cutoff(user: object) -> datetime:
    """Return the effective start time for counting daily usage.

    If an admin has reset the user's limits today, usage is only counted
    from the reset timestamp forward.  Otherwise falls back to midnight UTC.
    """
    midnight = today_start()
    reset_at: datetime | None = getattr(user, "daily_limit_reset_at", None)
    if reset_at is not None and reset_at > midnight:
        return reset_at
    return midnight


async def get_daily_decomp_count(db: AsyncSession, user_id: uuid.UUID, since: datetime | None = None) -> int:
    """Count decomposition LLM calls today (the real cost of analyzing a problem)."""
    from api.models.llm_call import LLMCall

    result = await db.execute(
        select(func.count())
        .select_from(LLMCall)
        .where(
            LLMCall.user_id == user_id,
            LLMCall.function.in_(["decompose", "decompose_diagnosis"]),
            LLMCall.created_at >= (since or today_start()),
        )
    )
    return result.scalar_one()


async def get_daily_llm_call_count(
    db: AsyncSession, user_id: uuid.UUID, function_name: str, since: datetime | None = None,
) -> int:
    """Count LLM calls today for a specific function."""
    from api.models.llm_call import LLMCall

    result = await db.execute(
        select(func.count())
        .select_from(LLMCall)
        .where(
            LLMCall.user_id == user_id,
            LLMCall.function == function_name,
            LLMCall.created_at >= (since or today_start()),
        )
    )
    return result.scalar_one()


async def get_daily_chat_count(db: AsyncSession, user_id: uuid.UUID, since: datetime | None = None) -> int:
    """Count chat-related LLM calls today (step_chat + final_answer_chat)."""
    from api.models.llm_call import LLMCall

    result = await db.execute(
        select(func.count())
        .select_from(LLMCall)
        .where(
            LLMCall.user_id == user_id,
            LLMCall.function.in_(["step_chat", "judge"]),
            LLMCall.created_at >= (since or today_start()),
        )
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

    # School students get pro-level access
    if await is_school_enrolled(db, user_id):
        return

    cutoff = usage_cutoff(user)

    if entitlement == Entitlement.CREATE_SESSION:
        # Count decomposition LLM calls (not session records) since
        # mock tests and practice also consume decomps without creating
        # individual session records per problem.
        count = await get_daily_decomp_count(db, user_id, cutoff)
        if count >= FREE_DAILY_SESSION_LIMIT:
            raise EntitlementError(
                entitlement,
                f"Free plan limited to {FREE_DAILY_SESSION_LIMIT} problems per day."
                " Upgrade to Pro for unlimited access.",
                is_limit=True,
            )
        return

    if entitlement == Entitlement.CHAT_MESSAGE:
        count = await get_daily_chat_count(db, user_id, cutoff)
        if count >= FREE_DAILY_CHAT_LIMIT:
            raise EntitlementError(
                entitlement,
                f"Free plan limited to {FREE_DAILY_CHAT_LIMIT} messages per day."
                " Upgrade to Pro for unlimited chat.",
                is_limit=True,
            )
        return

    if entitlement == Entitlement.IMAGE_SCAN:
        count = await get_daily_llm_call_count(db, user_id, "image_extract", cutoff)
        if count >= FREE_DAILY_IMAGE_SCAN_LIMIT:
            raise EntitlementError(
                entitlement,
                f"Free plan limited to {FREE_DAILY_IMAGE_SCAN_LIMIT} image scans per day."
                " Upgrade to Pro for unlimited scans.",
                is_limit=True,
            )
        return

    if entitlement == Entitlement.WORK_DIAGNOSIS:
        raise EntitlementError(entitlement, "Work diagnosis requires a Pro subscription")
