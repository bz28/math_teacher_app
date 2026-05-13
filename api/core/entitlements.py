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
TEACHER_DAILY_GENERATION_LIMIT = 10

# LLMCall.function string emitted by the teacher generation pipeline
# (LLMMode.GENERATE_QUESTIONS in api/core/llm_client.py). Counted toward
# the teacher daily-generation cap. Kept as a constant because the
# entitlement enum value ("generate_problem") is intentionally the
# *product* identifier shown to the frontend, distinct from the
# *function* identifier in LLMCall rows.
_GENERATE_FUNCTION = "generate_questions"


class Entitlement(enum.StrEnum):
    CREATE_SESSION = "create_session"
    CHAT_MESSAGE = "chat_message"
    IMAGE_SCAN = "image_scan"
    WORK_DIAGNOSIS = "work_diagnosis"
    GENERATE_PROBLEM = "generate_problem"


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


async def is_school_active_teacher(db: AsyncSession, user: object) -> bool:
    """Check if a teacher belongs to an active school.

    Teachers carry `school_id` directly on the user row (unlike students,
    who link via SectionEnrollment), so this is a single-table lookup.
    Used to bypass free-tier quotas for teachers whose school is paying.
    """
    from api.models.school import School

    role = getattr(user, "role", "")
    school_id = getattr(user, "school_id", None)
    if role != "teacher" or school_id is None:
        return False

    result = await db.execute(
        select(School.is_active).where(School.id == school_id)
    )
    row = result.first()
    return bool(row and row.is_active)


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
    db: AsyncSession,
    user_id: uuid.UUID,
    function_name: str,
    since: datetime | None = None,
    *,
    success_only: bool = False,
) -> int:
    """Count LLM calls today for a specific function.

    success_only=True filters to LLMCall.success=True — used for cap
    enforcement so failed model calls don't burn a user's daily
    allowance (a teacher whose 10 generation attempts all timed out
    at the provider shouldn't see "0 problems / 10 used today").
    """
    from api.models.llm_call import LLMCall

    where_clauses = [
        LLMCall.user_id == user_id,
        LLMCall.function == function_name,
        LLMCall.created_at >= (since or today_start()),
    ]
    if success_only:
        where_clauses.append(LLMCall.success.is_(True))

    result = await db.execute(
        select(func.count()).select_from(LLMCall).where(*where_clauses)
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

    if entitlement == Entitlement.GENERATE_PROBLEM:
        # Teacher-only cap for now. Other roles fall through (no quota).
        # When a student-side cap is needed, branch here on user.role.
        if getattr(user, "role", "") != "teacher":
            return
        # Teachers backed by an active school skip the cap — their
        # school is paying. Scoped to this entitlement so we don't
        # silently lift other caps for school teachers.
        if await is_school_active_teacher(db, user):
            return
        # Known TOCTOU limitation: the LLMCall row this counts is
        # written by the async generation worker AFTER the route
        # returns. N concurrent /generate requests for the same
        # teacher all read the same pre-call count and all pass.
        # Mitigations today: every route that hits this gate carries
        # a slowapi @limiter.limit("3/minute") (generate_bank_questions,
        # generate_similar_bank_questions, clone_homework_as_practice),
        # bounding the worst-case race window to ~3 parallel
        # requests, and the soft 10/day cap on a still-small user
        # base. A proper fix (reservation counter on User incremented
        # in the gate transaction) is tracked separately.
        # success_only=True so a teacher whose attempts failed at
        # the model doesn't burn their daily allowance.
        count = await get_daily_llm_call_count(
            db, user_id, _GENERATE_FUNCTION, cutoff, success_only=True,
        )
        if count >= TEACHER_DAILY_GENERATION_LIMIT:
            raise EntitlementError(
                entitlement,
                f"Free plan limited to {TEACHER_DAILY_GENERATION_LIMIT} problems per day."
                " Upgrade to Pro for unlimited generation.",
                is_limit=True,
            )
        return
