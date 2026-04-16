"""Teacher assignment management — CRUD + section assignment."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import Integer, case, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.assignment_generation import generate_questions, generate_solutions
from api.core.integrity_pipeline import (
    STATUS_COMPLETE as INTEGRITY_COMPLETE,
)
from api.core.integrity_pipeline import (
    STATUS_SKIPPED_UNREADABLE as INTEGRITY_SKIPPED,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
)
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
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
    # Structured grading rubric. See Assignment.rubric for shape. The
    # backend accepts any dict — the frontend shapes it and the AI
    # grader reads typed fields. None = no rubric authored yet.
    rubric: dict[str, Any] | None = None

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
    # Structured grading rubric. None = leave unchanged. Pass `{}` (or
    # any dict) to overwrite; the frontend controls the shape. To clear
    # a previously-authored rubric, set `clear_rubric=true` instead of
    # passing an empty dict (mirrors the due_at pattern).
    rubric: dict[str, Any] | None = None
    clear_rubric: bool = False

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
    # Exclude preview (shadow) students from all counts.
    totals_rows = (await db.execute(
        select(
            AssignmentSection.assignment_id,
            func.count(SectionEnrollment.student_id.distinct()).label("c"),
        )
        .join(SectionEnrollment, SectionEnrollment.section_id == AssignmentSection.section_id)
        .join(User, User.id == SectionEnrollment.student_id)
        .where(AssignmentSection.assignment_id.in_(assignment_ids), User.is_preview.is_(False))
        .group_by(AssignmentSection.assignment_id)
    )).all()
    totals = {r.assignment_id: r.c for r in totals_rows}

    # 2. Submission counts per assignment.
    submitted_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .join(User, User.id == Submission.student_id)
        .where(Submission.assignment_id.in_(assignment_ids), User.is_preview.is_(False))
        .group_by(Submission.assignment_id)
    )).all()
    submitted = {r.assignment_id: r.c for r in submitted_rows}

    # 3. Graded counts per assignment — a final_score on the grade row
    # is the direct signal that grading happened. We used to proxy this
    # via Submission.status == "teacher_reviewed", but status now
    # tracks only the upload lifecycle; final_score is the honest
    # grading signal (written by teacher today, by AI in a future PR).
    graded_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.assignment_id.in_(assignment_ids),
            SubmissionGrade.final_score.is_not(None),
            User.is_preview.is_(False),
        )
        .group_by(Submission.assignment_id)
    )).all()
    graded = {r.assignment_id: r.c for r in graded_rows}

    # 4. Average final_score per assignment (ignores nulls).
    avg_rows = (await db.execute(
        select(Submission.assignment_id, func.avg(SubmissionGrade.final_score).label("avg"))
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.assignment_id.in_(assignment_ids),
            SubmissionGrade.final_score.isnot(None),
            User.is_preview.is_(False),
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
        rubric=body.rubric,
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
    result["rubric"] = a.rubric
    return result


@router.patch("/assignments/{assignment_id}")
async def update_assignment(
    assignment_id: uuid.UUID, body: UpdateAssignmentRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    # Configuration fields (title, units, due_at, late_policy) all
    # lock when the homework is published. The frontend already
    # disables every config control on published HWs and shows the
    # "Unpublish to edit" banner; this enforces the same contract on
    # the API so a stale UI or direct call can't bypass it.
    config_fields_touched = (
        body.title is not None
        or body.clear_due_at
        or body.due_at is not None
        or body.late_policy is not None
        or body.unit_ids is not None
    )
    if config_fields_touched and a.status == "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unpublish before editing configuration",
        )
    # Rubric edits are intentionally allowed on published HWs: teachers
    # often refine partial-credit rules mid-grading when they spot
    # patterns. The rubric is a teacher + AI-grader reference, not a
    # student-visible contract, so changes here don't invalidate
    # already-returned work.

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
    if body.clear_rubric:
        a.rubric = None
    elif body.rubric is not None:
        a.rubric = body.rubric

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
    # Defense-in-depth: the frontend gates the Publish button on
    # these three, but a stale UI or direct API call could bypass.
    # Enforce the same contract here.
    if not problem_ids_in_content(a.content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish a homework with no problems",
        )
    if not (a.unit_ids or []):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish a homework with no units",
        )
    # Smart default: publishing a HW with no explicit section list
    # fans it out to every section in the course. The assumption is
    # "publish means everyone in this course, unless I said otherwise."
    # Teachers who want to exclude sections use the picker; everyone
    # else gets a one-click publish.
    section_count = (await db.execute(
        select(func.count())
        .select_from(AssignmentSection)
        .where(AssignmentSection.assignment_id == a.id)
    )).scalar_one()
    if section_count == 0:
        course_section_ids = (await db.execute(
            select(Section.id).where(Section.course_id == a.course_id)
        )).scalars().all()
        if not course_section_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This course has no sections yet — create one before publishing",
            )
        now = datetime.now(UTC)
        # Race-safe fan-out: two concurrent publishes (cross-tab or
        # double-click past the frontend's busy guard) would otherwise
        # both insert the same (assignment_id, section_id) pair and
        # one would 500 on the unique constraint. ON CONFLICT DO
        # NOTHING makes the whole batch atomic — the first tx wins,
        # the second no-ops per row.
        await db.execute(
            pg_insert(AssignmentSection)
            .values([
                {
                    "id": uuid.uuid4(),
                    "assignment_id": a.id,
                    "section_id": sid,
                    "published_at": now,
                }
                for sid in course_section_ids
            ])
            .on_conflict_do_nothing(
                index_elements=["assignment_id", "section_id"],
            )
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
    if a.status == "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unpublish before editing sections",
        )

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

# Grade statuses a teacher can assign to one problem. Drive the per-
# problem pills in the grading UI. Partial requires an explicit
# percent; full/zero are auto-normalized server-side.
GRADE_STATUSES = ("full", "partial", "zero")


class BreakdownEntry(BaseModel):
    problem_id: str  # bank item id
    score_status: str  # full | partial | zero
    percent: float | None = None  # 0..100. Auto for full/zero; required for partial.
    feedback: str | None = None

    @field_validator("score_status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in GRADE_STATUSES:
            raise ValueError(f"score_status must be one of {GRADE_STATUSES}")
        return v


class GradeRequest(BaseModel):
    # Full replacement of the per-problem breakdown. None = leave
    # unchanged; empty list = clear. Normalization rules:
    #   full  -> percent forced to 100
    #   zero  -> percent forced to 0
    #   partial -> percent must be provided and in (0, 100)
    breakdown: list[BreakdownEntry] | None = None
    teacher_notes: str | None = None


@router.get("/courses/{course_id}/submissions-inbox")
async def submissions_inbox(
    course_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Per-(HW × section) aggregates for the Submissions tab inbox.

    Only published homework is included — drafts have no student
    submissions and clutter the feed. Preview students are excluded
    from every count so teachers don't see their "View as student"
    scaffolding.

    Row shape:
      { assignment_id, assignment_title, section_id, section_name,
        due_at, total_students, submitted, flagged, to_grade, published }

    Sort + client-side: the frontend orders by urgency or due date and
    renders pills per count.
    """
    await get_teacher_course(db, course_id, current_user.user_id)

    # 1. Every (published HW × section) pair owned by this teacher.
    pairs = (await db.execute(
        select(
            Assignment.id,
            Assignment.title,
            Assignment.due_at,
            Section.id,
            Section.name,
        )
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .join(Section, Section.id == AssignmentSection.section_id)
        .where(
            Assignment.course_id == course_id,
            Assignment.teacher_id == current_user.user_id,
            Assignment.type == "homework",
            Assignment.status == "published",
        )
        .order_by(Assignment.due_at.asc().nullslast(), Assignment.created_at.desc())
    )).all()
    if not pairs:
        return {"rows": []}

    assignment_ids = {p[0] for p in pairs}
    section_ids = {p[3] for p in pairs}

    # 2. Roster size per section (distinct, non-preview students).
    roster_rows = (await db.execute(
        select(
            SectionEnrollment.section_id,
            func.count(SectionEnrollment.student_id.distinct()).label("c"),
        )
        .join(User, User.id == SectionEnrollment.student_id)
        .where(
            SectionEnrollment.section_id.in_(section_ids),
            User.is_preview.is_(False),
        )
        .group_by(SectionEnrollment.section_id)
    )).all()
    roster: dict[uuid.UUID, int] = {r.section_id: r.c for r in roster_rows}

    # 3. Per-pair aggregates over submissions + their grade / integrity.
    # One grouped query does the whole sweep.
    submitted_expr = func.count(Submission.id.distinct()).label("submitted")
    to_grade_expr = func.sum(
        case(
            (
                (SubmissionGrade.final_score.is_not(None))
                & (SubmissionGrade.grade_published_at.is_(None)),
                1,
            ),
            else_=0,
        ),
    ).cast(Integer).label("to_grade")
    published_expr = func.sum(
        case(
            (SubmissionGrade.grade_published_at.is_not(None), 1),
            else_=0,
        ),
    ).cast(Integer).label("published")
    flagged_expr = func.sum(
        case(
            (
                IntegrityCheckSubmission.overall_badge.in_(
                    ("uncertain", "unlikely", "unreadable"),
                ),
                1,
            ),
            else_=0,
        ),
    ).cast(Integer).label("flagged")

    agg_rows = (await db.execute(
        select(
            Submission.assignment_id,
            Submission.section_id,
            submitted_expr,
            to_grade_expr,
            published_expr,
            flagged_expr,
        )
        .select_from(Submission)
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .outerjoin(
            IntegrityCheckSubmission,
            IntegrityCheckSubmission.submission_id == Submission.id,
        )
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.assignment_id.in_(assignment_ids),
            User.is_preview.is_(False),
        )
        .group_by(Submission.assignment_id, Submission.section_id)
    )).all()
    agg: dict[tuple[uuid.UUID, uuid.UUID], dict[str, int]] = {
        (r.assignment_id, r.section_id): {
            "submitted": int(r.submitted or 0),
            "to_grade": int(r.to_grade or 0),
            "published": int(r.published or 0),
            "flagged": int(r.flagged or 0),
        }
        for r in agg_rows
    }

    rows: list[dict[str, Any]] = []
    for aid, title, due_at, sid, sname in pairs:
        counts = agg.get((aid, sid), {})
        rows.append({
            "assignment_id": str(aid),
            "assignment_title": title,
            "section_id": str(sid),
            "section_name": sname,
            "due_at": due_at.isoformat() if due_at else None,
            "total_students": roster.get(sid, 0),
            "submitted": counts.get("submitted", 0),
            "flagged": counts.get("flagged", 0),
            "to_grade": counts.get("to_grade", 0),
            "published": counts.get("published", 0),
        })
    return {"rows": rows}


@router.get("/assignments/{assignment_id}/submissions")
async def list_submissions(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)

    # Include preview submissions so teachers can verify their own
    # "View as Student" tests; the is_preview flag is surfaced on each
    # row so the UI can distinguish them. Aggregate stats elsewhere
    # still filter preview out.
    rows = (await db.execute(
        select(Submission, SubmissionGrade, User.name, User.email, User.is_preview)
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .where(Submission.assignment_id == a.id)
        .order_by(Submission.submitted_at.desc())
    )).all()

    # Batch-load integrity checks for all submissions in one query so
    # the list page doesn't N+1. With the conversational redesign the
    # submission row itself carries overall_badge + overall_status so
    # no second query is needed.
    sub_ids = [sub.id for sub, *_ in rows]
    check_rows = (await db.execute(
        select(IntegrityCheckSubmission)
        .where(IntegrityCheckSubmission.submission_id.in_(sub_ids))
    )).scalars().all() if sub_ids else []

    check_by_sub: dict[uuid.UUID, IntegrityCheckSubmission] = {
        c.submission_id: c for c in check_rows
    }

    # For in-progress checks, we also want to show progress — how
    # many sampled problems have received a verdict. One grouped
    # query gives us that.
    problem_count_by_check: dict[uuid.UUID, tuple[int, int]] = {}
    if check_rows:
        done_expr = func.sum(
            case((IntegrityCheckProblem.badge.isnot(None), 1), else_=0),
        ).cast(Integer)
        counts = (await db.execute(
            select(
                IntegrityCheckProblem.integrity_check_submission_id,
                func.count(IntegrityCheckProblem.id),
                done_expr,
            )
            .where(
                IntegrityCheckProblem.integrity_check_submission_id.in_(
                    [c.id for c in check_rows],
                ),
            )
            .group_by(IntegrityCheckProblem.integrity_check_submission_id)
        )).all()
        for cid, total, done in counts:
            problem_count_by_check[cid] = (int(total), int(done or 0))

    submissions = []
    for sub, grade, student_name, student_email, is_preview in rows:
        check = check_by_sub.get(sub.id)
        if check is None:
            integrity_overview = None
        else:
            total, done = problem_count_by_check.get(check.id, (0, 0))
            terminal = check.status in (INTEGRITY_COMPLETE, INTEGRITY_SKIPPED)
            integrity_overview = {
                "overall_status": "complete" if terminal else "in_progress",
                "overall_badge": check.overall_badge if terminal else None,
                "problem_count": total,
                "complete_count": done,
            }

        submissions.append({
            "id": str(sub.id),
            "section_id": str(sub.section_id),
            "student_id": str(sub.student_id),
            "student_name": student_name or "",
            "student_email": student_email,
            "is_preview": bool(is_preview),
            "status": sub.status,
            "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
            "is_late": sub.is_late,
            "ai_score": grade.ai_score if grade else None,
            "ai_breakdown": grade.ai_breakdown if grade else None,
            "teacher_score": grade.teacher_score if grade else None,
            "teacher_notes": grade.teacher_notes if grade else None,
            "final_score": grade.final_score if grade else None,
            "breakdown": grade.breakdown if grade else None,
            "grade_published_at": (
                grade.grade_published_at.isoformat()
                if grade and grade.grade_published_at else None
            ),
            "reviewed_at": grade.reviewed_at.isoformat() if grade and grade.reviewed_at else None,
            "integrity_overview": integrity_overview,
        })

    return {"submissions": submissions}


def _normalize_breakdown(entries: list[BreakdownEntry]) -> list[dict[str, Any]]:
    """Coerce full/zero percents and validate partial has an explicit
    percent. De-dupe by problem_id (last write wins) so a client
    retry with a replaced entry doesn't create phantom duplicates."""
    seen: dict[str, dict[str, Any]] = {}
    for e in entries:
        if e.score_status == "full":
            percent = 100.0
        elif e.score_status == "zero":
            percent = 0.0
        else:  # partial
            if e.percent is None or not (0 < e.percent < 100):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Partial credit requires a percent strictly between 0 and 100",
                )
            percent = float(e.percent)
        seen[e.problem_id] = {
            "problem_id": e.problem_id,
            "score_status": e.score_status,
            "percent": percent,
            "feedback": e.feedback,
        }
    return list(seen.values())


@router.patch("/submissions/{submission_id}/grade")
async def grade_submission(
    submission_id: uuid.UUID, body: GradeRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    # Race-safe upsert: two concurrent grade requests (same teacher in
    # two tabs) used to 500 on the UNIQUE(submission_id) constraint
    # with a SELECT-then-INSERT pattern. ON CONFLICT DO NOTHING makes
    # it atomic — whichever tx gets there first inserts, the other
    # no-ops; both then SELECT the now-guaranteed row.
    await db.execute(
        pg_insert(SubmissionGrade)
        .values(submission_id=sub.id)
        .on_conflict_do_nothing(index_elements=["submission_id"])
    )
    grade = (await db.execute(
        select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one()

    now = datetime.now(UTC)
    touched = False

    if body.breakdown is not None:
        normalized = _normalize_breakdown(body.breakdown)
        grade.breakdown = normalized
        if normalized:
            grade.final_score = sum(e["percent"] for e in normalized) / len(normalized)
            grade.graded_at = now
            grade.reviewed_by = current_user.user_id
            grade.reviewed_at = now
        else:
            # Un-grade: clear every grade-state field so the row
            # honestly reflects "not graded." teacher_notes and
            # grade_published_at are deliberately preserved — notes
            # are independent of the score, and a retracted-after-
            # publish state is a UX concern for the frontend to flag.
            grade.final_score = None
            grade.graded_at = None
            grade.reviewed_by = None
            grade.reviewed_at = None
        touched = True

    if body.teacher_notes is not None:
        grade.teacher_notes = body.teacher_notes
        touched = True

    if not touched:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No grade fields provided",
        )

    await db.commit()
    return {
        "status": "ok",
        "final_score": grade.final_score,
        "grade_published_at": grade.grade_published_at.isoformat() if grade.grade_published_at else None,
    }


@router.post("/assignments/{assignment_id}/publish-grades")
async def publish_grades(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Publish all graded submissions on this HW to students at once.
    Idempotent — already-published grades are left alone; ungraded
    submissions are skipped (teacher can grade + republish later)."""
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    # Grades are only visible to students once the HW itself is
    # published. Publishing grades on a draft HW would orphan them
    # (student has no view of the HW to show the grade on), so reject.
    if a.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish grades on a draft homework",
        )

    grades = (await db.execute(
        select(SubmissionGrade)
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.assignment_id == a.id,
            User.is_preview.is_(False),
            SubmissionGrade.final_score.is_not(None),
            SubmissionGrade.grade_published_at.is_(None),
        )
    )).scalars().all()

    now = datetime.now(UTC)
    for g in grades:
        g.grade_published_at = now

    await db.commit()
    return {"status": "ok", "published_count": len(grades)}


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


# ── Submission detail viewing (list endpoint already exists above as
# `list_submissions`; the per-submission detail endpoint below is new
# and powers the teacher's per-submission panel with the student's
# image + per-problem typed answers + answer key side-by-side). ──

class TeacherSubmissionDetailProblem(BaseModel):
    bank_item_id: str
    position: int
    question: str
    final_answer: str | None  # the teacher-side answer key (correct answer)
    student_answer: str | None  # what the student typed for this problem


class TeacherSubmissionDetail(BaseModel):
    submission_id: str
    assignment_id: str
    assignment_title: str
    student_id: str
    student_name: str
    student_email: str
    submitted_at: datetime
    is_late: bool
    image_data: str | None
    problems: list[TeacherSubmissionDetailProblem]
    # Current grading state. None when the teacher hasn't touched this
    # submission yet. `breakdown` + `final_score` are teacher-draft
    # until `grade_published_at` is set, at which point the student
    # sees them.
    breakdown: list[dict[str, Any]] | None
    # Raw AI grader output with per-problem reasoning. None if AI
    # grading hasn't run or is disabled. The frontend uses this to
    # show "AI" badges and reasoning tooltips on pre-filled grades.
    ai_breakdown: list[dict[str, Any]] | None
    final_score: float | None
    teacher_notes: str | None
    grade_published_at: datetime | None


@router.get("/submissions/{submission_id}")
async def get_submission_detail(
    submission_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> TeacherSubmissionDetail:
    """Full per-submission detail for the teacher view: image + per-
    problem typed answers shown alongside the original problem text
    and the answer key. No grading or annotations in this PR."""
    from api.models.question_bank import QuestionBankItem
    from api.models.user import User as UserModel

    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Ownership check via the assignment
    assignment = await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    student = (await db.execute(
        select(UserModel).where(UserModel.id == sub.student_id)
    )).scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    # Reuse the same hydration approach as the student-side detail
    primary_ids = problem_ids_in_content(assignment.content)
    items_by_id: dict[str, QuestionBankItem] = {}
    if primary_ids:
        primary_uuids = [uuid.UUID(p) for p in primary_ids]
        items = (await db.execute(
            select(QuestionBankItem).where(QuestionBankItem.id.in_(primary_uuids))
        )).scalars().all()
        items_by_id = {str(it.id): it for it in items}

    grade = (await db.execute(
        select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one_or_none()

    # Build a lookup of AI-extracted student answers by problem_id.
    # The AI grading step writes `student_answer` into each breakdown
    # entry — this is what the LLM extracted from the handwriting.
    ai_answers: dict[str, str] = {}
    if grade and grade.breakdown:
        for entry in grade.breakdown:
            pid = entry.get("problem_id")
            sa = entry.get("student_answer")
            if pid and sa:
                ai_answers[pid] = sa

    answers_map = sub.final_answers or {}
    problems: list[TeacherSubmissionDetailProblem] = []
    for pos, pid in enumerate(primary_ids, start=1):
        item = items_by_id.get(str(pid))
        if not item:
            continue
        # Prefer the AI-extracted answer (from handwriting) over the
        # student's optional typed answer — the extraction is the
        # source of truth for "what the student actually wrote."
        student_answer = (
            ai_answers.get(str(pid))
            or answers_map.get(str(pid))
            or None
        )
        problems.append(TeacherSubmissionDetailProblem(
            bank_item_id=str(item.id),
            position=pos,
            question=item.question,
            final_answer=item.final_answer,
            student_answer=student_answer,
        ))

    # Surface ai_breakdown's grades array for the frontend to show
    # "AI" badges and per-problem reasoning tooltips.
    ai_breakdown_grades = None
    if grade and grade.ai_breakdown:
        ai_breakdown_grades = grade.ai_breakdown.get("grades")

    return TeacherSubmissionDetail(
        submission_id=str(sub.id),
        assignment_id=str(assignment.id),
        assignment_title=assignment.title,
        student_id=str(student.id),
        student_name=student.name or student.email,
        student_email=student.email,
        submitted_at=sub.submitted_at,
        is_late=sub.is_late,
        image_data=sub.image_data,
        problems=problems,
        breakdown=grade.breakdown if grade else None,
        ai_breakdown=ai_breakdown_grades,
        final_score=grade.final_score if grade else None,
        teacher_notes=grade.teacher_notes if grade else None,
        grade_published_at=grade.grade_published_at if grade else None,
    )


