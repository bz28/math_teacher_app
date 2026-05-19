"""Admin user management endpoints."""

import asyncio
import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import stripe
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import hash_password
from api.core.email import send_email
from api.core.entitlements import (
    FREE_DAILY_CHAT_LIMIT,
    FREE_DAILY_IMAGE_SCAN_LIMIT,
    FREE_DAILY_SESSION_LIMIT,
    today_start,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission
from api.models.course import CourseTeacher
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.session import Session
from api.models.user import User
from api.routes.admin_helpers import time_range

INVITE_TOKEN_EXPIRY_HOURS = 48

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/users")
async def users(
    hours: int = Query(default=720, ge=1, le=2160),
    sort_by: str = Query(default="total_cost", pattern=r"^(total_cost|session_count|last_active|name)$"),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=100),
    role: str | None = Query(default=None, pattern=r"^(student|teacher|admin)$"),
    no_school: bool = Query(default=False),
    # Teacher-only conversion-prospect filters. has_classroom limits
    # to teachers running at least one section with students enrolled;
    # active_classroom further requires a submission in the last 30d.
    # Both no-op when applied to non-teachers (their classroom counts
    # are always 0), so it's safe to send them blindly from the
    # frontend.
    has_classroom: bool = Query(default=False),
    active_classroom: bool = Query(default=False),
    # Student-attention filters powering the Independent Students chips.
    # at_limit_today: free users who hit any daily cap today — the
    #   right-now Pro-conversion list.
    # free_heavy: free users with 3+ sessions in the last 7d — about
    #   to hit the wall; upgrade outreach candidates.
    # pro_inactive: Pro users with no session in 14d — silent churn.
    at_limit_today: bool = Query(default=False),
    free_heavy: bool = Query(default=False),
    pro_inactive: bool = Query(default=False),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)

    # Scope filters — applied to every aggregate and the list so the
    # Independent students / Independent teachers pages see consistent
    # numbers across stats and rows. `is_preview=False` always
    # applies, even with no role/no_school filter, so `total_spend`
    # and `active_7d` on the (hidden) /users page now exclude preview
    # accounts and LLM calls with NULL user_id — matching how the
    # row population was already filtered pre-PR.
    scope_filters: list[Any] = [User.is_preview.is_(False)]
    if role:
        scope_filters.append(User.role == role)
    if no_school:
        # "Independent" means different things for the two roles
        # post-bp1000059:
        #  - Teachers always have a school_id (CHECK constraint).
        #    Indie ones point at a kind='individual' synthetic
        #    school — that's the new signal.
        #  - Students may be solo (consumer-app users who never
        #    joined a class) and keep school_id IS NULL. Students of
        #    indie teachers have school_id set and belong under that
        #    teacher's roster, NOT in the global "Independent
        #    Students" list.
        # When the page doesn't constrain role we default to the
        # student semantics (matches the pre-refactor meaning of
        # "no school").
        if role == "teacher":
            scope_filters.append(
                select(School.id)
                .where(
                    School.id == User.school_id,
                    School.kind == SCHOOL_KIND_INDIVIDUAL,
                )
                .exists()
            )
        else:
            scope_filters.append(User.school_id.is_(None))

    # Subquery of user IDs in scope — referenced by the spend and
    # active-user aggregates so they only count users we're showing.
    scope_user_ids = select(User.id).where(*scope_filters).subquery()

    total_users = (await db.execute(
        select(func.count()).select_from(User).where(*scope_filters)
    )).scalar() or 0

    # Active users (7d)
    active_7d = (await db.execute(
        select(func.count(func.distinct(Session.user_id)))
        .where(
            Session.created_at >= time_range(168),
            Session.user_id.in_(select(scope_user_ids.c.id)),
        )
    )).scalar() or 0

    # Total spend (scope-filtered, in period)
    total_spend = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0))
        .where(
            LLMCall.created_at >= since,
            LLMCall.user_id.in_(select(scope_user_ids.c.id)),
        )
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

    # Teacher classroom stats — the "is this independent teacher
    # secretly running a classroom-sized operation?" signal. Same
    # subquery pattern as cost/sessions: built unconditionally so the
    # main query doesn't branch, but only the IndependentTeachers
    # page surfaces these fields.
    teacher_sections = (
        select(
            CourseTeacher.teacher_id.label("user_id"),
            func.count(func.distinct(Section.id)).label("section_count"),
        )
        .join(Section, Section.course_id == CourseTeacher.course_id)
        .group_by(CourseTeacher.teacher_id)
        .subquery()
    )

    teacher_students = (
        select(
            CourseTeacher.teacher_id.label("user_id"),
            func.count(func.distinct(SectionEnrollment.student_id)).label("student_count"),
        )
        .join(Section, Section.course_id == CourseTeacher.course_id)
        .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
        .group_by(CourseTeacher.teacher_id)
        .subquery()
    )

    teacher_submissions_30d = (
        select(
            Assignment.teacher_id.label("user_id"),
            func.count(Submission.id).label("submissions_30d"),
        )
        .join(Submission, Submission.assignment_id == Assignment.id)
        .where(Submission.submitted_at >= time_range(24 * 30))
        .group_by(Assignment.teacher_id)
        .subquery()
    )

    # Sort column mapping
    sort_columns = {
        "total_cost": func.coalesce(user_cost.c.total_cost, 0.0).desc(),
        "session_count": func.coalesce(user_sessions.c.session_count, 0).desc(),
        "last_active": func.coalesce(user_sessions.c.last_active, User.created_at).desc(),
        "name": User.name.asc(),
    }

    # Filters — extend scope_filters with optional search.
    search_filters: list[Any] = list(scope_filters)
    if search:
        term = f"%{search}%"
        search_filters.append(User.name.ilike(term) | User.email.ilike(term))

    # Teacher-only refinements via EXISTS — leaves aggregate band
    # unchanged (it still reflects the full population) while
    # narrowing the row list and filtered_count together.
    if has_classroom:
        search_filters.append(
            select(SectionEnrollment.id)
            .join(Section, Section.id == SectionEnrollment.section_id)
            .join(CourseTeacher, CourseTeacher.course_id == Section.course_id)
            .where(CourseTeacher.teacher_id == User.id)
            .exists()
        )
    if active_classroom:
        search_filters.append(
            select(Submission.id)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(
                Assignment.teacher_id == User.id,
                Submission.submitted_at >= time_range(24 * 30),
            )
            .exists()
        )

    # Student-attention refinements. All three only meaningfully match
    # students, but the conditions are subscription-tier-scoped so
    # applying them to teachers/admins just filters them out — safe to
    # send blindly. Same EXISTS / scalar-subquery pattern as the
    # teacher chips so they affect search_filters but not the band.
    if at_limit_today:
        # Lower bound matches `entitlements.usage_cutoff()`: midnight
        # UTC OR the user's daily_limit_reset_at when an admin reset
        # their counters later today. `GREATEST(today, reset_at)` in
        # Postgres ignores NULLs, so this also handles users who've
        # never been reset. Without this the chip would diverge from
        # the live cap engine — a user whose limits were reset would
        # still show "at limit".
        #
        # group_by(user_id) is required for HAVING + COUNT to evaluate
        # per-user. Without it Postgres treats the whole subquery as
        # one aggregate group, the non-aggregated SELECT column makes
        # the query ill-formed, and the planner can short-circuit
        # EXISTS to true for users with zero matching rows.
        cutoff = func.greatest(today, User.daily_limit_reset_at)
        search_filters.append(
            User.subscription_tier != "pro",
        )
        search_filters.append(
            (
                select(LLMCall.user_id)
                .where(
                    LLMCall.user_id == User.id,
                    LLMCall.created_at >= cutoff,
                    LLMCall.function.in_(["decompose", "decompose_diagnosis"]),
                )
                .group_by(LLMCall.user_id)
                .having(func.count() >= FREE_DAILY_SESSION_LIMIT)
                .exists()
            )
            | (
                select(LLMCall.user_id)
                .where(
                    LLMCall.user_id == User.id,
                    LLMCall.created_at >= cutoff,
                    LLMCall.function.in_(["step_chat", "judge"]),
                )
                .group_by(LLMCall.user_id)
                .having(func.count() >= FREE_DAILY_CHAT_LIMIT)
                .exists()
            )
            | (
                select(LLMCall.user_id)
                .where(
                    LLMCall.user_id == User.id,
                    LLMCall.created_at >= cutoff,
                    LLMCall.function == "image_extract",
                )
                .group_by(LLMCall.user_id)
                .having(func.count() >= FREE_DAILY_IMAGE_SCAN_LIMIT)
                .exists()
            )
        )
    if free_heavy:
        # Free user with 3+ sessions in the last 7 days. "Sessions"
        # here is rows in `sessions`, same source as the existing
        # session_count column. group_by required for HAVING — see
        # at_limit_today block above.
        search_filters.append(User.subscription_tier != "pro")
        search_filters.append(
            select(Session.user_id)
            .where(
                Session.user_id == User.id,
                Session.created_at >= time_range(168),
            )
            .group_by(Session.user_id)
            .having(func.count() >= 3)
            .exists()
        )
    if pro_inactive:
        # Pro AND currently paying (matches entitlements.is_pro:
        # active or trial). A user with tier=pro but status=cancelled
        # is no longer paying for us and shouldn't count as "silent
        # churn" — they've already churned.
        search_filters.append(User.subscription_tier == "pro")
        search_filters.append(User.subscription_status.in_(("active", "trial")))
        search_filters.append(
            ~select(Session.id)
            .where(
                Session.user_id == User.id,
                Session.created_at >= time_range(24 * 14),
            )
            .exists()
        )

    # Count of users matching search (for pagination)
    count_query = select(func.count()).select_from(User).where(*search_filters)
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
            func.coalesce(teacher_sections.c.section_count, 0).label("section_count"),
            func.coalesce(teacher_students.c.student_count, 0).label("student_count"),
            func.coalesce(teacher_submissions_30d.c.submissions_30d, 0).label("submissions_30d"),
        )
        .outerjoin(user_cost, user_cost.c.user_id == User.id)
        .outerjoin(user_sessions, user_sessions.c.user_id == User.id)
        .outerjoin(daily_sessions, daily_sessions.c.user_id == User.id)
        .outerjoin(daily_chats, daily_chats.c.user_id == User.id)
        .outerjoin(daily_scans, daily_scans.c.user_id == User.id)
        .outerjoin(teacher_sections, teacher_sections.c.user_id == User.id)
        .outerjoin(teacher_students, teacher_students.c.user_id == User.id)
        .outerjoin(teacher_submissions_30d, teacher_submissions_30d.c.user_id == User.id)
        .where(*search_filters)
    )
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
                "classroom": {
                    "sections": r.section_count,
                    "students": r.student_count,
                    "submissions_30d": r.submissions_30d,
                },
            }
            for r in all_users
        ],
    }


class InviteAdminRequest(BaseModel):
    email: EmailStr
    name: str


@router.post("/users/invite")
async def invite_admin(
    body: InviteAdminRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Create a new admin user and send them an email to set their password."""
    existing = (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

    # Generate password reset token
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    user = User(
        email=body.email.lower(),
        name=body.name.strip(),
        password_hash=hash_password(secrets.token_urlsafe(32)),
        grade_level=0,
        role="admin",
        password_reset_token_hash=token_hash,
        password_reset_expires=datetime.now(UTC) + timedelta(hours=INVITE_TOKEN_EXPIRY_HOURS),
    )
    db.add(user)
    await db.commit()

    set_password_url = f"https://veradicai.com/set-password?token={raw_token}"
    logger.info("AUDIT: admin=%s invited new admin email=%s", current_user.user_id, body.email)

    asyncio.create_task(send_email(
        to=[body.email.lower()],
        subject="You've been invited to Veradic AI Admin",
        html=(
            f"<h2>Welcome to Veradic AI!</h2>"
            f"<p><strong>{current_user.name}</strong> has invited you as an admin.</p>"
            f"<p>Click the link below to set your password and log in:</p>"
            f'<p><a href="{set_password_url}" style="display:inline-block;padding:12px 24px;'
            f'background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;'
            f'font-weight:600;">Set Your Password</a></p>'
            f"<p style=\"color:#64748b;font-size:13px;\">This link expires in {INVITE_TOKEN_EXPIRY_HOURS} hours.</p>"
        ),
    ))

    return {"status": "ok"}


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
    valid_roles = ("student", "teacher", "admin")
    if body.role not in valid_roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Prevent removing your own admin role
    if str(user.id) == str(current_user.user_id) and body.role != "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove your own admin role")

    old_role = user.role
    user.role = body.role
    user.updated_by_id = current_user.user_id
    user.updated_by_name = current_user.name
    await db.commit()
    logger.info(
        "AUDIT: admin=%s changed role of user=%s from '%s' to '%s'",
        current_user.user_id, user_id, old_role, body.role,
    )
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

    old_tier, old_status = user.subscription_tier, user.subscription_status

    # Pro → free for a Stripe-paying teacher: cancel the live Stripe
    # subscription before the DB flip, otherwise we keep charging their
    # card while hiding the manage-portal button in the UI. Demote and
    # the bill keeps coming. Belt-and-suspenders: try Stripe first; if
    # cancellation fails we abort the DB change so admin/billing stay
    # consistent (rather than DB-says-free + Stripe-says-active).
    is_demote_to_free = body.tier == "free" and old_tier == "pro"
    stripe_sub_id = user.stripe_subscription_id
    stripe_cancelled = False
    if (
        is_demote_to_free
        and user.subscription_provider == "stripe"
        and stripe_sub_id
    ):
        try:
            await asyncio.to_thread(stripe.Subscription.cancel, stripe_sub_id)
            logger.info(
                "AUDIT: admin=%s cancelled Stripe sub=%s for user=%s",
                current_user.user_id, stripe_sub_id, user_id,
            )
            user.stripe_subscription_id = None
            stripe_cancelled = True
        except stripe.StripeError as e:
            logger.error(
                "Stripe cancel failed for user=%s sub=%s: %s — aborting demote",
                user_id, stripe_sub_id, e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to cancel Stripe subscription; demote aborted.",
            ) from e

    user.subscription_tier = body.tier
    # If we actually cancelled the Stripe sub, force status='cancelled'
    # regardless of what the admin posted — otherwise an admin POSTing
    # tier=free + status=active would leave the user in a nonsensical
    # 'free + active' state. The cancel is the source of truth.
    user.subscription_status = "cancelled" if stripe_cancelled else body.status
    if body.tier == "pro" and body.status == "active":
        user.subscription_provider = user.subscription_provider or "admin"
    user.updated_by_id = current_user.user_id
    user.updated_by_name = current_user.name
    await db.commit()
    logger.info(
        "AUDIT: admin=%s changed subscription of user=%s from tier='%s'/status='%s' to tier='%s'/status='%s'",
        current_user.user_id, user_id, old_tier, old_status, user.subscription_tier, user.subscription_status,
    )
    return {"status": "ok", "tier": user.subscription_tier, "subscription_status": user.subscription_status}


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

    logger.info("AUDIT: admin=%s deleted user=%s (email=%s)", current_user.user_id, user_id, user.email)
    await db.delete(user)
    await db.commit()
    return {"status": "ok"}


@router.post("/users/{user_id}/reset-daily-limit")
async def reset_daily_limit(
    user_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Reset a user's daily usage limits by shifting the counting window to now."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.daily_limit_reset_at = datetime.now(UTC)
    user.updated_by_id = current_user.user_id
    user.updated_by_name = current_user.name
    await db.commit()
    logger.info("AUDIT: admin=%s reset daily limits for user=%s", current_user.user_id, user_id)
    return {"status": "ok"}
