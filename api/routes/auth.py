import asyncio
import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.auth import (
    check_lockout,
    create_access_token,
    create_refresh_token,
    hash_password,
    record_failed_login,
    reset_failed_logins,
    rotate_refresh_token,
    verify_password,
)
from api.core.email import send_email
from api.core.entitlements import (
    FREE_DAILY_CHAT_LIMIT,
    FREE_DAILY_IMAGE_SCAN_LIMIT,
    FREE_DAILY_SESSION_LIMIT,
    Entitlement,
    get_daily_chat_count,
    get_daily_decomp_count,
    get_daily_llm_call_count,
    is_pro,
    is_school_enrolled,
    usage_cutoff,
)
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.middleware.rate_limit import limiter
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.promo import PromoRedemption
from api.models.school import School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.session import Session
from api.models.teacher_invite import TeacherInvite
from api.models.user import RefreshToken, User
from api.models.work_submission import WorkSubmission
from api.schemas.auth import (
    CheckEmailRequest,
    DeleteAccountRequest,
    EntitlementLimits,
    EntitlementsResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/check-email")
async def check_email(body: CheckEmailRequest, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    return {"available": True}


@router.get("/invite/{token}")
async def validate_invite(token: str, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """Validate a teacher invite token and return pre-fill data for the registration form."""
    invite = (await db.execute(
        select(TeacherInvite).where(TeacherInvite.token == token, TeacherInvite.status == "pending")
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired invite")
    if invite.expires_at < datetime.now(UTC):
        invite.status = "expired"
        await db.commit()
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite has expired")

    school = (await db.execute(select(School).where(School.id == invite.school_id))).scalar_one_or_none()
    if not school or not school.is_active:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="School is no longer active")

    return {
        "email": invite.email,
        "school_name": school.name,
        "school_id": str(school.id),
    }


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    # Handle teacher invite flow
    school_id = None
    role = body.role
    if body.invite_token:
        invite = (await db.execute(
            select(TeacherInvite).where(TeacherInvite.token == body.invite_token, TeacherInvite.status == "pending")
        )).scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired invite")
        if invite.expires_at < datetime.now(UTC):
            invite.status = "expired"
            await db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite has expired")
        if invite.email.lower() != body.email.lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email does not match invite")

        school = (await db.execute(select(School).where(School.id == invite.school_id))).scalar_one_or_none()
        if not school or not school.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="School is no longer active")

        school_id = school.id
        role = "teacher"
        invite.status = "accepted"

    elif role == "teacher":
        # Teachers can only register via invite
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher registration requires a school invite",
        )

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        grade_level=body.grade_level,
        role=role,
        school_id=school_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    if check_lockout(user):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Account temporarily locked. Try again later.",
        )

    if not verify_password(body.password, user.password_hash):
        await record_failed_login(db, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    await reset_failed_logins(db, user)
    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await rotate_refresh_token(db, body.refresh_token)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    access_token, new_refresh, _ = result
    return TokenResponse(access_token=access_token, refresh_token=new_refresh)


@router.get("/me", response_model=UserResponse)
async def me(
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    school_name = None
    if user.school_id:
        school = (await db.execute(select(School.name).where(School.id == user.school_id))).scalar_one_or_none()
        school_name = school

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        grade_level=user.grade_level,
        role=user.role,
        school_id=user.school_id,
        school_name=school_name,
        subscription_tier=user.subscription_tier,
        subscription_status=user.subscription_status,
        subscription_expires_at=user.subscription_expires_at,
        is_pro=is_pro(user),
    )


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
async def delete_account(
    request: Request,
    body: DeleteAccountRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently delete the current user's account with hybrid anonymization."""
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")

    # Block teachers with active courses
    if user.role == "teacher":
        course_count = (await db.execute(
            select(func.count()).select_from(Course).where(Course.teacher_id == user.id)
        )).scalar() or 0
        if course_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You have active courses. Please delete or transfer them before deleting your account.",
            )

    # Anonymize analytics: set user_id = NULL on sessions and llm_calls
    await db.execute(update(Session).where(Session.user_id == user.id).values(user_id=None))
    await db.execute(update(LLMCall).where(LLMCall.user_id == user.id).values(user_id=None))

    # Hard delete PII and user-specific data
    await db.execute(delete(PromoRedemption).where(PromoRedemption.user_id == user.id))
    await db.execute(delete(WorkSubmission).where(WorkSubmission.user_id == user.id))
    await db.execute(delete(SectionEnrollment).where(SectionEnrollment.student_id == user.id))
    await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))

    # Delete the user row
    await db.delete(user)
    await db.commit()

    logger.info("Account deleted: user=%s email=%s", user.id, user.email)


@router.get("/entitlements", response_model=EntitlementsResponse)
async def entitlements(
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> EntitlementsResponse:
    """Return the current user's entitlement state."""
    user_is_pro = is_pro(user) or await is_school_enrolled(db, user.id)
    cutoff = usage_cutoff(user)
    problems_used = await get_daily_decomp_count(db, user.id, cutoff)
    scans_used = await get_daily_llm_call_count(db, user.id, "image_extract", cutoff)
    chats_used = await get_daily_chat_count(db, user.id, cutoff)

    gated_features = []
    if not user_is_pro:
        gated_features = [e.value for e in Entitlement if e != Entitlement.CREATE_SESSION]

    return EntitlementsResponse(
        is_pro=user_is_pro,
        subscription_tier=user.subscription_tier,
        subscription_status=user.subscription_status,
        subscription_expires_at=user.subscription_expires_at,
        limits=EntitlementLimits(
            daily_sessions_used=problems_used,
            daily_sessions_limit=None if user_is_pro else FREE_DAILY_SESSION_LIMIT,
            daily_scans_used=scans_used,
            daily_scans_limit=None if user_is_pro else FREE_DAILY_IMAGE_SCAN_LIMIT,
            daily_chats_used=chats_used,
            daily_chats_limit=None if user_is_pro else FREE_DAILY_CHAT_LIMIT,
        ),
        gated_features=gated_features,
    )


@router.get("/enrolled-courses")
async def enrolled_courses(
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return courses the current user is enrolled in via section enrollments."""
    rows = (await db.execute(
        select(
            Course.id,
            Course.name,
            Course.subject,
            Course.grade_level,
            Section.id.label("section_id"),
            Section.name.label("section_name"),
            User.name.label("teacher_name"),
        )
        .join(Section, Section.course_id == Course.id)
        .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
        .join(User, User.id == Course.teacher_id)
        .join(School, School.id == User.school_id)
        .where(
            SectionEnrollment.student_id == user.id,
            School.is_active.is_(True),
        )
        .order_by(Course.name)
    )).all()

    return {
        "courses": [
            {
                "id": str(r.id),
                "name": r.name,
                "subject": r.subject,
                "grade_level": r.grade_level,
                "section_id": str(r.section_id),
                "section_name": r.section_name,
                "teacher_name": r.teacher_name,
            }
            for r in rows
        ]
    }


# ── Password reset ────────────────────────────────────────────────────────

RESET_TOKEN_EXPIRY_HOURS = 1


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class SetPasswordRequest(BaseModel):
    token: str
    password: str


@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Send a password reset email. Always returns 200 to avoid leaking user existence."""
    user = (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if user and user.is_active:
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        user.password_reset_token_hash = token_hash
        user.password_reset_expires = datetime.now(UTC) + timedelta(hours=RESET_TOKEN_EXPIRY_HOURS)
        await db.commit()

        reset_url = f"{settings.frontend_url}/set-password?token={raw_token}"
        asyncio.create_task(send_email(
            to=[body.email.lower()],
            subject="Reset your Veradic AI password",
            html=(
                f"<h2>Password Reset</h2>"
                f"<p>Click the link below to reset your password:</p>"
                f'<p><a href="{reset_url}" style="display:inline-block;padding:12px 24px;'
                f'background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;'
                f'font-weight:600;">Reset Password</a></p>'
                f"<p style=\"color:#64748b;font-size:13px;\">This link expires in {RESET_TOKEN_EXPIRY_HOURS} hour.</p>"
                f'<p style="color:#94a3b8;font-size:12px;">'
                f"If you didn't request this, you can safely ignore this email.</p>"
            ),
        ))

    return {"status": "ok", "message": "If that email exists, a reset link has been sent."}


@router.post("/set-password")
@limiter.limit("5/minute")
async def set_password(
    request: Request,
    body: SetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Set a new password using a reset token (from invite or forgot-password)."""
    if len(body.password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters")

    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    user = (await db.execute(
        select(User).where(User.password_reset_token_hash == token_hash)
    )).scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired link")
    if user.password_reset_expires and user.password_reset_expires < datetime.now(UTC):
        user.password_reset_token_hash = None
        user.password_reset_expires = None
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This link has expired")

    user.password_hash = hash_password(body.password)
    user.password_reset_token_hash = None
    user.password_reset_expires = None
    await db.commit()

    logger.info("Password set via token for user=%s", user.id)
    return {"status": "ok"}
