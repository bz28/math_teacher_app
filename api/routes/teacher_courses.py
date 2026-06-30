"""Teacher course management — CRUD."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import Integer, and_, case, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.integrity_pipeline import ABANDONED_INTERVIEW_DEADLINE
from api.core.subjects import VALID_SUBJECTS
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


_VALID_COURSE_STATUSES = {"active", "archived"}


def _validate_course_name(v: str) -> str:
    v = v.strip()
    if not v or len(v) > 200:
        raise ValueError("Name must be 1-200 characters")
    return v


def _validate_subject(v: str) -> str:
    if v not in VALID_SUBJECTS:
        raise ValueError(f"Subject must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
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


def _dirty_case() -> Any:
    """The published-but-edited-since portion of _to_review_case —
    a grade the student can see, but the teacher has changed the draft
    of (score / notes / breakdown) without republishing. Content-based
    so reverting to the original value clears it."""
    return case(
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
    complete (turn cap / no sampled problems), an abandoned interview
    stalled past the wall-clock deadline, or student-raised 'reader got
    something wrong' before confirm.

    Each integrity-check-based branch also requires the check to be
    unresolved: once a teacher marks it reviewed, it's handled and no
    longer counts. The extraction_flagged branch has no integrity-check
    row to resolve, so it stays until the submission is graded."""
    integrity_unresolved = (
        IntegrityCheckSubmission.resolution == "unresolved"
    )
    abandoned_cutoff = datetime.now(UTC) - ABANDONED_INTERVIEW_DEADLINE
    return case(
        (
            and_(
                IntegrityCheckSubmission.disposition == "flag_for_review",
                integrity_unresolved,
            ),
            1,
        ),
        (
            and_(
                IntegrityCheckSubmission.status == "skipped_unreadable",
                integrity_unresolved,
            ),
            1,
        ),
        (
            and_(
                IntegrityCheckSubmission.status == "complete",
                IntegrityCheckSubmission.disposition.is_(None),
                integrity_unresolved,
            ),
            1,
        ),
        # Abandoned interview: still in awaiting_student / in_progress past
        # the deadline. Not yet finalized (a teacher opening the roster
        # does that lazily), but counted here so the needs-attention badge
        # nudges them to look in the first place.
        (
            and_(
                IntegrityCheckSubmission.status.in_(
                    ("awaiting_student", "in_progress"),
                ),
                IntegrityCheckSubmission.updated_at < abandoned_cutoff,
                integrity_unresolved,
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


# Priority order for the "Needs you today" triage queue. Lower = more
# urgent. Flagged (integrity) jumps the line, then ungraded work past
# its due date, then ungraded work, then grades the teacher edited but
# hasn't republished. Mirrors the dashboard pill vocabulary.
_TRIAGE_PRIORITY = {"flagged": 0, "overdue": 1, "ungraded": 2, "dirty": 3}


@router.get("/needs-attention")
async def needs_attention(
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Cross-course triage queue — every submission that needs the
    teacher right now, one row per submission, prioritized.

    Reuses the exact predicates the courses dashboard and Submissions
    inbox use (_to_review_case / _flagged_case), so the queue can never
    disagree with the per-course pills. Owner-gated: only submissions on
    published homework the teacher owns, non-preview students, dropped
    after un-enrollment via the SectionEnrollment guard.

    No grades, answers, or scores leak — each row is pure routing
    metadata: who, which HW/section/course, when it was due, and why it
    needs the teacher (`reason`). The frontend deep-links each row into
    the review surface for that exact (HW × section), focusing the
    student via a query param.
    """
    flagged_case = _flagged_case()
    dirty_case = _dirty_case()
    # Overdue is decided in SQL so timezone handling stays in the DB.
    overdue_case = case(
        (and_(Assignment.due_at.is_not(None), Assignment.due_at < func.now()), True),
        else_=False,
    )

    rows = (await db.execute(
        select(
            Submission.id.label("submission_id"),
            Submission.student_id.label("student_id"),
            User.name.label("student_name"),
            User.email.label("student_email"),
            Course.id.label("course_id"),
            Course.name.label("course_name"),
            Course.subject.label("subject"),
            Assignment.id.label("assignment_id"),
            Assignment.title.label("assignment_title"),
            Assignment.due_at.label("due_at"),
            Section.id.label("section_id"),
            Section.name.label("section_name"),
            flagged_case.label("flagged"),
            dirty_case.label("dirty"),
            SubmissionGrade.grade_published_at.label("grade_published_at"),
            overdue_case.label("is_overdue"),
        )
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .join(Section, Section.id == Submission.section_id)
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
            or_(flagged_case == 1, _to_review_case() == 1),
        )
    )).all()

    items: list[dict[str, Any]] = []
    for r in rows:
        # First matching bucket wins — flagged integrity always trumps
        # grading state. `reason` is the single chip the row shows.
        if r.flagged:
            reason = "flagged"
        elif r.grade_published_at is None:
            reason = "overdue" if r.is_overdue else "ungraded"
        elif r.dirty:
            reason = "dirty"
        else:
            # Belt-and-suspenders: the WHERE clause already excludes
            # clean-published rows, but never emit one if it slips through.
            continue
        items.append({
            "submission_id": str(r.submission_id),
            "student_id": str(r.student_id),
            "student_name": r.student_name or r.student_email,
            "course_id": str(r.course_id),
            "course_name": r.course_name,
            "subject": r.subject,
            "assignment_id": str(r.assignment_id),
            "assignment_title": r.assignment_title,
            "section_id": str(r.section_id),
            "section_name": r.section_name,
            "due_at": r.due_at.isoformat() if r.due_at else None,
            "reason": reason,
        })

    # Priority bucket, then most-overdue/soonest-due first (nulls last),
    # then student name for a stable, scannable order.
    items.sort(key=lambda it: (
        _TRIAGE_PRIORITY[it["reason"]],
        it["due_at"] or "9999",
        it["student_name"].lower(),
    ))
    return {"items": items, "total": len(items)}


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


@router.get("/courses/{course_id}/setup-status")
async def get_course_setup_status(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """Booleans driving the first-run "Set up your class" checklist on
    the course workspace. Each flag is an EXISTS probe — we never need
    the actual rows, just whether the teacher has crossed each milestone:

      has_section        ≥1 section in the course
      has_student        ≥1 student enrolled in any of its sections
      has_materials      ≥1 unit (course materials live under units)
      has_homework       ≥1 homework assignment
      has_published_grade ≥1 submission grade that's been published

    Ownership is enforced first via get_teacher_course (404s for
    not-yours), so the probes never leak another teacher's milestones.
    """
    await get_teacher_course(db, course_id, current_user.user_id)

    async def _exists(stmt: Any) -> bool:
        return bool((await db.execute(select(stmt.exists()))).scalar())

    has_section = await _exists(
        select(Section.id).where(Section.course_id == course_id),
    )
    has_student = await _exists(
        select(SectionEnrollment.id).where(
            SectionEnrollment.course_id == course_id,
        ),
    )
    has_materials = await _exists(
        select(Unit.id).where(Unit.course_id == course_id),
    )
    has_homework = await _exists(
        select(Assignment.id).where(
            Assignment.course_id == course_id,
            Assignment.teacher_id == current_user.user_id,
            Assignment.type == "homework",
        ),
    )
    has_published_grade = await _exists(
        select(SubmissionGrade.id)
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .where(
            Assignment.course_id == course_id,
            Assignment.teacher_id == current_user.user_id,
            SubmissionGrade.grade_published_at.is_not(None),
        ),
    )

    return {
        "has_section": has_section,
        "has_student": has_student,
        "has_materials": has_materials,
        "has_homework": has_homework,
        "has_published_grade": has_published_grade,
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
