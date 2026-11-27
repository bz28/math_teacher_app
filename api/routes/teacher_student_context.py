"""What a student's history shows beside their grades in one course.

  GET /courses/{course_id}/sections/{section_id}/students/{student_id}/context
      → the student's other courses with this teacher (one click to each
        history) and the understanding checks they finished in this one:
        each check's summary and where its conversation is.

Teacher-only, and never a verdict: the check's disposition, headline and
any score stay out — the summary and the conversation are the record,
and integrity raises scrutiny, never brands a student.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, Submission
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


class OtherCourse(BaseModel):
    course_id: uuid.UUID
    course_name: str
    section_id: uuid.UUID
    section_name: str


class UnderstandingCheck(BaseModel):
    assignment_id: uuid.UUID
    assignment_title: str
    # The section the work was turned in for: its review page holds the
    # conversation.
    section_id: uuid.UUID
    summary: str
    submitted_at: datetime


class StudentContext(BaseModel):
    other_courses: list[OtherCourse]
    understanding_checks: list[UnderstandingCheck]


@router.get("/courses/{course_id}/sections/{section_id}/students/{student_id}/context")
async def get_student_context(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    student_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> StudentContext:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    # The student is in this section of this course, as the grades read
    # requires — otherwise it's not this teacher's student to look up.
    enrolled = (await db.execute(
        select(SectionEnrollment.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .where(
            SectionEnrollment.student_id == student_id,
            SectionEnrollment.section_id == section_id,
            Section.course_id == course_id,
        )
    )).first()
    if enrolled is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found in this section")

    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=student_id,
        record_type="student_context",
        record_id=course_id,
        accessor_school_id=course.school_id,
        request=request,
    )

    # Courses of this teacher's (any role) the student is also in,
    # archived ones left out like the course list leaves them out.
    other_rows = (await db.execute(
        select(Course.id, Course.name, Section.id.label("section_id"),
               Section.name.label("section_name"))
        .join(Section, Section.course_id == Course.id)
        .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
        .join(CourseTeacher, CourseTeacher.course_id == Course.id)
        .where(
            SectionEnrollment.student_id == student_id,
            CourseTeacher.teacher_id == current_user.user_id,
            Course.id != course_id,
            Course.status != "archived",
        )
        .order_by(Course.name, Section.name)
    )).all()

    # Finished checks with a summary, newest work first. A check force-closed
    # without one (the student never answered) has nothing to read here.
    check_rows = (await db.execute(
        select(Assignment.id, Assignment.title, Submission.section_id,
               IntegrityCheckSubmission.overall_summary, Submission.submitted_at)
        .join(Submission, Submission.id == IntegrityCheckSubmission.submission_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .where(
            Submission.student_id == student_id,
            Assignment.course_id == course_id,
            IntegrityCheckSubmission.status == "complete",
            IntegrityCheckSubmission.overall_summary.is_not(None),
            IntegrityCheckSubmission.overall_summary != "",
        )
        .order_by(Submission.submitted_at.desc())
    )).all()

    return StudentContext(
        other_courses=[
            OtherCourse(course_id=r.id, course_name=r.name, section_id=r.section_id,
                        section_name=r.section_name)
            for r in other_rows
        ],
        understanding_checks=[
            UnderstandingCheck(assignment_id=r.id, assignment_title=r.title,
                               section_id=r.section_id, summary=r.overall_summary,
                               submitted_at=r.submitted_at)
            for r in check_rows
        ],
    )
