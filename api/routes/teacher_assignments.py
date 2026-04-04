"""Teacher assignment management — CRUD + section assignment."""

import uuid
from datetime import datetime, timezone
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
    content: dict | None = None
    answer_key: dict | None = None
    unit_id: str | None = None

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
    content: dict | None = None
    answer_key: dict | None = None


class AssignSectionsRequest(BaseModel):
    section_ids: list[str]


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


async def get_assignment_stats(db: AsyncSession, assignment_id: uuid.UUID) -> dict:
    """Get submission/grading stats for an assignment."""
    total_q = select(func.count()).select_from(
        select(SectionEnrollment.student_id)
        .join(AssignmentSection, AssignmentSection.section_id == SectionEnrollment.section_id)
        .where(AssignmentSection.assignment_id == assignment_id)
        .distinct()
    )
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


def assignment_to_dict(a: Assignment, section_names: list[str], stats: dict) -> dict[str, Any]:
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

    assignment = Assignment(
        course_id=course_id, teacher_id=current_user.user_id,
        title=body.title, type=body.type, source_type=body.source_type,
        due_at=due_at, late_policy=body.late_policy,
        content=body.content, answer_key=body.answer_key,
        unit_id=uuid.UUID(body.unit_id) if body.unit_id else None,
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

    now = datetime.now(timezone.utc)
    for sid in body.section_ids:
        section_uuid = uuid.UUID(sid)
        # Verify section belongs to assignment's course
        section = (await db.execute(
            select(Section).where(Section.id == section_uuid, Section.course_id == a.course_id)
        )).scalar_one_or_none()
        if not section:
            raise HTTPException(status_code=404, detail=f"Section {sid} not found in this course")

        # Check if already assigned
        existing = (await db.execute(
            select(AssignmentSection)
            .where(AssignmentSection.assignment_id == a.id, AssignmentSection.section_id == section_uuid)
        )).scalar_one_or_none()
        if not existing:
            db.add(AssignmentSection(
                assignment_id=a.id, section_id=section_uuid, published_at=now,
            ))

    # Auto-publish if still draft
    if a.status == "draft":
        a.status = "published"

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
