from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
from api.models.school import School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.teacher_invite import TeacherInvite
from api.models.user import User
from api.schemas.auth import (
    CheckEmailRequest,
    EntitlementLimits,
    EntitlementsResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/check-email")
async def check_email(body: CheckEmailRequest, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    return {"available": True}


@router.get("/invite/{token}")
async def validate_invite(token: str, db: AsyncSession = Depends(get_db)) -> dict:
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
) -> dict:
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
