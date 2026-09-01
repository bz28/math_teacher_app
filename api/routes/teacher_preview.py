"""Teacher preview-as-student endpoint.

Creates (or reuses) a shadow student account for the calling teacher,
syncs section enrollments, and returns a JWT pair so the frontend can
swap into the student experience.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import CourseTeacher
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User

router = APIRouter()


class PreviewStudentRequest(BaseModel):
    """Which homework the teacher is about to open, when they came from
    an assignment's Preview button. We point the shadow at a section
    that assignment was actually pushed to — a homework assigned to
    only *some* sections is invisible from the arbitrary section we'd
    otherwise pick. Omitted by the sidebar's preview entry point, which
    isn't previewing anything in particular."""

    assignment_id: uuid.UUID | None = None


class PreviewTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@router.post("/preview-student")
async def get_or_create_preview_student(
    body: PreviewStudentRequest | None = None,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> PreviewTokenResponse:
    """Find or create a shadow student for this teacher, sync
    enrollments, and return a JWT pair for the shadow account."""

    teacher = (await db.execute(
        select(User).where(User.id == current_user.user_id)
    )).scalar_one_or_none()
    if teacher is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")

    # Find existing shadow student
    shadow = (await db.execute(
        select(User).where(
            User.preview_owner_id == current_user.user_id,
            User.is_preview.is_(True),
        )
    )).scalar_one_or_none()

    if shadow is None:
        # Create the shadow student
        short_id = current_user.user_id.hex[:8]
        shadow = User(
            email=f"preview+{short_id}@veradic.ai",
            name=f"{teacher.name or teacher.email} (Preview)",
            password_hash=hash_password(uuid.uuid4().hex),
            grade_level=teacher.grade_level,
            role="student",
            school_id=teacher.school_id,
            is_preview=True,
            preview_owner_id=current_user.user_id,
        )
        db.add(shadow)
        await db.flush()

    # Sync enrollments: enroll shadow in all sections the teacher owns.
    # First, find all sections under the teacher's courses.
    teacher_course_ids = (await db.execute(
        select(CourseTeacher.course_id).where(
            CourseTeacher.teacher_id == current_user.user_id,
        )
    )).scalars().all()

    if teacher_course_ids:
        # One enrollment per (student, course). A shadow with no seat in
        # a course gets the earliest-created section; one that already
        # has a seat keeps it unless the homework being previewed says
        # otherwise. A teacher with several sections of one course sees
        # it from a single seat — there's no switcher yet.
        picked: dict[uuid.UUID, uuid.UUID] = {
            course_id: section_id
            for section_id, course_id in (await db.execute(
                select(Section.id, Section.course_id)
                .where(Section.course_id.in_(teacher_course_ids))
                .order_by(Section.course_id, Section.created_at, Section.id)
                .distinct(Section.course_id)
            )).all()
        }

        # Previewing a specific homework overrides that course's pick
        # with a section the homework was actually assigned to — and is
        # the ONLY thing that justifies moving a seat the shadow already
        # has. Without that scoping, the sidebar's preview entry point
        # — which names no homework — would silently yank her back to the
        # default section every time, undoing the seat a homework
        # preview just put her in.
        movable_course_id: uuid.UUID | None = None
        targeted: set[uuid.UUID] = set()
        if body is not None and body.assignment_id is not None:
            targets = (await db.execute(
                select(Section.id, Section.course_id)
                .join(AssignmentSection, AssignmentSection.section_id == Section.id)
                .join(Assignment, Assignment.id == AssignmentSection.assignment_id)
                .where(
                    Assignment.id == body.assignment_id,
                    Assignment.course_id.in_(teacher_course_ids),
                    # Belt and braces: assignment_sections is written
                    # only with same-course sections, but the shadow's
                    # seat is derived from this row, so don't let a bad
                    # join row seat it outside the teacher's courses.
                    Section.course_id == Assignment.course_id,
                )
                .order_by(Section.created_at, Section.id)
            )).all()
            if targets:
                picked[targets[0].course_id] = targets[0].id
                movable_course_id = targets[0].course_id
                targeted = {section_id for section_id, _ in targets}

        existing = {
            e.course_id: e
            for e in (await db.execute(
                select(SectionEnrollment).where(
                    SectionEnrollment.student_id == shadow.id,
                )
            )).scalars().all()
        }

        for course_id, section_id in picked.items():
            row = existing.get(course_id)
            if row is None:
                db.add(SectionEnrollment(
                    student_id=shadow.id,
                    section_id=section_id,
                    course_id=course_id,
                ))
            elif course_id == movable_course_id and row.section_id not in targeted:
                # One enrollment per (student, course) is a DB
                # constraint, so landing the shadow somewhere else means
                # moving this row, not adding a second one. Only move it
                # when the seat it already has isn't one the homework
                # was pushed to — a shadow sitting in a targeted section
                # can already see it, and churning the row would orphan
                # its earlier work into a section it no longer occupies.
                row.section_id = section_id

    await db.commit()

    # Issue tokens for the shadow student
    access_token = create_access_token(str(shadow.id), "student")
    refresh_token = await create_refresh_token(db, shadow.id)

    return PreviewTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )
