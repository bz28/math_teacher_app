"""Teacher section management — CRUD, roster, join codes, invites."""

import asyncio
import html
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user, require_teacher
from api.models.course import Course
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.section_invite import SectionInvite
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course

logger = logging.getLogger(__name__)

router = APIRouter()

JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6
JOIN_CODE_EXPIRY_DAYS = 7
INVITE_EXPIRY_DAYS = 14


class CreateSectionRequest(BaseModel):
    name: str


class InviteStudentRequest(BaseModel):
    email: EmailStr


class JoinSectionRequest(BaseModel):
    join_code: str


async def _generate_unique_join_code(db: AsyncSession) -> str:
    for _ in range(5):
        code = "".join(secrets.choice(JOIN_CODE_CHARS) for _ in range(JOIN_CODE_LENGTH))
        if not (await db.execute(select(Section.id).where(Section.join_code == code))).scalar_one_or_none():
            return code
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate unique code")


# --- Section CRUD ---


@router.post("/courses/{course_id}/sections", status_code=status.HTTP_201_CREATED)
async def create_section(
    course_id: uuid.UUID, body: CreateSectionRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = Section(
        course_id=course_id,
        name=body.name.strip(),
        join_code=await _generate_unique_join_code(db),
        join_code_expires_at=datetime.now(UTC) + timedelta(days=JOIN_CODE_EXPIRY_DAYS),
    )
    db.add(section)
    await db.commit()
    await db.refresh(section)
    return {"id": str(section.id), "name": section.name, "join_code": section.join_code}


@router.get("/courses/{course_id}/sections")
async def list_sections(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    # Exclude preview (shadow) students so the count reflects real enrollment.
    enrollment_count = (
        select(SectionEnrollment.section_id, func.count().label("c"))
        .join(User, User.id == SectionEnrollment.student_id)
        .where(User.is_preview.is_(False))
        .group_by(SectionEnrollment.section_id).subquery()
    )
    rows = (await db.execute(
        select(Section, func.coalesce(enrollment_count.c.c, 0).label("student_count"))
        .outerjoin(enrollment_count, enrollment_count.c.section_id == Section.id)
        .where(Section.course_id == course_id)
        .order_by(Section.created_at)
    )).all()
    return {"sections": [{
        "id": str(r.Section.id), "name": r.Section.name,
        "student_count": r.student_count,
        "join_code": r.Section.join_code,
        "join_code_expires_at": r.Section.join_code_expires_at.isoformat() if r.Section.join_code_expires_at else None,
    } for r in rows]}


@router.get("/courses/{course_id}/sections/{section_id}")
async def get_section(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section(db, section_id, course_id)
    students = (await db.execute(
        select(User.id, User.name, User.email)
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .where(SectionEnrollment.section_id == section_id, User.is_preview.is_(False))
        .order_by(User.name)
    )).all()
    invites = (await db.execute(
        select(SectionInvite)
        .where(SectionInvite.section_id == section_id, SectionInvite.status == "pending")
        .order_by(SectionInvite.created_at.desc())
    )).scalars().all()
    return {
        "id": str(section.id), "name": section.name,
        "join_code": section.join_code,
        "join_code_expires_at": section.join_code_expires_at.isoformat() if section.join_code_expires_at else None,
        "students": [{"id": str(s.id), "name": s.name, "email": s.email} for s in students],
        "pending_invites": [_serialize_invite(i) for i in invites],
    }


@router.delete("/courses/{course_id}/sections/{section_id}")
async def delete_section(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section(db, section_id, course_id)
    await db.delete(section)
    await db.commit()
    return {"status": "ok"}


# --- Roster (invite + remove) ---


@router.post("/courses/{course_id}/sections/{section_id}/invites")
async def invite_student(
    course_id: uuid.UUID, section_id: uuid.UUID, body: InviteStudentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Invite a student to a section by email.

    If a user with that email already exists, enroll them immediately (no
    email sent). Otherwise create (or refresh) a pending invite and send
    an email with a claim link. Resending an already-pending invite is
    idempotent: we refresh the token + expiry and send a fresh email.
    """
    course = await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section(db, section_id, course_id)
    email = body.email.lower()

    existing_user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing_user is not None:
        already_enrolled = (await db.execute(
            select(SectionEnrollment).where(
                SectionEnrollment.section_id == section_id,
                SectionEnrollment.student_id == existing_user.id,
            )
        )).scalar_one_or_none()
        if already_enrolled:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Student already in section")
        # Block if the student is in a different section of this same course.
        other_section = (await db.execute(
            select(Section.name)
            .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
            .where(
                SectionEnrollment.student_id == existing_user.id,
                SectionEnrollment.course_id == course_id,
            )
        )).scalar_one_or_none()
        if other_section:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Student is already enrolled in {other_section} for this class.",
            )
        db.add(SectionEnrollment(
            section_id=section_id,
            course_id=course_id,
            student_id=existing_user.id,
        ))
        _stamp_school_id(existing_user, course)
        try:
            await db.commit()
        except IntegrityError:
            # Raced with another invite — the uq_section_student constraint
            # caught a duplicate. Treat as success: the student is in the
            # section, which is all the caller needed.
            await db.rollback()
        logger.info(
            "AUDIT: teacher=%s enrolled existing user=%s into section=%s",
            current_user.user_id, existing_user.id, section_id,
        )
        return {"status": "enrolled", "student_id": str(existing_user.id)}

    try:
        invite = await _create_or_refresh_invite(db, section_id, email, current_user.user_id)
        await db.commit()
    except IntegrityError:
        # Raced with another invite. The partial unique index on
        # (section_id, email) WHERE status='pending' ensures exactly
        # one pending row wins; re-read it and continue as if we were
        # the refresher.
        await db.rollback()
        invite = (await db.execute(
            select(SectionInvite).where(
                SectionInvite.section_id == section_id,
                SectionInvite.email == email,
                SectionInvite.status == "pending",
            )
        )).scalar_one()
    await db.refresh(invite)

    _send_invite_email(
        email=email,
        token=invite.token,
        section_name=section.name,
        course_name=course.name,
        teacher_name=current_user.name,
    )
    logger.info(
        "AUDIT: teacher=%s invited email=%s to section=%s, invite=%s",
        current_user.user_id, email, section_id, invite.id,
    )
    return {
        "status": "invited",
        "invite": _serialize_invite(invite),
    }


@router.get("/courses/{course_id}/sections/{section_id}/invites")
async def list_invites(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    await _get_section(db, section_id, course_id)
    invites = (await db.execute(
        select(SectionInvite)
        .where(SectionInvite.section_id == section_id, SectionInvite.status == "pending")
        .order_by(SectionInvite.created_at.desc())
    )).scalars().all()
    return {"invites": [_serialize_invite(i) for i in invites]}


@router.delete("/courses/{course_id}/sections/{section_id}/invites/{invite_id}")
async def revoke_invite(
    course_id: uuid.UUID, section_id: uuid.UUID, invite_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    await _get_section(db, section_id, course_id)
    invite = (await db.execute(
        select(SectionInvite).where(
            SectionInvite.id == invite_id, SectionInvite.section_id == section_id)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Invite is {invite.status}")
    invite.status = "revoked"
    await db.commit()
    logger.info("AUDIT: teacher=%s revoked invite=%s", current_user.user_id, invite_id)
    return {"status": "ok"}


@router.post("/courses/{course_id}/sections/{section_id}/invites/{invite_id}/resend")
async def resend_invite(
    course_id: uuid.UUID, section_id: uuid.UUID, invite_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section(db, section_id, course_id)
    invite = (await db.execute(
        select(SectionInvite).where(
            SectionInvite.id == invite_id, SectionInvite.section_id == section_id)
    )).scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Invite is {invite.status}")
    invite.token = secrets.token_urlsafe(32)
    invite.expires_at = datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS)
    await db.commit()
    await db.refresh(invite)

    _send_invite_email(
        email=invite.email,
        token=invite.token,
        section_name=section.name,
        course_name=course.name,
        teacher_name=current_user.name,
    )
    logger.info("AUDIT: teacher=%s resent invite=%s", current_user.user_id, invite_id)
    return {"status": "ok", "invite": _serialize_invite(invite)}


@router.delete("/courses/{course_id}/sections/{section_id}/students/{student_id}")
async def remove_student(
    course_id: uuid.UUID, section_id: uuid.UUID, student_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    # IDOR guard: confirm the section actually belongs to the course in
    # the URL — without this, a teacher of course A could remove students
    # from course B by guessing section_ids since the DELETE filter only
    # used section_id + student_id.
    section = (await db.execute(
        select(Section).where(Section.id == section_id, Section.course_id == course_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found in this course")
    result = await db.execute(
        delete(SectionEnrollment).where(
            SectionEnrollment.section_id == section_id, SectionEnrollment.student_id == student_id)
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not in section")
    await db.commit()
    return {"status": "ok"}


# --- Join codes ---


@router.post("/courses/{course_id}/sections/{section_id}/join-code")
async def generate_join_code(
    course_id: uuid.UUID, section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    section = await _get_section(db, section_id, course_id)
    section.join_code = await _generate_unique_join_code(db)
    section.join_code_expires_at = datetime.now(UTC) + timedelta(days=JOIN_CODE_EXPIRY_DAYS)
    await db.commit()
    return {"join_code": section.join_code, "expires_at": section.join_code_expires_at.isoformat()}


@router.post("/join")
async def join_section(
    body: JoinSectionRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Any authenticated user can join a section by code."""
    code = body.join_code.strip().upper()
    section = (await db.execute(select(Section).where(Section.join_code == code))).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid join code")
    if section.join_code_expires_at and section.join_code_expires_at < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Join code expired")
    existing = (await db.execute(
        select(SectionEnrollment).where(
            SectionEnrollment.section_id == section.id, SectionEnrollment.student_id == current_user.user_id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already in this section")
    # One enrollment per (student, course) — a student who's already in
    # another section of this course can't join a second one. Gives a
    # cleaner error than hitting the DB unique constraint.
    other_section = (await db.execute(
        select(Section.name)
        .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
        .where(
            SectionEnrollment.student_id == current_user.user_id,
            SectionEnrollment.course_id == section.course_id,
        )
    )).scalar_one_or_none()
    if other_section:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You're already enrolled in {other_section} for this class.",
        )
    db.add(SectionEnrollment(
        section_id=section.id,
        course_id=section.course_id,
        student_id=current_user.user_id,
    ))

    # Stamp school_id on the joining user (if not already set) so the
    # frontend role gate routes them to /school/student. Never overwrite
    # an existing school_id — that would silently move them between schools.
    user = (await db.execute(
        select(User).where(User.id == current_user.user_id)
    )).scalar_one_or_none()
    course = (await db.execute(
        select(Course).where(Course.id == section.course_id)
    )).scalar_one_or_none()
    if user is not None and course is not None:
        _stamp_school_id(user, course)

    await db.commit()
    return {"status": "ok", "section_id": str(section.id)}


# --- Helpers ---


async def _get_section(db: AsyncSession, section_id: uuid.UUID, course_id: uuid.UUID) -> Section:
    section = (await db.execute(
        select(Section).where(Section.id == section_id, Section.course_id == course_id)
    )).scalar_one_or_none()
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found")
    return section


async def _create_or_refresh_invite(
    db: AsyncSession, section_id: uuid.UUID, email: str, invited_by: uuid.UUID,
) -> SectionInvite:
    """Create a new pending invite or refresh an existing one (idempotent resend)."""
    existing = (await db.execute(
        select(SectionInvite).where(
            SectionInvite.section_id == section_id,
            SectionInvite.email == email,
            SectionInvite.status == "pending",
        )
    )).scalar_one_or_none()
    expires = datetime.now(UTC) + timedelta(days=INVITE_EXPIRY_DAYS)
    if existing:
        existing.token = secrets.token_urlsafe(32)
        existing.expires_at = expires
        existing.invited_by = invited_by
        return existing
    invite = SectionInvite(
        section_id=section_id,
        email=email,
        invited_by=invited_by,
        token=secrets.token_urlsafe(32),
        expires_at=expires,
    )
    db.add(invite)
    return invite


def _stamp_school_id(user: User, course: Course) -> None:
    """If the user isn't already linked to a school, link them to the course's
    school. Same semantics as join_section: never overwrite an existing school."""
    if user.school_id is None and course.school_id is not None:
        user.school_id = course.school_id


def _serialize_invite(invite: SectionInvite) -> dict[str, Any]:
    return {
        "id": str(invite.id),
        "email": invite.email,
        "status": invite.status,
        "expires_at": invite.expires_at.isoformat(),
        "created_at": invite.created_at.isoformat(),
    }


def _send_invite_email(
    *, email: str, token: str, section_name: str, course_name: str, teacher_name: str,
) -> None:
    # Escape anything teacher/course/section-controlled before dropping
    # it into an HTML string. Token is generated by secrets.token_urlsafe,
    # so it's already safe for a URL attribute.
    safe_teacher = html.escape(teacher_name, quote=True)
    safe_course = html.escape(course_name, quote=True)
    safe_section = html.escape(section_name, quote=True)
    invite_url = f"{settings.frontend_url}/invite/section?token={token}"
    body_html = (
        f"<h2>You're invited!</h2>"
        f"<p><strong>{safe_teacher}</strong> invited you to join "
        f"<strong>{safe_course}</strong> — {safe_section} on Veradic AI.</p>"
        f"<p>Click the link below to accept the invite. If you don't have "
        f"an account yet, you'll be able to create one.</p>"
        f'<p><a href="{invite_url}" style="display:inline-block;padding:12px 24px;'
        f'background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;'
        f'font-weight:600;">Accept Invite</a></p>'
        f'<p style="color:#64748b;font-size:13px;">This invite expires in {INVITE_EXPIRY_DAYS} days.</p>'
    )
    asyncio.create_task(send_email(
        to=[email],
        subject=f"You're invited to join {course_name} on Veradic AI",
        html=body_html,
    ))
