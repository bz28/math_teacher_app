"""Admin school management endpoints."""

import asyncio
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.school import School
from api.models.teacher_invite import TeacherInvite
from api.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter()

INVITE_EXPIRY_DAYS = 14


# ── Schemas ──────────────────────────────────────────────────────────────────


class CreateSchoolRequest(BaseModel):
    name: str
    city: str | None = None
    state: str | None = None
    contact_name: str
    contact_email: EmailStr
    notes: str | None = None


class UpdateSchoolRequest(BaseModel):
    name: str | None = None
    city: str | None = None
    state: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    is_active: bool | None = None
    notes: str | None = None


class InviteTeacherRequest(BaseModel):
    email: EmailStr


# ── Schools CRUD ─────────────────────────────────────────────────────────────


@router.get("/schools")
async def list_schools(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Teacher count per school
    teacher_counts = (
        select(User.school_id, func.count().label("teacher_count"))
        .where(User.school_id.isnot(None), User.role == "teacher")
        .group_by(User.school_id)
        .subquery()
    )

    rows = (await db.execute(
        select(
            School,
            func.coalesce(teacher_counts.c.teacher_count, 0).label("teacher_count"),
        )
        .outerjoin(teacher_counts, teacher_counts.c.school_id == School.id)
        .order_by(School.created_at.desc())
    )).all()

    return {
        "schools": [
            {
                "id": str(s.id),
                "name": s.name,
                "city": s.city,
                "state": s.state,
                "contact_name": s.contact_name,
                "contact_email": s.contact_email,
                "is_active": s.is_active,
                "teacher_count": int(tc),
                "notes": s.notes,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "updated_by": s.updated_by_name,
            }
            for s, tc in rows
        ]
    }


@router.post("/schools")
async def create_school(
    body: CreateSchoolRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    # Prevent duplicate schools by contact email
    existing = (await db.execute(
        select(School).where(School.contact_email == body.contact_email.lower())
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A school with this contact email already exists: {existing.name}",
        )

    school = School(
        name=body.name,
        city=body.city,
        state=body.state,
        contact_name=body.contact_name,
        contact_email=body.contact_email,
        notes=body.notes,
        updated_by_id=current_user.user_id,
        updated_by_name=current_user.name,
    )
    db.add(school)
    await db.commit()
    await db.refresh(school)
    logger.info("AUDIT: admin=%s created school=%s (%s)", current_user.user_id, school.id, school.name)
    return {"id": str(school.id), "status": "ok"}


@router.get("/schools/{school_id}")
async def get_school(
    school_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")

    # Teachers at this school
    teachers = (await db.execute(
        select(User.id, User.name, User.email, User.created_at)
        .where(User.school_id == school.id, User.role == "teacher")
        .order_by(User.name)
    )).all()

    # Pending invites
    invites = (await db.execute(
        select(TeacherInvite)
        .where(TeacherInvite.school_id == school.id, TeacherInvite.status == "pending")
        .order_by(TeacherInvite.created_at.desc())
    )).scalars().all()

    return {
        "id": str(school.id),
        "name": school.name,
        "city": school.city,
        "state": school.state,
        "contact_name": school.contact_name,
        "contact_email": school.contact_email,
        "is_active": school.is_active,
        "notes": school.notes,
        "created_at": school.created_at.isoformat(),
        "teachers": [
            {"id": str(t.id), "name": t.name, "email": t.email, "joined_at": t.created_at.isoformat()}
            for t in teachers
        ],
        "pending_invites": [
            {
                "id": str(i.id),
                "email": i.email,
                "expires_at": i.expires_at.isoformat(),
                "created_at": i.created_at.isoformat(),
            }
            for i in invites
        ],
    }


@router.patch("/schools/{school_id}")
async def update_school(
    school_id: str,
    body: UpdateSchoolRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(school, field, value)
    school.updated_by_id = current_user.user_id
    school.updated_by_name = current_user.name
    await db.commit()
    logger.info("AUDIT: admin=%s updated school=%s", current_user.user_id, school_id)
    return {"status": "ok"}


@router.delete("/schools/{school_id}")
async def delete_school(
    school_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")

    school_name = school.name

    # Count affected records for the response
    teacher_count = (await db.execute(
        select(func.count()).select_from(User).where(User.school_id == school.id, User.role == "teacher")
    )).scalar() or 0
    invite_count = (await db.execute(
        select(func.count()).select_from(TeacherInvite).where(
            TeacherInvite.school_id == school.id, TeacherInvite.status == "pending"
        )
    )).scalar() or 0

    await db.delete(school)
    await db.commit()

    logger.info(
        "AUDIT: admin=%s deleted school=%s (%s), teachers_unlinked=%d, invites_deleted=%d",
        current_user.user_id, school_id, school_name, teacher_count, invite_count,
    )
    return {
        "status": "ok",
        "teachers_unlinked": teacher_count,
        "invites_deleted": invite_count,
    }


# ── Teacher Invites ──────────────────────────────────────────────────────────


@router.post("/schools/{school_id}/invite")
async def invite_teacher(
    school_id: str,
    body: InviteTeacherRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    school = (await db.execute(select(School).where(School.id == school_id))).scalar_one_or_none()
    if not school:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="School not found")
    if not school.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="School is deactivated")

    # Check if email already has a pending invite for this school
    existing = (await db.execute(
        select(TeacherInvite).where(
            TeacherInvite.school_id == school.id,
            TeacherInvite.email == body.email.lower(),
            TeacherInvite.status == "pending",
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending invite already exists for this email")

    # Check if a user with this email is already a teacher at this school
    existing_teacher = (await db.execute(
        select(User).where(User.email == body.email.lower(), User.school_id == school.id, User.role == "teacher")
    )).scalar_one_or_none()
    if existing_teacher:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a teacher at this school")

    token = secrets.token_urlsafe(32)
    invite = TeacherInvite(
        school_id=school.id,
        email=body.email.lower(),
        invited_by=current_user.user_id,
        token=token,
        expires_at=datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS),
    )
    db.add(invite)
    await db.commit()

    invite_url = f"{settings.frontend_url}/register?invite={token}"
    logger.info(
        "AUDIT: admin=%s invited teacher email=%s to school=%s (%s), invite_id=%s",
        current_user.user_id, body.email, school_id, school.name, invite.id,
    )

    # Fire-and-forget invite email to teacher
    asyncio.create_task(send_email(
        to=[body.email.lower()],
        subject=f"You've been invited to join {school.name} on Veradic AI",
        html=(
            f"<h2>You're invited!</h2>"
            f"<p><strong>{school.name}</strong> has invited you to join Veradic AI as a teacher.</p>"
            f"<p>Click the link below to create your account:</p>"
            f'<p><a href="{invite_url}" style="display:inline-block;padding:12px 24px;'
            f'background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;'
            f'font-weight:600;">Accept Invite</a></p>'
            f"<p style=\"color:#64748b;font-size:13px;\">This invite expires in {INVITE_EXPIRY_DAYS} days.</p>"
        ),
    ))

    return {"status": "ok", "invite_url": invite_url}


@router.delete("/schools/{school_id}/invites/{invite_id}")
async def cancel_invite(
    school_id: str,
    invite_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    invite = (await db.execute(
        select(TeacherInvite).where(TeacherInvite.id == invite_id, TeacherInvite.school_id == school_id)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    invite.status = "expired"
    await db.commit()
    logger.info("AUDIT: admin=%s cancelled invite=%s", current_user.user_id, invite_id)
    return {"status": "ok"}
