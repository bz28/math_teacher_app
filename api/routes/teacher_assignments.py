"""Teacher assignment management — CRUD + section assignment."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


# ── Request schemas ──

class CreateAssignmentRequest(BaseModel):
    title: str
    type: str  # homework | quiz | test
    source_type: str | None = None
    due_at: str | None = None  # ISO datetime
    late_policy: str = "none"
    content: dict[str, Any] | None = None
    answer_key: dict[str, Any] | None = None
    unit_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 300:
            raise ValueError("Title must be 1-300 characters")
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in ("homework", "quiz", "test"):
            raise ValueError("Type must be homework, quiz, or test")
        return v


class UpdateAssignmentRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    due_at: str | None = None
    late_policy: str | None = None
    content: dict[str, Any] | None = None
    answer_key: dict[str, Any] | None = None


class AssignSectionsRequest(BaseModel):
    section_ids: list[uuid.UUID]


# ── Helpers ──

async def get_teacher_assignment(db: AsyncSession, assignment_id: uuid.UUID, teacher_id: uuid.UUID) -> Assignment:
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.teacher_id != teacher_id:
        raise HTTPException(status_code=403, detail="Not your assignment")
    return assignment


async def get_assignment_stats(
    db: AsyncSession, assignment_id: uuid.UUID,
) -> dict[str, Any]:
    """Get submission/grading stats for an assignment."""
    enrolled_subq = (
        select(SectionEnrollment.student_id)
        .join(AssignmentSection, AssignmentSection.section_id == SectionEnrollment.section_id)
        .where(AssignmentSection.assignment_id == assignment_id)
        .distinct()
        .subquery()
    )
    total_q = select(func.count()).select_from(enrolled_subq)
    total = (await db.execute(total_q)).scalar() or 0

    submitted = (await db.execute(
        select(func.count()).where(Submission.assignment_id == assignment_id)
    )).scalar() or 0

    graded = (await db.execute(
        select(func.count())
        .select_from(Submission)
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(Submission.assignment_id == assignment_id, Submission.status == "teacher_reviewed")
    )).scalar() or 0

    avg_score = (await db.execute(
        select(func.avg(SubmissionGrade.final_score))
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .where(Submission.assignment_id == assignment_id, SubmissionGrade.final_score.isnot(None))
    )).scalar()

    return {
        "total_students": total,
        "submitted": submitted,
        "graded": graded,
        "avg_score": round(avg_score, 1) if avg_score is not None else None,
    }


def assignment_to_dict(a: Assignment, section_names: list[str], stats: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "course_id": str(a.course_id),
        "unit_id": str(a.unit_id) if a.unit_id else None,
        "title": a.title,
        "type": a.type,
        "source_type": a.source_type,
        "status": a.status,
        "due_at": a.due_at.isoformat() if a.due_at else None,
        "late_policy": a.late_policy,
        "document_ids": a.document_ids,
        "section_names": section_names,
        "total_students": stats["total_students"],
        "submitted": stats["submitted"],
        "graded": stats["graded"],
        "avg_score": stats["avg_score"],
        "created_at": a.created_at.isoformat(),
    }


# ── Endpoints ──

@router.post("/courses/{course_id}/assignments", status_code=status.HTTP_201_CREATED)
async def create_assignment(
    course_id: uuid.UUID, body: CreateAssignmentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    due_at = None
    if body.due_at:
        try:
            due_at = datetime.fromisoformat(body.due_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid due_at format")

    # Validate unit belongs to this course
    if body.unit_id is not None:
        from api.models.unit import Unit
        unit_check = (await db.execute(
            select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
        )).scalar_one_or_none()
        if not unit_check:
            raise HTTPException(status_code=404, detail="Unit not found in this course")

    # Validate document_ids belong to this course
    doc_id_strings: list[str] | None = None
    if body.document_ids:
        from api.models.course import Document
        found = set((await db.execute(
            select(Document.id).where(Document.id.in_(body.document_ids), Document.course_id == course_id)
        )).scalars().all())
        if len(found) != len(body.document_ids):
            missing = set(body.document_ids) - found
            raise HTTPException(status_code=404, detail=f"Documents not found in this course: {missing}")
        doc_id_strings = [str(d) for d in body.document_ids]

    assignment = Assignment(
        course_id=course_id, teacher_id=current_user.user_id,
        title=body.title, type=body.type, source_type=body.source_type,
        due_at=due_at, late_policy=body.late_policy,
        content=body.content, answer_key=body.answer_key,
        unit_id=body.unit_id, document_ids=doc_id_strings,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return {"id": str(assignment.id), "title": assignment.title, "status": assignment.status}


@router.get("/courses/{course_id}/assignments")
async def list_course_assignments(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    assignments = (await db.execute(
        select(Assignment)
        .where(Assignment.course_id == course_id)
        .order_by(Assignment.created_at.desc())
    )).scalars().all()

    results = []
    for a in assignments:
        section_names = await _get_section_names(db, a.id)
        stats = await get_assignment_stats(db, a.id)
        results.append(assignment_to_dict(a, section_names, stats))

    return {"assignments": results}


@router.get("/assignments")
async def list_all_assignments(
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    assignments = (await db.execute(
        select(Assignment)
        .where(Assignment.teacher_id == current_user.user_id)
        .order_by(Assignment.created_at.desc())
    )).scalars().all()

    results = []
    for a in assignments:
        section_names = await _get_section_names(db, a.id)
        stats = await get_assignment_stats(db, a.id)
        results.append(assignment_to_dict(a, section_names, stats))

    return {"assignments": results}


@router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    section_names = await _get_section_names(db, a.id)
    stats = await get_assignment_stats(db, a.id)
    result = assignment_to_dict(a, section_names, stats)
    result["content"] = a.content
    result["answer_key"] = a.answer_key
    return result


@router.patch("/assignments/{assignment_id}")
async def update_assignment(
    assignment_id: uuid.UUID, body: UpdateAssignmentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    if body.title is not None:
        title = body.title.strip()
        if not title or len(title) > 300:
            raise HTTPException(status_code=400, detail="Title must be 1-300 characters")
        a.title = title
    if body.status is not None:
        a.status = body.status
    if body.due_at is not None:
        try:
            a.due_at = datetime.fromisoformat(body.due_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid due_at format")
    if body.late_policy is not None:
        a.late_policy = body.late_policy
    if body.content is not None:
        a.content = body.content
    if body.answer_key is not None:
        a.answer_key = body.answer_key

    await db.commit()
    return {"status": "ok"}


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    await db.delete(a)
    await db.commit()
    return {"status": "ok"}


@router.post("/assignments/{assignment_id}/sections")
async def assign_to_sections(
    assignment_id: uuid.UUID, body: AssignSectionsRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    now = datetime.now(UTC)
    for sid in body.section_ids:
        # Verify section belongs to assignment's course
        section = (await db.execute(
            select(Section).where(Section.id == sid, Section.course_id == a.course_id)
        )).scalar_one_or_none()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found in this course")

        # Check if already assigned
        existing = (await db.execute(
            select(AssignmentSection)
            .where(AssignmentSection.assignment_id == a.id, AssignmentSection.section_id == sid)
        )).scalar_one_or_none()
        if not existing:
            db.add(AssignmentSection(
                assignment_id=a.id, section_id=sid, published_at=now,
            ))

    # Auto-publish if still draft
    if a.status == "draft":
        a.status = "published"

    await db.commit()
    return {"status": "ok"}


# ── Submission + Grading endpoints ──

class GradeRequest(BaseModel):
    action: str  # "approve" | "override"
    teacher_score: float | None = None
    teacher_notes: str | None = None


@router.get("/assignments/{assignment_id}/submissions")
async def list_submissions(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    # Get all submissions with grades
    from api.models.user import User
    rows = (await db.execute(
        select(Submission, SubmissionGrade, User.name, User.email)
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .where(Submission.assignment_id == a.id)
        .order_by(Submission.submitted_at.desc())
    )).all()

    submissions = []
    for sub, grade, student_name, student_email in rows:
        submissions.append({
            "id": str(sub.id),
            "student_name": student_name or "",
            "student_email": student_email,
            "status": sub.status,
            "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
            "is_late": sub.is_late,
            "ai_score": grade.ai_score if grade else None,
            "ai_breakdown": grade.ai_breakdown if grade else None,
            "teacher_score": grade.teacher_score if grade else None,
            "teacher_notes": grade.teacher_notes if grade else None,
            "final_score": grade.final_score if grade else None,
            "reviewed_at": grade.reviewed_at.isoformat() if grade and grade.reviewed_at else None,
        })

    return {"submissions": submissions}


@router.patch("/submissions/{submission_id}/grade")
async def grade_submission(
    submission_id: uuid.UUID, body: GradeRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    # Verify teacher owns the assignment
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    # Get or create grade record
    grade = (await db.execute(
        select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one_or_none()
    if not grade:
        grade = SubmissionGrade(submission_id=sub.id)
        db.add(grade)

    now = datetime.now(UTC)

    if body.action == "approve":
        if grade.ai_score is None:
            raise HTTPException(status_code=400, detail="Cannot approve: no AI score exists yet")
        grade.final_score = grade.ai_score
        grade.reviewed_by = current_user.user_id
        grade.reviewed_at = now
        sub.status = "teacher_reviewed"
    elif body.action == "override":
        if body.teacher_score is None:
            raise HTTPException(status_code=400, detail="teacher_score required for override")
        grade.teacher_score = body.teacher_score
        grade.final_score = body.teacher_score
        grade.reviewed_by = current_user.user_id
        grade.reviewed_at = now
        sub.status = "teacher_reviewed"
    else:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'override'")

    if body.teacher_notes is not None:
        grade.teacher_notes = body.teacher_notes

    await db.commit()
    return {"status": "ok"}


# ── Private helpers ──

async def _get_section_names(db: AsyncSession, assignment_id: uuid.UUID) -> list[str]:
    rows = (await db.execute(
        select(Section.name)
        .join(AssignmentSection, AssignmentSection.section_id == Section.id)
        .where(AssignmentSection.assignment_id == assignment_id)
    )).scalars().all()
    return list(rows)
