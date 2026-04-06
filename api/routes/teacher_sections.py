"""Teacher section management — CRUD, roster, join codes."""

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user, require_teacher
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()

JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6
JOIN_CODE_EXPIRY_DAYS = 7


class CreateSectionRequest(BaseModel):
    name: str


class AddStudentRequest(BaseModel):
    email: str


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
    enrollment_count = (
        select(SectionEnrollment.section_id, func.count().label("c"))
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
        .where(SectionEnrollment.section_id == section_id)
        .order_by(User.name)
    )).all()
    return {
        "id": str(section.id), "name": section.name,
        "join_code": section.join_code,
        "join_code_expires_at": section.join_code_expires_at.isoformat() if section.join_code_expires_at else None,
        "students": [{"id": str(s.id), "name": s.name, "email": s.email} for s in students],
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


# --- Roster ---


@router.post("/courses/{course_id}/sections/{section_id}/students")
async def add_student(
    course_id: uuid.UUID, section_id: uuid.UUID, body: AddStudentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
    await _get_section(db, section_id, course_id)
    student = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No user found with that email")
    existing = (await db.execute(
        select(SectionEnrollment).where(
            SectionEnrollment.section_id == section_id, SectionEnrollment.student_id == student.id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Student already in section")
    db.add(SectionEnrollment(section_id=section_id, student_id=student.id))
    await db.commit()
    return {"status": "ok", "student_id": str(student.id)}


@router.delete("/courses/{course_id}/sections/{section_id}/students/{student_id}")
async def remove_student(
    course_id: uuid.UUID, section_id: uuid.UUID, student_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await get_teacher_course(db, course_id, current_user.user_id)
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
    db.add(SectionEnrollment(section_id=section.id, student_id=current_user.user_id))
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
