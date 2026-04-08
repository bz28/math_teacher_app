"""Teacher assignment management — CRUD + section assignment."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.assignment_generation import generate_questions, generate_solutions
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import (
    hydrate_assignment_content,
    problem_ids_in_content,
    recompute_bank_locks,
    snapshot_bank_items,
)

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
    # An assignment belongs to one or more units. Required at create
    # time so the question bank can group everything by unit. Single-
    # unit is the common case; multi-unit is for midterms / review HWs
    # that span topics.
    unit_ids: list[uuid.UUID]
    document_ids: list[uuid.UUID] | None = None
    # New: list of approved question bank item IDs to snapshot into the
    # assignment's `content` column. The snapshot freezes the question
    # text/solution/answer at create time so future bank edits don't
    # change a homework that's already out in the world.
    bank_item_ids: list[uuid.UUID] | None = None

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

    @field_validator("unit_ids")
    @classmethod
    def validate_unit_ids(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        if not v:
            raise ValueError("At least one unit is required")
        # Dedupe while preserving order.
        seen: set[uuid.UUID] = set()
        out: list[uuid.UUID] = []
        for u in v:
            if u not in seen:
                seen.add(u)
                out.append(u)
        return out


class UpdateAssignmentRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    # ISO datetime to set, or empty string / "null" sentinel to clear.
    # We can't use real None to mean "clear" because None already means
    # "leave unchanged" — that's the cost of an open PATCH shape. The
    # frontend uses clear_due_at=true for unambiguous clearing.
    due_at: str | None = None
    clear_due_at: bool = False
    late_policy: str | None = None
    content: dict[str, Any] | None = None
    answer_key: dict[str, Any] | None = None
    # Reassign units. Same validation rules as create — must contain at
    # least one unit if provided. Pass None to leave unchanged.
    unit_ids: list[uuid.UUID] | None = None
    # When provided, re-snapshot the picked bank items into content.
    # Useful for the "edit problems" flow on a draft homework.
    bank_item_ids: list[uuid.UUID] | None = None

    @field_validator("unit_ids")
    @classmethod
    def validate_unit_ids(cls, v: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        if v is None:
            return None
        if not v:
            raise ValueError("At least one unit is required")
        seen: set[uuid.UUID] = set()
        out: list[uuid.UUID] = []
        for u in v:
            if u not in seen:
                seen.add(u)
                out.append(u)
        return out


class AssignSectionsRequest(BaseModel):
    section_ids: list[uuid.UUID]


# ── Helpers ──

async def _validate_units_in_course(
    db: AsyncSession, course_id: uuid.UUID, unit_ids: list[uuid.UUID],
) -> None:
    """Verify every id in `unit_ids` is a unit owned by `course_id`.
    Raises 404 with a generic message (no id echo) on the first failure
    so a teacher can't enumerate units across other courses."""
    if not unit_ids:
        return
    found = set((await db.execute(
        select(Unit.id).where(Unit.id.in_(unit_ids), Unit.course_id == course_id)
    )).scalars().all())
    if len(found) != len(unit_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more units do not belong to this course",
        )


async def get_teacher_assignment(db: AsyncSession, assignment_id: uuid.UUID, teacher_id: uuid.UUID) -> Assignment:
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if assignment.teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your assignment")
    return assignment


_EMPTY_STATS: dict[str, Any] = {
    "total_students": 0,
    "submitted": 0,
    "graded": 0,
    "avg_score": None,
}


async def get_assignment_stats(
    db: AsyncSession, assignment_id: uuid.UUID,
) -> dict[str, Any]:
    """Get submission/grading stats for a single assignment.

    Per-assignment helper kept for the get_assignment endpoint. List
    endpoints use bulk_assignment_stats below to avoid N+1.
    """
    return (await bulk_assignment_stats(db, [assignment_id])).get(assignment_id, _EMPTY_STATS)


async def bulk_assignment_stats(
    db: AsyncSession, assignment_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    """Bulk version of get_assignment_stats — one query per stat instead
    of (assignments × stats) queries. Returns a map keyed by
    assignment_id; missing entries default to zeros.

    Replaces the previous N+1 pattern in list_*_assignments where each
    assignment ran 1 (sections) + 4 (stats) queries — 50 queries for
    10 assignments.
    """
    if not assignment_ids:
        return {}

    # 1. Total enrolled students per assignment (distinct across sections).
    totals_rows = (await db.execute(
        select(
            AssignmentSection.assignment_id,
            func.count(SectionEnrollment.student_id.distinct()).label("c"),
        )
        .join(SectionEnrollment, SectionEnrollment.section_id == AssignmentSection.section_id)
        .where(AssignmentSection.assignment_id.in_(assignment_ids))
        .group_by(AssignmentSection.assignment_id)
    )).all()
    totals = {r.assignment_id: r.c for r in totals_rows}

    # 2. Submission counts per assignment.
    submitted_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .where(Submission.assignment_id.in_(assignment_ids))
        .group_by(Submission.assignment_id)
    )).all()
    submitted = {r.assignment_id: r.c for r in submitted_rows}

    # 3. Reviewed counts per assignment (graded + teacher-reviewed).
    graded_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.assignment_id.in_(assignment_ids),
            Submission.status == "teacher_reviewed",
        )
        .group_by(Submission.assignment_id)
    )).all()
    graded = {r.assignment_id: r.c for r in graded_rows}

    # 4. Average final_score per assignment (ignores nulls).
    avg_rows = (await db.execute(
        select(Submission.assignment_id, func.avg(SubmissionGrade.final_score).label("avg"))
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.assignment_id.in_(assignment_ids),
            SubmissionGrade.final_score.isnot(None),
        )
        .group_by(Submission.assignment_id)
    )).all()
    avgs = {r.assignment_id: r.avg for r in avg_rows}

    out: dict[uuid.UUID, dict[str, Any]] = {}
    for aid in assignment_ids:
        out[aid] = {
            "total_students": totals.get(aid, 0),
            "submitted": submitted.get(aid, 0),
            "graded": graded.get(aid, 0),
            "avg_score": round(avgs[aid], 1) if aid in avgs and avgs[aid] is not None else None,
        }
    return out


async def bulk_section_assignments(
    db: AsyncSession, assignment_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[tuple[uuid.UUID, str]]]:
    """One query, grouped in Python. Returns the (id, name) tuples for
    every section attached to each assignment so callers can serialize
    both section_ids (for editing) and section_names (for display)."""
    if not assignment_ids:
        return {}
    rows = (await db.execute(
        select(AssignmentSection.assignment_id, Section.id, Section.name)
        .join(Section, Section.id == AssignmentSection.section_id)
        .where(AssignmentSection.assignment_id.in_(assignment_ids))
    )).all()
    out: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {aid: [] for aid in assignment_ids}
    for aid, sid, name in rows:
        out[aid].append((sid, name))
    return out


def assignment_to_dict(
    a: Assignment, sections: list[tuple[uuid.UUID, str]], stats: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "course_id": str(a.course_id),
        "unit_ids": [str(u) for u in (a.unit_ids or [])],
        "title": a.title,
        "type": a.type,
        "source_type": a.source_type,
        "status": a.status,
        "due_at": a.due_at.isoformat() if a.due_at else None,
        "late_policy": a.late_policy,
        "document_ids": a.document_ids,
        "section_ids": [str(sid) for sid, _ in sections],
        "section_names": [name for _, name in sections],
        # Cheap from-content count so the list view can show "5 problems"
        # without round-tripping each assignment's detail.
        "problem_count": len(problem_ids_in_content(a.content)),
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid due_at format")

    # Validate every unit belongs to this course. Required ≥1 by the
    # request validator.
    await _validate_units_in_course(db, course_id, body.unit_ids)

    # Validate document_ids belong to this course
    doc_id_strings: list[str] | None = None
    if body.document_ids:
        from api.models.course import Document
        found = set((await db.execute(
            select(Document.id).where(Document.id.in_(body.document_ids), Document.course_id == course_id)
        )).scalars().all())
        if len(found) != len(body.document_ids):
            # Generic message — don't echo IDs back, that lets a teacher
            # enumerate which document_ids exist in *other* courses.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more documents do not belong to this course",
            )
        doc_id_strings = [str(d) for d in body.document_ids]

    # If the teacher picked bank items, snapshot them into content. The
    # bank_item_ids path takes precedence over a raw content blob — the
    # two shouldn't both be present in the new homework flow.
    content = body.content
    if body.bank_item_ids:
        content = await snapshot_bank_items(db, course_id, body.bank_item_ids)

    assignment = Assignment(
        course_id=course_id, teacher_id=current_user.user_id,
        title=body.title, type=body.type, source_type=body.source_type,
        due_at=due_at, late_policy=body.late_policy,
        content=content, answer_key=body.answer_key,
        unit_ids=body.unit_ids, document_ids=doc_id_strings,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return {"id": str(assignment.id), "title": assignment.title, "status": assignment.status}


async def _serialize_assignment_list(
    db: AsyncSession, assignments: list[Assignment],
) -> list[dict[str, Any]]:
    """Serialize a batch of assignments using the bulk stats/section
    helpers — avoids the per-assignment N+1 the list endpoints used
    to suffer from."""
    if not assignments:
        return []
    ids = [a.id for a in assignments]
    stats_map = await bulk_assignment_stats(db, ids)
    sections_map = await bulk_section_assignments(db, ids)
    return [
        assignment_to_dict(a, sections_map.get(a.id, []), stats_map.get(a.id, _EMPTY_STATS))
        for a in assignments
    ]


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

    return {"assignments": await _serialize_assignment_list(db, list(assignments))}


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

    return {"assignments": await _serialize_assignment_list(db, list(assignments))}


@router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    sections = (await bulk_section_assignments(db, [a.id])).get(a.id, [])
    stats = (await bulk_assignment_stats(db, [a.id])).get(a.id, _EMPTY_STATS)
    result = assignment_to_dict(a, sections, stats)
    result["content"] = await hydrate_assignment_content(db, a)
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title must be 1-300 characters")
        a.title = title
    if body.status is not None:
        a.status = body.status
    if body.clear_due_at:
        a.due_at = None
    elif body.due_at is not None and body.due_at != "":
        try:
            a.due_at = datetime.fromisoformat(body.due_at)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid due_at format")
    if body.late_policy is not None:
        a.late_policy = body.late_policy
    if body.unit_ids is not None:
        await _validate_units_in_course(db, a.course_id, body.unit_ids)
        a.unit_ids = body.unit_ids
    # Re-snapshotting bank items takes precedence over a raw content blob.
    if body.bank_item_ids is not None or body.content is not None:
        if a.status == "published":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unpublish before editing problems",
            )
        if body.bank_item_ids is not None:
            a.content = await snapshot_bank_items(db, a.course_id, body.bank_item_ids)
        else:
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
    if a.status == "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unpublish before deleting",
        )
    # Drafts can't have locked any bank items, so no recompute needed.
    await db.delete(a)
    await db.commit()
    return {"status": "ok"}


@router.post("/assignments/{assignment_id}/publish")
async def publish_assignment(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    if a.status == "published":
        return {"status": "ok"}
    if not problem_ids_in_content(a.content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish a homework with no problems",
        )
    a.status = "published"
    await db.flush()
    await recompute_bank_locks(db, a.course_id)
    await db.commit()
    return {"status": "ok"}


@router.post("/assignments/{assignment_id}/unpublish")
async def unpublish_assignment(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    if a.status != "published":
        return {"status": "ok"}
    a.status = "draft"
    await db.flush()
    await recompute_bank_locks(db, a.course_id)
    await db.commit()
    return {"status": "ok"}


@router.post("/assignments/{assignment_id}/sections")
async def assign_to_sections(
    assignment_id: uuid.UUID, body: AssignSectionsRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Idempotent set-sections operation. Replaces the assignment's
    section list with exactly the ids in body.section_ids — adds new
    ones, removes old ones. Does NOT change publish status; the new
    homework flow has an explicit Publish button gated on this list
    being non-empty (legacy behavior auto-published as a side effect
    here, which silently flipped drafts to published when teachers
    expected pure config)."""
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    # Validate every requested section belongs to this course before
    # touching any join rows.
    if body.section_ids:
        found = set((await db.execute(
            select(Section.id).where(
                Section.id.in_(body.section_ids), Section.course_id == a.course_id,
            )
        )).scalars().all())
        if len(found) != len(set(body.section_ids)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more sections do not belong to this course",
            )

    # Read existing assignments and diff against the desired set.
    existing_rows = (await db.execute(
        select(AssignmentSection).where(AssignmentSection.assignment_id == a.id)
    )).scalars().all()
    existing_ids = {r.section_id for r in existing_rows}
    desired_ids = set(body.section_ids)

    now = datetime.now(UTC)
    for row in existing_rows:
        if row.section_id not in desired_ids:
            await db.delete(row)
    for sid in desired_ids - existing_ids:
        db.add(AssignmentSection(
            assignment_id=a.id, section_id=sid, published_at=now,
        ))

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

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
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot approve: no AI score exists yet",
            )
        grade.final_score = grade.ai_score
        grade.reviewed_by = current_user.user_id
        grade.reviewed_at = now
        sub.status = "teacher_reviewed"
    elif body.action == "override":
        if body.teacher_score is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="teacher_score required for override")
        grade.teacher_score = body.teacher_score
        grade.final_score = body.teacher_score
        grade.reviewed_by = current_user.user_id
        grade.reviewed_at = now
        sub.status = "teacher_reviewed"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="action must be 'approve' or 'override'")

    if body.teacher_notes is not None:
        grade.teacher_notes = body.teacher_notes

    await db.commit()
    return {"status": "ok"}


# ── AI Generation endpoints ──


class GenerateQuestionsRequest(BaseModel):
    course_id: uuid.UUID
    unit_name: str
    difficulty: str = "medium"
    count: int = 10
    subject: str = "math"
    document_ids: list[uuid.UUID] | None = None


class GenerateSolutionsRequest(BaseModel):
    questions: list[dict[str, str]]
    subject: str = "math"


@router.post("/assignments/generate-questions")
async def generate_assignment_questions(
    body: GenerateQuestionsRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    course = await get_teacher_course(db, body.course_id, current_user.user_id)

    # Fetch document images if provided
    images = None
    if body.document_ids:
        from api.core.document_vision import MAX_VISION_IMAGES, fetch_document_images
        images = await fetch_document_images(db, body.document_ids, body.course_id, max_images=MAX_VISION_IMAGES)

    questions = await generate_questions(
        unit_name=body.unit_name,
        difficulty=body.difficulty,
        count=min(body.count, 30),  # cap at 30
        course_name=course.name,
        subject=body.subject,
        user_id=str(current_user.user_id),
        images=images or None,
    )

    if not questions:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate questions")

    return {"questions": questions}


@router.post("/assignments/generate-solutions")
async def generate_assignment_solutions(
    body: GenerateSolutionsRequest,
    current_user: CurrentUser = Depends(require_teacher),
) -> dict[str, Any]:
    if not body.questions or len(body.questions) > 30:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide 1-30 questions")

    solutions = await generate_solutions(
        questions=body.questions,
        subject=body.subject,
        user_id=str(current_user.user_id),
    )

    return {"solutions": solutions}


