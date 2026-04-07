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
from api.models.question_bank import QuestionBankItem
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


class UpdateAssignmentRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    due_at: str | None = None
    late_policy: str | None = None
    content: dict[str, Any] | None = None
    answer_key: dict[str, Any] | None = None
    # When provided, re-snapshot the picked bank items into content.
    # Useful for the "edit problems" flow on a draft homework.
    bank_item_ids: list[uuid.UUID] | None = None


class AssignSectionsRequest(BaseModel):
    section_ids: list[uuid.UUID]


# ── Helpers ──

async def snapshot_bank_items(
    db: AsyncSession,
    course_id: uuid.UUID,
    bank_item_ids: list[uuid.UUID],
) -> dict[str, Any]:
    """Validate the bank items belong to the course and are approved, then
    return a content dict that *references* them by id. The actual
    question text is JOINed in at read time so edits to the bank
    propagate live (the bank is the single source of truth).

    Stored shape:
        { "problem_ids": ["uuid1", "uuid2", ...] }
    """
    if not bank_item_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one question is required",
        )

    rows = (await db.execute(
        select(QuestionBankItem.id).where(
            QuestionBankItem.id.in_(bank_item_ids),
            QuestionBankItem.course_id == course_id,
            QuestionBankItem.status == "approved",
        )
    )).scalars().all()

    found = set(rows)
    missing = [str(i) for i in bank_item_ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Some questions aren't approved or don't belong to this course: {missing}"
            ),
        )

    return {"problem_ids": [str(b) for b in bank_item_ids]}


async def hydrate_assignment_content(
    db: AsyncSession, assignment: Assignment,
) -> dict[str, Any] | None:
    """Read assignment.content and return it with live `problems` joined
    from the bank. Backwards-compat fallback: if content is the legacy
    snapshot shape (`problems` with question text), return it as-is."""
    content = assignment.content
    if not isinstance(content, dict):
        return content
    # Legacy: pre-refactor snapshots stored full problem objects.
    if "problems" in content and "problem_ids" not in content:
        return content
    ids = content.get("problem_ids") or []
    if not ids:
        return {"problems": []}
    # Defensive: skip junk IDs rather than 500 the whole assignment view.
    uuid_ids: list[uuid.UUID] = []
    for i in ids:
        try:
            uuid_ids.append(i if isinstance(i, uuid.UUID) else uuid.UUID(str(i)))
        except (ValueError, TypeError):
            continue
    if not uuid_ids:
        return {"problems": []}
    rows = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(uuid_ids))
    )).scalars().all()
    by_id = {str(r.id): r for r in rows}
    problems = []
    for position, bid in enumerate(ids, start=1):
        item = by_id.get(str(bid))
        if not item:
            continue  # silently drop missing/deleted refs
        problems.append({
            "bank_item_id": str(item.id),
            "position": position,
            "question": item.question,
            "solution_steps": item.solution_steps,
            "final_answer": item.final_answer,
            "difficulty": item.difficulty,
        })
    return {"problems": problems}


def _problem_ids_in_content(content: Any) -> list[str]:
    """Extract bank item IDs from an assignment content dict, handling
    both the new and legacy shapes."""
    if not isinstance(content, dict):
        return []
    if "problem_ids" in content and isinstance(content["problem_ids"], list):
        return [str(i) for i in content["problem_ids"]]
    if "problems" in content and isinstance(content["problems"], list):
        return [str(p.get("bank_item_id")) for p in content["problems"] if p.get("bank_item_id")]
    return []


async def used_in_assignments_map(
    db: AsyncSession, course_id: uuid.UUID,
) -> dict[str, list[dict[str, str]]]:
    """For every assignment in the course (draft + published), return a
    map of bank_item_id → list of {id, title, type, status} entries.
    Used to render the "Used in" pills + power the per-unit
    Homework/Tests tabs. Drafts are included so the teacher sees their
    in-progress homework references; only published entries actually
    lock the bank item (see recompute_bank_locks)."""
    rows = (await db.execute(
        select(Assignment).where(Assignment.course_id == course_id)
    )).scalars().all()
    out: dict[str, list[dict[str, str]]] = {}
    for a in rows:
        for pid in _problem_ids_in_content(a.content):
            out.setdefault(pid, []).append(
                {"id": str(a.id), "title": a.title, "type": a.type, "status": a.status},
            )
    return out


async def recompute_bank_locks(db: AsyncSession, course_id: uuid.UUID) -> None:
    """Recalculate `locked` for every bank item in a course based on
    whether any published assignment references it. Cheap enough — runs
    only on publish/unpublish."""
    used = await used_in_assignments_map(db, course_id)
    # Only published references lock the bank item; drafts can be edited freely.
    locked_ids = {
        pid for pid, refs in used.items()
        if any(r.get("status") == "published" for r in refs)
    }
    items = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.course_id == course_id)
    )).scalars().all()
    for item in items:
        should_lock = str(item.id) in locked_ids
        if item.locked != should_lock:
            item.locked = should_lock


async def get_teacher_assignment(db: AsyncSession, assignment_id: uuid.UUID, teacher_id: uuid.UUID) -> Assignment:
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if assignment.teacher_id != teacher_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your assignment")
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid due_at format")

    # Validate unit belongs to this course
    if body.unit_id is not None:
        from api.models.unit import Unit
        unit_check = (await db.execute(
            select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
        )).scalar_one_or_none()
        if not unit_check:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found in this course")

    # Validate document_ids belong to this course
    doc_id_strings: list[str] | None = None
    if body.document_ids:
        from api.models.course import Document
        found = set((await db.execute(
            select(Document.id).where(Document.id.in_(body.document_ids), Document.course_id == course_id)
        )).scalars().all())
        if len(found) != len(body.document_ids):
            missing = set(body.document_ids) - found
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Documents not found in this course: {missing}",
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
    if body.due_at is not None:
        try:
            a.due_at = datetime.fromisoformat(body.due_at)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid due_at format")
    if body.late_policy is not None:
        a.late_policy = body.late_policy
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
    if not _problem_ids_in_content(a.content):
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
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    now = datetime.now(UTC)
    for sid in body.section_ids:
        # Verify section belongs to assignment's course
        section = (await db.execute(
            select(Section).where(Section.id == sid, Section.course_id == a.course_id)
        )).scalar_one_or_none()
        if not section:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found in this course")

        # Check if already assigned
        existing = (await db.execute(
            select(AssignmentSection)
            .where(AssignmentSection.assignment_id == a.id, AssignmentSection.section_id == sid)
        )).scalar_one_or_none()
        if not existing:
            db.add(AssignmentSection(
                assignment_id=a.id, section_id=sid, published_at=now,
            ))

    # Auto-publish if still draft — also locks the bank items it references.
    if a.status == "draft":
        a.status = "published"
        await db.flush()
        await recompute_bank_locks(db, a.course_id)

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


# ── Private helpers ──

async def _get_section_names(db: AsyncSession, assignment_id: uuid.UUID) -> list[str]:
    rows = (await db.execute(
        select(Section.name)
        .join(AssignmentSection, AssignmentSection.section_id == Section.id)
        .where(AssignmentSection.assignment_id == assignment_id)
    )).scalars().all()
    return list(rows)
