import asyncio
import hashlib
import html
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
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
    is_school_active_teacher,
    is_school_enrolled,
    usage_cutoff,
)
from api.core.mfa import (
    MAX_MFA_ATTEMPTS,
    code_expiry,
    create_pending_token,
    decode_pending_token,
    generate_code,
    hash_code,
    is_code_expired,
    send_mfa_code_email,
    verify_code,
)
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.middleware.rate_limit import limiter
from api.models.app_stat import AppStat
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
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
    LoginVerifyMfaRequest,
    MfaChallengeResponse,
    MfaDisableRequest,
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
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    # COPPA gate before any DB work. Runs first so an under-13 attempting
    # personal self-signup gets a deterministic 400 without leaking whether
    # their email is registered. Invited / join-code paths bypass the gate
    # because the school-consent exception under 15 U.S.C. § 6502 applies.
    try:
        body.enforce_coppa_self_signup_gate()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

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
        # Join codes are a student-only enrollment path. Force the role
        # to student so a malicious caller can't combine role=teacher
        # with a leaked join code to escalate into a teacher attached
        # to that school. Mirrors the section_invite override above.
        role = "student"

    # Teacher self-signup with no invite/section/join token: provision a
    # synthetic personal school so every teacher (and any student who
    # later joins their section) has a stamped school_id. Entitlements
    # still cap them via the `kind='individual'` signal, and the
    # ck_users_school_required_for_teacher CHECK constraint requires a
    # non-NULL school_id for teachers.
    if role == "teacher" and school_id is None:
        display_name = body.name.strip() or body.email.split("@")[0]
        personal_school = School(
            name=f"{display_name}'s classroom",
            kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name=display_name,
            contact_email=body.email,
            is_active=True,
        )
        db.add(personal_school)
        await db.flush()
        school_id = personal_school.id

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        grade_level=body.grade_level,
        role=role,
        school_id=school_id,
        signup_school_name=(
            body.signup_school_name
            if role == "teacher" and not body.invite_token
            else None
        ),
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

    # Fire-and-forget signup notification to the admin team. Early-
    # user visibility: see new activations in inbox without watching
    # the dashboard. Wrapped so an email outage never blocks signup.
    #
    # Every user-controlled field is run through html.escape because
    # the /auth/register endpoint is public — an attacker can submit
    # name='<a href="evil">Click here</a>' and the unescaped HTML
    # would render verbatim in admin inboxes. The subject line is
    # escaped too so header-shaping characters don't leak through.
    if settings.admin_alert_emails:
        signup_path = (
            "Teacher invite" if body.invite_token else
            "Section invite" if body.section_invite_token else
            "Join code" if body.join_code else
            "Self-signup"
        )
        safe_name = html.escape(body.name)
        safe_email = html.escape(body.email)
        school_line = (
            f"<li><strong>School:</strong> {html.escape(body.signup_school_name)}</li>"
            if role == "teacher" and body.signup_school_name else ""
        )
        grade_line = (
            f"<li><strong>Grade:</strong> {body.grade_level}</li>"
            if body.grade_level else ""
        )
        dashboard_path = (
            "teachers/independent" if role == "teacher"
            else "students/independent"
        )
        asyncio.create_task(send_email(
            to=settings.admin_alert_emails,
            subject=f"New signup: {safe_name} ({role})",
            html=(
                f"<h2>New {role} signup</h2>"
                f"<ul>"
                f"<li><strong>Name:</strong> {safe_name}</li>"
                f"<li><strong>Email:</strong> {safe_email}</li>"
                f"<li><strong>Role:</strong> {role}</li>"
                f"{school_line}"
                f"{grade_line}"
                f"<li><strong>Signup path:</strong> {signup_path}</li>"
                f"</ul>"
                f'<p><a href="https://admin.veradicai.com/{dashboard_path}">View in dashboard</a></p>'
            ),
        ))

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


@router.post("/login")
@limiter.limit("5/minute")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse | MfaChallengeResponse:
    """Verify password, optionally issue an MFA challenge.

    Returns TokenResponse for accounts without MFA enabled. Returns
    MfaChallengeResponse (and emails a 6-digit code) when the account
    has opted in to MFA — the client must then POST to
    /auth/login/verify-mfa with the pending_token + code to receive
    real tokens. See api/core/mfa.py for the full flow.
    """
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

    # MFA branch — issue a code challenge instead of tokens.
    if user.mfa_enabled:
        code = generate_code()
        user.mfa_code_hash = hash_code(code)
        user.mfa_code_expires_at = code_expiry()
        user.mfa_code_attempts = 0
        await db.commit()
        # Email is awaited so an outage surfaces in logs; send_email
        # swallows exceptions so a delivery failure won't 500 the
        # request — the user can simply log in again to trigger a
        # fresh code.
        await send_mfa_code_email(to=user.email, name=user.name, code=code)
        pending_token = create_pending_token(str(user.id))
        return MfaChallengeResponse(mfa_pending_token=pending_token)

    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login/verify-mfa", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login_verify_mfa(
    request: Request,
    body: LoginVerifyMfaRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Complete an MFA login by submitting the emailed 6-digit code.

    Pending token validation prevents random code attempts against a
    known email without going through /auth/login first (which itself
    requires a valid password). Wrong-code attempts are counted; the
    challenge is invalidated server-side after MAX_MFA_ATTEMPTS so the
    online brute-force surface against a 6-digit secret is bounded.
    """
    try:
        user_id_str = decode_pending_token(body.mfa_pending_token)
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired challenge. Please log in again.",
        ) from e

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid challenge",
        ) from e

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid challenge",
        )

    if not user.mfa_enabled:
        # User disabled MFA between login and verify. Refuse this
        # challenge and require a fresh login (which will skip MFA).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="MFA is not enabled. Please log in again.",
        )

    if user.mfa_code_hash is None or is_code_expired(user.mfa_code_expires_at):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Code expired. Please log in again.",
        )

    if user.mfa_code_attempts >= MAX_MFA_ATTEMPTS:
        # Burn the challenge entirely. Attacker has to start over from
        # /auth/login (rate-limited at 5/minute per IP).
        user.mfa_code_hash = None
        user.mfa_code_expires_at = None
        user.mfa_code_attempts = 0
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Too many attempts. Please log in again.",
        )

    if not verify_code(body.code, user.mfa_code_hash):
        user.mfa_code_attempts += 1
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect code",
        )

    # Success — clear challenge and issue tokens normally.
    user.mfa_code_hash = None
    user.mfa_code_expires_at = None
    user.mfa_code_attempts = 0
    await db.commit()

    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/mfa/enable", status_code=status.HTTP_204_NO_CONTENT)
async def mfa_enable(
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Opt the current account in to email-based MFA.

    No setup required — the user's email already serves as the second
    factor channel. Future logins will issue a code instead of tokens
    until /mfa/disable is called.
    """
    user.mfa_enabled = True
    user.mfa_code_hash = None
    user.mfa_code_expires_at = None
    user.mfa_code_attempts = 0
    await db.commit()


@router.post("/mfa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def mfa_disable(
    body: MfaDisableRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Disable MFA after re-verifying the user's password.

    Password re-entry blocks a session-hijack attacker (who has an
    access token but not the password) from weakening the account.
    """
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
        )
    user.mfa_enabled = False
    user.mfa_code_hash = None
    user.mfa_code_expires_at = None
    user.mfa_code_attempts = 0
    await db.commit()


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

    # Single source of truth for is_pro across the frontend: fold in
    # BOTH school-paid paths so a school-covered user reads back as
    # pro from /auth/me. Without this, the pricing page (reads
    # user.is_pro) treats school-covered users as free and shows them
    # the upgrade flow.
    #   - is_school_enrolled: students linked via SectionEnrollment
    #   - is_school_active_teacher: teachers carrying school_id directly
    # is_pro(user) covers self-pay (Stripe/RevenueCat); the OR-chain
    # adds school-coverage for both audiences.
    is_pro_via_school = await is_school_enrolled(db, user.id) or await is_school_active_teacher(db, user)
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
        subscription_provider=user.subscription_provider,
        subscription_expires_at=user.subscription_expires_at,
        is_pro=is_pro(user) or is_pro_via_school,
        has_stripe_customer=bool(user.stripe_customer_id),
        is_preview=user.is_preview,
        mfa_enabled=user.mfa_enabled,
    )


@router.get("/my-data")
@limiter.limit("3/minute")
async def my_data(
    request: Request,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Self-service data export — the personal data Veradic holds on the
    requesting user. Satisfies the PA Personnel Files Act (43 P.S.
    §§ 1321-1324) for teacher accounts and is reasonable practice for
    any user requesting their data.

    Returns account fields, an activity-counts summary, and a
    role-specific section (courses for teachers, enrollments for
    students). For full historical content (every session step, every
    LLM call) the response includes a contact pointer so we can
    deliver a tailored export — keeping this endpoint bounded.
    """
    school_name = None
    if user.school_id:
        school = (
            await db.execute(select(School.name).where(School.id == user.school_id))
        ).scalar_one_or_none()
        school_name = school

    account: dict[str, Any] = {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "grade_level": user.grade_level,
        "school_id": str(user.school_id) if user.school_id else None,
        "school_name": school_name,
        "signup_school_name": user.signup_school_name,
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "subscription_provider": user.subscription_provider,
        "subscription_expires_at": (
            user.subscription_expires_at.isoformat()
            if user.subscription_expires_at else None
        ),
        "is_active": user.is_active,
        "mfa_enabled": user.mfa_enabled,
        "is_preview": user.is_preview,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }

    sessions_count = (
        await db.execute(
            select(func.count()).select_from(Session).where(Session.user_id == user.id)
        )
    ).scalar() or 0
    submissions_count = (
        await db.execute(
            select(func.count()).select_from(WorkSubmission).where(WorkSubmission.user_id == user.id)
        )
    ).scalar() or 0
    llm_calls_count = (
        await db.execute(
            select(func.count()).select_from(LLMCall).where(LLMCall.user_id == user.id)
        )
    ).scalar() or 0

    activity_summary: dict[str, Any] = {
        "sessions": sessions_count,
        "submissions": submissions_count,
        "llm_calls": llm_calls_count,
    }

    role_specific: dict[str, Any] = {}
    if user.role == "teacher":
        # Teacher-authored courses. Course-level only (no student PII).
        courses_q = await db.execute(
            select(Course)
            .join(CourseTeacher, CourseTeacher.course_id == Course.id)
            .where(CourseTeacher.teacher_id == user.id)
        )
        role_specific["courses"] = [
            {
                "id": str(c.id),
                "name": c.name,
                "subject": c.subject,
                "grade_level": c.grade_level,
                "school_id": str(c.school_id) if c.school_id else None,
            }
            for c in courses_q.scalars().all()
        ]

    if user.role == "student":
        # Student's own enrollments. Course/section IDs only — names
        # are looked up by the frontend if needed.
        enrollments_q = await db.execute(
            select(SectionEnrollment).where(SectionEnrollment.student_id == user.id)
        )
        role_specific["enrollments"] = [
            {
                "section_id": str(e.section_id),
                "course_id": str(e.course_id),
                "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
            }
            for e in enrollments_q.scalars().all()
        ]

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "note": (
            "This export contains the personal data Veradic holds about you, "
            "summarized for portability. For detailed records (individual "
            "session content, full LLM call history, or specific records not "
            "shown here) contact support@veradicai.com and we will deliver a "
            "tailored export within a reasonable timeframe."
        ),
        "account": account,
        "activity_summary": activity_summary,
        "role_specific": role_specific,
    }


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
    # Match /auth/me's is_pro fold so the two endpoints agree on
    # school-covered users (both students AND teachers).
    user_is_pro = (
        is_pro(user)
        or await is_school_enrolled(db, user.id)
        or await is_school_active_teacher(db, user)
    )
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
