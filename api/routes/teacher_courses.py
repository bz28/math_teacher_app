"""Teacher course management — CRUD."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import Integer, and_, case, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher, Document
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User

router = APIRouter()


_VALID_SUBJECTS = {"math", "physics", "chemistry"}
_VALID_COURSE_STATUSES = {"active", "archived"}


def _validate_course_name(v: str) -> str:
    v = v.strip()
    if not v or len(v) > 200:
        raise ValueError("Name must be 1-200 characters")
    return v


def _validate_subject(v: str) -> str:
    if v not in _VALID_SUBJECTS:
        raise ValueError(f"Subject must be one of: {', '.join(sorted(_VALID_SUBJECTS))}")
    return v


def _validate_grade(v: int) -> int:
    if not 1 <= v <= 12:
        raise ValueError("Grade level must be between 1 and 12")
    return v


def _validate_status(v: str) -> str:
    if v not in _VALID_COURSE_STATUSES:
        raise ValueError(f"Status must be one of: {', '.join(sorted(_VALID_COURSE_STATUSES))}")
    return v


CourseName = Annotated[str, AfterValidator(_validate_course_name)]
CourseSubject = Annotated[str, AfterValidator(_validate_subject)]
CourseGrade = Annotated[int, AfterValidator(_validate_grade)]
CourseStatus = Annotated[str, AfterValidator(_validate_status)]


class CreateCourseRequest(BaseModel):
    name: CourseName
    subject: CourseSubject = "math"
    grade_level: CourseGrade | None = None
    description: str | None = Field(default=None, max_length=2000)


class UpdateCourseRequest(BaseModel):
    name: CourseName | None = None
    subject: CourseSubject | None = None
    grade_level: CourseGrade | None = None
    description: str | None = Field(default=None, max_length=2000)
    status: CourseStatus | None = None


async def get_teacher_course(db: AsyncSession, course_id: uuid.UUID, teacher_id: uuid.UUID) -> Course:
    """Fetch a course only if the teacher is on it. Returns 404 for both
    not-found and not-yours — deliberately doesn't distinguish, so we
    don't leak the existence of other teachers' courses."""
    course = (await db.execute(
        select(Course)
        .join(CourseTeacher, CourseTeacher.course_id == Course.id)
        .where(Course.id == course_id, CourseTeacher.teacher_id == teacher_id)
    )).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


# ─── Attention aggregates ─────────────────────────────────────────────
#
# to_review / flagged / next_due_at are surfaced on both the courses
# list (Monday-morning dashboard) and the per-course detail (course
# header). The math must mirror the Submissions inbox at
# teacher_assignments.py:968 so what teachers see on the dashboard
# always matches what they'd see clicking into the Submissions tab.
# Defining the case-builders once keeps the two endpoints in lockstep
# if the inbox semantics ever evolve.


def _to_review_case() -> Any:
    """Counts every submission that isn't published-and-clean —
    ungraded, graded-but-unpublished, or published-but-dirty (any of
    score / notes / breakdown drifted from the published snapshot)."""
    return case(
        # Ungraded (no SubmissionGrade row → NULL) AND
        # graded-but-not-published (final_score set, grade_published_at NULL).
        (SubmissionGrade.grade_published_at.is_(None), 1),
        # Published but the live draft differs from the published
        # snapshot — content-based so flipping back to the original
        # value doesn't wrongly mark it dirty.
        (
            and_(
                SubmissionGrade.grade_published_at.is_not(None),
                or_(
                    SubmissionGrade.final_score.is_distinct_from(
                        SubmissionGrade.published_final_score,
                    ),
                    SubmissionGrade.teacher_notes.is_distinct_from(
                        SubmissionGrade.published_teacher_notes,
                    ),
                    SubmissionGrade.breakdown.cast(JSONB).is_distinct_from(
                        SubmissionGrade.published_breakdown.cast(JSONB),
                    ),
                ),
            ),
            1,
        ),
        else_=0,
    )


def _flagged_case() -> Any:
    """Counts submissions needing teacher attention from the integrity
    pipeline — flagged disposition, unreadable extraction, inconclusive
    complete (turn cap / no sampled problems), or student-raised
    'reader got something wrong' before confirm."""
    return case(
        (IntegrityCheckSubmission.disposition == "flag_for_review", 1),
        (IntegrityCheckSubmission.status == "skipped_unreadable", 1),
        (
            and_(
                IntegrityCheckSubmission.status == "complete",
                IntegrityCheckSubmission.disposition.is_(None),
            ),
            1,
        ),
        (Submission.extraction_flagged_at.is_not(None), 1),
        else_=0,
    )


async def _course_attention(
    db: AsyncSession, teacher_id: uuid.UUID, course_id: uuid.UUID,
) -> dict[str, Any]:
    """Compute the (to_review, flagged, next_due_at) trio for a single
    course. Same predicates as the courses list aggregate, narrowed to
    one course so the course-detail endpoint can render header pills
    without a second round-trip through the inbox."""
    counts_row = (await db.execute(
        select(
            func.coalesce(func.sum(_to_review_case()).cast(Integer), 0).label("to_review"),
            func.coalesce(func.sum(_flagged_case()).cast(Integer), 0).label("flagged"),
        )
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(User, User.id == Submission.student_id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.student_id == Submission.student_id,
                SectionEnrollment.section_id == Submission.section_id,
            ),
        )
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .outerjoin(
            IntegrityCheckSubmission,
            IntegrityCheckSubmission.submission_id == Submission.id,
        )
        .where(
            Assignment.course_id == course_id,
            Assignment.teacher_id == teacher_id,
            Assignment.type == "homework",
            Assignment.status == "published",
            User.is_preview.is_(False),
        )
    )).one()

    next_due_at = (await db.execute(
        select(func.min(Assignment.due_at))
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .where(
            Assignment.course_id == course_id,
            Assignment.teacher_id == teacher_id,
            Assignment.type == "homework",
            Assignment.status == "published",
            Assignment.due_at >= func.now(),
        )
    )).scalar_one_or_none()

    return {
        "to_review": counts_row.to_review,
        "flagged": counts_row.flagged,
        "next_due_at": next_due_at.isoformat() if next_due_at else None,
    }


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
    section_counts = (
        select(Section.course_id, func.count().label("count"))
        .group_by(Section.course_id).subquery()
    )
    doc_counts = (
        select(Document.course_id, func.count().label("count"))
        .group_by(Document.course_id).subquery()
    )
    unit_counts = (
        select(Unit.course_id, func.count().label("count"))
        .group_by(Unit.course_id).subquery()
    )

    # Per-course attention aggregates. SectionEnrollment guard mirrors
    # the inbox query: if a student was unenrolled after submitting,
    # drop their submission from course-level counts so the dashboard
    # never shows phantom work.
    attention_counts = (
        select(
            Assignment.course_id.label("course_id"),
            func.coalesce(func.sum(_to_review_case()).cast(Integer), 0).label("to_review"),
            func.coalesce(func.sum(_flagged_case()).cast(Integer), 0).label("flagged"),
        )
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(User, User.id == Submission.student_id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.student_id == Submission.student_id,
                SectionEnrollment.section_id == Submission.section_id,
            ),
        )
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .outerjoin(
            IntegrityCheckSubmission,
            IntegrityCheckSubmission.submission_id == Submission.id,
        )
        .where(
            Assignment.teacher_id == current_user.user_id,
            Assignment.type == "homework",
            Assignment.status == "published",
            User.is_preview.is_(False),
        )
        .group_by(Assignment.course_id)
        .subquery()
    )

    # Next upcoming due date among published HWs. Past-due is
    # captured implicitly via to_review — surfacing overdue dates
    # here would compete with that signal. AssignmentSection join
    # mirrors the inbox at teacher_assignments.py:1000 — a published
    # HW with no section assigned has no audience, so its due date
    # shouldn't surface on the dashboard.
    next_due_counts = (
        select(
            Assignment.course_id.label("course_id"),
            func.min(Assignment.due_at).label("next_due_at"),
        )
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .where(
            Assignment.teacher_id == current_user.user_id,
            Assignment.type == "homework",
            Assignment.status == "published",
            Assignment.due_at >= func.now(),
        )
        .group_by(Assignment.course_id)
        .subquery()
    )

    rows = (await db.execute(
        select(
            Course,
            func.coalesce(section_counts.c.count, 0).label("section_count"),
            func.coalesce(doc_counts.c.count, 0).label("doc_count"),
            func.coalesce(unit_counts.c.count, 0).label("unit_count"),
            func.coalesce(attention_counts.c.to_review, 0).label("to_review"),
            func.coalesce(attention_counts.c.flagged, 0).label("flagged"),
            next_due_counts.c.next_due_at,
        )
        .outerjoin(section_counts, section_counts.c.course_id == Course.id)
        .outerjoin(doc_counts, doc_counts.c.course_id == Course.id)
        .outerjoin(unit_counts, unit_counts.c.course_id == Course.id)
        .outerjoin(attention_counts, attention_counts.c.course_id == Course.id)
        .outerjoin(next_due_counts, next_due_counts.c.course_id == Course.id)
        .join(CourseTeacher, CourseTeacher.course_id == Course.id)
        .where(CourseTeacher.teacher_id == current_user.user_id)
        .order_by(Course.created_at.desc())
    )).all()

    return {"courses": [{
        "id": str(r.Course.id), "name": r.Course.name, "subject": r.Course.subject,
        "grade_level": r.Course.grade_level, "status": r.Course.status,
        "section_count": r.section_count, "doc_count": r.doc_count,
        "unit_count": r.unit_count,
        "to_review": r.to_review,
        "flagged": r.flagged,
        "next_due_at": r.next_due_at.isoformat() if r.next_due_at else None,
        "created_at": r.Course.created_at.isoformat(),
    } for r in rows]}


@router.get("/courses/{course_id}")
async def get_course(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    attention = await _course_attention(db, current_user.user_id, course_id)
    return {
        "id": str(course.id), "name": course.name, "subject": course.subject,
        "grade_level": course.grade_level, "description": course.description,
        "status": course.status, "created_at": course.created_at.isoformat(),
        "to_review": attention["to_review"],
        "flagged": attention["flagged"],
        "next_due_at": attention["next_due_at"],
    }


@router.patch("/courses/{course_id}")
async def update_course(
    course_id: uuid.UUID, body: UpdateCourseRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    if not body.model_fields_set:
        return {"status": "ok"}
    if body.name is not None:
        course.name = body.name
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
    await db.commit()
    return {"status": "ok"}
