"""Teacher course management — CRUD."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Course, CourseTeacher, Document
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User

router = APIRouter()


_VALID_SUBJECTS = {"math", "physics", "chemistry"}
_VALID_COURSE_STATUSES = {"active", "archived"}


def _validate_name(v: str) -> str:
    v = v.strip()
    if not v or len(v) > 200:
        raise ValueError("Name must be 1-200 characters")
    return v


def _validate_subject(v: str) -> str:
    if v not in _VALID_SUBJECTS:
        raise ValueError(f"Subject must be one of: {', '.join(sorted(_VALID_SUBJECTS))}")
    return v


def _validate_grade(v: int | None) -> int | None:
    if v is None:
        return v
    if not 1 <= v <= 12:
        raise ValueError("Grade level must be between 1 and 12")
    return v


def _validate_status(v: str) -> str:
    if v not in _VALID_COURSE_STATUSES:
        raise ValueError(f"Status must be one of: {', '.join(sorted(_VALID_COURSE_STATUSES))}")
    return v


class CreateCourseRequest(BaseModel):
    name: str
    subject: str = "math"
    grade_level: int | None = None
    description: str | None = None

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        return _validate_name(v)

    @field_validator("subject")
    @classmethod
    def _v_subject(cls, v: str) -> str:
        return _validate_subject(v)

    @field_validator("grade_level")
    @classmethod
    def _v_grade(cls, v: int | None) -> int | None:
        return _validate_grade(v)


class UpdateCourseRequest(BaseModel):
    name: str | None = None
    subject: str | None = None
    grade_level: int | None = None
    description: str | None = None
    status: str | None = None

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str | None) -> str | None:
        return _validate_name(v) if v is not None else v

    @field_validator("subject")
    @classmethod
    def _v_subject(cls, v: str | None) -> str | None:
        return _validate_subject(v) if v is not None else v

    @field_validator("grade_level")
    @classmethod
    def _v_grade(cls, v: int | None) -> int | None:
        return _validate_grade(v)

    @field_validator("status")
    @classmethod
    def _v_status(cls, v: str | None) -> str | None:
        return _validate_status(v) if v is not None else v


async def get_teacher_course(db: AsyncSession, course_id: uuid.UUID, teacher_id: uuid.UUID) -> Course:
    """Fetch a course and verify the teacher is on it. Reused by other teacher route modules."""
    course = (await db.execute(select(Course).where(Course.id == course_id))).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    is_teacher = (await db.execute(
        select(CourseTeacher).where(
            CourseTeacher.course_id == course_id, CourseTeacher.teacher_id == teacher_id,
        )
    )).scalar_one_or_none()
    if not is_teacher:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your course")
    return course


@router.post("/courses", status_code=status.HTTP_201_CREATED)
async def create_course(
    body: CreateCourseRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Inherit the teacher's school so the course is school-scoped from creation.
    teacher = (await db.execute(select(User).where(User.id == current_user.user_id))).scalar_one()
    course = Course(
        school_id=teacher.school_id, name=body.name,
        subject=body.subject, grade_level=body.grade_level, description=body.description,
    )
    db.add(course)
    await db.flush()
    db.add(CourseTeacher(course_id=course.id, teacher_id=current_user.user_id, role="owner"))
    await db.commit()
    await db.refresh(course)
    return {"id": str(course.id), "name": course.name, "status": course.status}


@router.get("/courses")
async def list_courses(
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    section_count = (
        select(Section.course_id, func.count().label("c"))
        .group_by(Section.course_id).subquery()
    )
    doc_count = (
        select(Document.course_id, func.count().label("c"))
        .group_by(Document.course_id).subquery()
    )
    unit_count = (
        select(Unit.course_id, func.count().label("c"))
        .group_by(Unit.course_id).subquery()
    )
    rows = (await db.execute(
        select(Course,
               func.coalesce(section_count.c.c, 0).label("section_count"),
               func.coalesce(doc_count.c.c, 0).label("doc_count"),
               func.coalesce(unit_count.c.c, 0).label("unit_count"))
        .outerjoin(section_count, section_count.c.course_id == Course.id)
        .outerjoin(doc_count, doc_count.c.course_id == Course.id)
        .outerjoin(unit_count, unit_count.c.course_id == Course.id)
        .join(CourseTeacher, CourseTeacher.course_id == Course.id)
        .where(CourseTeacher.teacher_id == current_user.user_id)
        .order_by(Course.created_at.desc())
    )).all()

    return {"courses": [{
        "id": str(r.Course.id), "name": r.Course.name, "subject": r.Course.subject,
        "grade_level": r.Course.grade_level, "status": r.Course.status,
        "section_count": r.section_count, "doc_count": r.doc_count,
        "unit_count": r.unit_count,
        "created_at": r.Course.created_at.isoformat(),
    } for r in rows]}


@router.get("/courses/{course_id}")
async def get_course(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    return {
        "id": str(course.id), "name": course.name, "subject": course.subject,
        "grade_level": course.grade_level, "description": course.description,
        "status": course.status, "created_at": course.created_at.isoformat(),
    }


@router.patch("/courses/{course_id}")
async def update_course(
    course_id: uuid.UUID, body: UpdateCourseRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    if body.name is not None:
        course.name = body.name.strip()
    if body.subject is not None:
        course.subject = body.subject
    if body.grade_level is not None:
        course.grade_level = body.grade_level
    if body.description is not None:
        course.description = body.description
    if body.status is not None:
        course.status = body.status
    await db.commit()
    return {"status": "ok"}


@router.delete("/courses/{course_id}")
async def delete_course(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    await db.delete(course)
    try:
        await db.commit()
    except IntegrityError:
        # FK CASCADE blocked — usually because of active published
        # assignments referencing locked bank items. Roll back and
        # tell the teacher what to do instead of returning a 500.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unpublish all assignments before deleting this course",
        ) from None
    return {"status": "ok"}
