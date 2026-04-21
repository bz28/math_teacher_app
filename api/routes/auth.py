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
from api.models.app_stat import AppStat
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.promo import PromoRedemption
from api.models.school import School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.section_invite import SectionInvite
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


@router.get("/invite/section/{token}")
async def validate_section_invite(token: str, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """Validate a section invite token and return pre-fill data for the registration form."""
    invite, section, course, school = await _load_section_invite(db, token)
    return {
        "email": invite.email,
        "section_id": str(section.id),
        "section_name": section.name,
        "course_id": str(course.id),
        "course_name": course.name,
        "school_name": school.name if school else "",
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
    if body.invite_token and body.section_invite_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot use a teacher invite and a section invite together",
        )
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

    # Section invite (student): claim after user is created so we can enroll.
    section_invite: SectionInvite | None = None
    section_course: Course | None = None
    if body.section_invite_token:
        section_invite, _, section_course, _ = await _load_section_invite(
            db, body.section_invite_token,
        )
        if section_invite.email.lower() != body.email.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email does not match invite",
            )
        role = "student"
        if section_course and section_course.school_id is not None:
            school_id = section_course.school_id

    # A bare "role=teacher" (no invite) is always rejected. Done AFTER the
    # invite blocks so a section invite with role=teacher gets the clearer
    # "section invite forces student role" outcome — the invite wins and
    # the role is overridden to student above.
    if role == "teacher" and not body.invite_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher registration requires a school invite",
        )

    # Join code (student): validate up-front so we don't create a user if
    # the code is bad. Mutually exclusive with invite flows (either invite
    # already picked the section/school, or the student is self-signing up).
    join_section_obj: Section | None = None
    if body.join_code:
        if body.invite_token or body.section_invite_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot use a join code together with an invite",
            )
        code = body.join_code.strip().upper()
        join_section_obj = (await db.execute(
            select(Section).where(Section.join_code == code)
        )).scalar_one_or_none()
        if not join_section_obj:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid join code")
        if join_section_obj.join_code_expires_at and join_section_obj.join_code_expires_at < datetime.now(UTC):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Join code expired")
        join_course = (await db.execute(
            select(Course).where(Course.id == join_section_obj.course_id)
        )).scalar_one_or_none()
        if join_course and join_course.school_id is not None:
            school_id = join_course.school_id

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        grade_level=body.grade_level,
        role=role,
        school_id=school_id,
    )
    db.add(user)
    await db.flush()

    # Brand-new user, so no pre-check for duplicate course enrollment.
    if section_invite is not None and section_course is not None:
        db.add(SectionEnrollment(
            section_id=section_invite.section_id,
            course_id=section_course.id,
            student_id=user.id,
        ))
        section_invite.status = "accepted"
    if join_section_obj is not None:
        db.add(SectionEnrollment(
            section_id=join_section_obj.id,
            course_id=join_section_obj.course_id,
            student_id=user.id,
        ))

    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


class ClaimSectionInviteRequest(BaseModel):
    token: str


@router.post("/invite/section/claim")
async def claim_section_invite(
    body: ClaimSectionInviteRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Claim a section invite as an already-logged-in user.

    Used when a student already has an account, clicks the email link, and
    we need to enroll them without going through signup again.
    """
    invite, _, course, _ = await _load_section_invite(db, body.token)
    if invite.email.lower() != user.email.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This invite was sent to a different email. Sign out and sign in with that account.",
        )
    already_enrolled = (await db.execute(
        select(SectionEnrollment).where(
            SectionEnrollment.section_id == invite.section_id,
            SectionEnrollment.student_id == user.id,
        )
    )).scalar_one_or_none()
    if not already_enrolled:
        # Block if the student is in a different section of this course.
        other_section = (await db.execute(
            select(Section.name)
            .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
            .where(
                SectionEnrollment.student_id == user.id,
                SectionEnrollment.course_id == course.id,
            )
        )).scalar_one_or_none()
        if other_section:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"You're already enrolled in {other_section} for this class.",
            )
        db.add(SectionEnrollment(
            section_id=invite.section_id,
            course_id=course.id,
            student_id=user.id,
        ))
    if user.school_id is None and course is not None and course.school_id is not None:
        user.school_id = course.school_id
    invite.status = "accepted"
    await db.commit()
    return {"status": "ok", "section_id": str(invite.section_id)}


async def _load_section_invite(
    db: AsyncSession, token: str,
) -> tuple[SectionInvite, Section, Course, School | None]:
    """Validate and load a section invite. Marks expired invites on the way."""
    invite = (await db.execute(
        select(SectionInvite).where(SectionInvite.token == token)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.status == "revoked":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite was revoked by the teacher. Ask them to send a new one.",
        )
    if invite.status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invite has already been used.",
        )
    if invite.status == "expired" or invite.expires_at < datetime.now(UTC):
        if invite.status != "expired":
            invite.status = "expired"
            await db.commit()
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This invite has expired")
    section = (await db.execute(
        select(Section).where(Section.id == invite.section_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Section no longer exists")
    course = (await db.execute(
        select(Course).where(Course.id == section.course_id)
    )).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Course no longer exists")
    school: School | None = None
    if course.school_id is not None:
        school = (await db.execute(
            select(School).where(School.id == course.school_id)
        )).scalar_one_or_none()
        if school is not None and not school.is_active:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="School is no longer active")
    return invite, section, course, school


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
            select(func.count()).select_from(CourseTeacher).where(CourseTeacher.teacher_id == user.id)
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

    # Increment lifetime counter (same transaction — rolls back if delete fails)
    await db.execute(
        update(AppStat).where(AppStat.key == "deleted_accounts").values(value=AppStat.value + 1)
    )

    # Capture ID before commit expires the ORM object
    user_id = user.id

    # Delete the user row
    await db.delete(user)
    await db.commit()

    logger.info("Account deleted: user=%s", user_id)


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
        .join(CourseTeacher, CourseTeacher.course_id == Course.id)
        .join(User, User.id == CourseTeacher.teacher_id)
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
