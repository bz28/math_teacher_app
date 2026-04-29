"""Teacher assignment management — CRUD + section assignment."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import Integer, and_, case, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.assignment_generation import generate_questions, generate_solutions
from api.core.integrity_pipeline import (
    STATUS_COMPLETE as INTEGRITY_COMPLETE,
)
from api.core.integrity_pipeline import (
    STATUS_SKIPPED_UNREADABLE as INTEGRITY_SKIPPED,
)
from api.core.question_bank_generation import schedule_generation_job
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
)
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
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
    type: str  # homework | quiz | test | practice
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
        if v not in ("homework", "quiz", "test", "practice"):
            raise ValueError("Type must be homework, quiz, test, or practice")
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
    # Free-form student-visible instructions. None = leave unchanged.
    # Empty string clears it (this field has no "leave unchanged vs
    # clear" ambiguity — empty text and null both render as "no
    # instructions" on the student page, so we collapse them).
    description: str | None = None

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str | None) -> str | None:
        # Cap matches the frontend textarea (2000 chars). Defends
        # against non-browser callers bloating the assignments table
        # with unbounded prose. None passes through (= unchanged).
        if v is not None and len(v) > 2000:
            raise ValueError("Instructions must be 2000 characters or fewer")
        return v

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
    "pending_review": 0,
    "approved_count": 0,
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

    # 2. Submission counts per assignment. The SectionEnrollment join
    # is load-bearing: a student can submit, then be unenrolled from
    # the section. Their Submission row stays (we don't cascade the
    # delete), but `total_students` (computed via SectionEnrollment
    # above) drops them. Without this guard, submitted > total
    # students — surfaced as "Submitted 3/2" on the inbox card.
    # Same enrollment scope on both sides keeps the ratio honest.
    submitted_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .join(User, User.id == Submission.student_id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.student_id == Submission.student_id,
                SectionEnrollment.section_id == Submission.section_id,
            ),
        )
        .where(Submission.assignment_id.in_(assignment_ids), User.is_preview.is_(False))
        .group_by(Submission.assignment_id)
    )).all()
    submitted = {r.assignment_id: r.c for r in submitted_rows}

    # 3. Graded counts per assignment — a final_score on the grade row
    # is the direct signal that grading happened. We used to proxy this
    # via Submission.status == "teacher_reviewed", but status now
    # tracks only the upload lifecycle; final_score is the honest
    # grading signal (written by teacher today, by AI in a future PR).
    # Same SectionEnrollment guard as `submitted` above so the
    # numerator stays in scope with `total_students`.
    graded_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.student_id == Submission.student_id,
                SectionEnrollment.section_id == Submission.section_id,
            ),
        )
        .where(
            Submission.assignment_id.in_(assignment_ids),
            SubmissionGrade.final_score.is_not(None),
            User.is_preview.is_(False),
        )
        .group_by(Submission.assignment_id)
    )).all()
    graded = {r.assignment_id: r.c for r in graded_rows}

    # 4. Pending-review bank-item count per assignment. These are
    # AI-generated problems originated by this HW that still need the
    # teacher's approval before they can join the problem list — same
    # signal as the amber "N problems need your review" banner on the
    # HW detail page. Surfaced on the HW list card as a gentle nudge
    # so the teacher can find drafts with work waiting on them without
    # opening each one.
    pending_rows = (await db.execute(
        select(
            QuestionBankItem.originating_assignment_id,
            func.count().label("c"),
        )
        .where(
            QuestionBankItem.originating_assignment_id.in_(assignment_ids),
            QuestionBankItem.status == "pending",
        )
        .group_by(QuestionBankItem.originating_assignment_id)
    )).all()
    pending = {r.originating_assignment_id: r.c for r in pending_rows}

    # 4b. Approved bank-item count per assignment. Used as the
    # problem_count for practice assignments, which attach their
    # items via originating_assignment_id rather than
    # content.problem_ids (the approve path gates on parent_question_id
    # is NULL, which rejects all practice variations). HW rows keep
    # using the content-based count; practice rows use this instead.
    approved_rows = (await db.execute(
        select(
            QuestionBankItem.originating_assignment_id,
            func.count().label("c"),
        )
        .where(
            QuestionBankItem.originating_assignment_id.in_(assignment_ids),
            QuestionBankItem.status == "approved",
        )
        .group_by(QuestionBankItem.originating_assignment_id)
    )).all()
    approved = {r.originating_assignment_id: r.c for r in approved_rows}

    # 5. Average final_score per assignment (ignores nulls). Same
    # SectionEnrollment guard so the average reflects only currently
    # enrolled students — an unenrolled student's score shouldn't
    # skew the class average.
    avg_rows = (await db.execute(
        select(Submission.assignment_id, func.avg(SubmissionGrade.final_score).label("avg"))
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .join(User, User.id == Submission.student_id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.student_id == Submission.student_id,
                SectionEnrollment.section_id == Submission.section_id,
            ),
        )
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
            "pending_review": pending.get(aid, 0),
            "approved_count": approved.get(aid, 0),
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
        "description": a.description,
        "type": a.type,
        "source_type": a.source_type,
        "status": a.status,
        "due_at": a.due_at.isoformat() if a.due_at else None,
        "late_policy": a.late_policy,
        "document_ids": a.document_ids,
        "source_homework_id": str(a.source_homework_id) if a.source_homework_id else None,
        "section_ids": [str(sid) for sid, _ in sections],
        "section_names": [name for _, name in sections],
        # HW: count from content.problem_ids (cheap, no round-trip).
        # Practice: content is empty by design (the approve path can't
        # snapshot variations), so count approved bank items bucketed
        # by originating_assignment_id in the stats bulk query.
        "problem_count": (
            stats.get("approved_count", 0)
            if a.type == "practice"
            else len(problem_ids_in_content(a.content))
        ),
        "total_students": stats["total_students"],
        "submitted": stats["submitted"],
        "graded": stats["graded"],
        "pending_review": stats["pending_review"],
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


@router.post(
    "/courses/{course_id}/assignments/{hw_id}/clone-as-practice",
    status_code=status.HTTP_201_CREATED,
)
async def clone_homework_as_practice(
    course_id: uuid.UUID, hw_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Clone a homework's problem list into a new Practice assignment.
    Each source problem spawns a single 1:1 variation job via the
    existing `parent_question_id` path in question_bank_generation —
    items land in the teacher's review queue as each job completes.
    The practice set starts as a draft with no content; the teacher
    publishes it explicitly after reviewing.
    """
    await get_teacher_course(db, course_id, current_user.user_id)
    source = await get_teacher_assignment(db, hw_id, current_user.user_id)
    # Cross-course clone would leak one course's content into another.
    if source.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found in this course",
        )
    if source.type != "homework":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only homeworks can be cloned as practice",
        )
    source_item_ids: list[uuid.UUID] = []
    for raw in problem_ids_in_content(source.content):
        try:
            source_item_ids.append(uuid.UUID(raw))
        except (ValueError, TypeError):
            # Corrupted content should never reach here, but skip
            # rather than 500 if it does.
            continue
    if not source_item_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source homework has no problems to clone",
        )

    # Pull the source items to copy unit_id + source_doc_ids per job.
    # snapshot_bank_items already enforces approved+primary+course_id
    # at write time; the course_id filter here is defense in depth
    # against any historical rows that escaped that invariant.
    items = (await db.execute(
        select(QuestionBankItem).where(
            QuestionBankItem.id.in_(source_item_ids),
            QuestionBankItem.course_id == course_id,
        )
    )).scalars().all()
    item_by_id: dict[uuid.UUID, QuestionBankItem] = {i.id: i for i in items}

    practice = Assignment(
        course_id=course_id,
        teacher_id=current_user.user_id,
        # Prepend "[Practice]" so cross-type surfaces (global search,
        # allAssignments, activity log) can't confuse the clone with
        # its source HW. The prefix is just part of the title — the
        # teacher can edit or remove it freely once the practice is
        # created; we never strip/re-add it on later updates.
        title=f"[Practice] {source.title}",
        type="practice",
        unit_ids=list(source.unit_ids or []),
        source_homework_id=source.id,
        # Teacher publishes explicitly after reviewing — same lifecycle
        # as HW. Content fills in as generation jobs complete and the
        # teacher approves their output.
        status="draft",
    )
    db.add(practice)
    await db.flush()

    # Copy the source HW's section assignments so the practice is
    # visible to the same students once it publishes. The teacher
    # can still edit the section picker on the practice detail page
    # if they want to narrow or widen the audience.
    source_section_ids = (await db.execute(
        select(AssignmentSection.section_id).where(
            AssignmentSection.assignment_id == source.id,
        )
    )).scalars().all()
    for sid in source_section_ids:
        db.add(AssignmentSection(
            assignment_id=practice.id,
            section_id=sid,
        ))

    # Assign the id explicitly at construction so we can collect it
    # without an intermediate flush. The model's `default=uuid.uuid4`
    # is a SQLAlchemy column default that only fires during flush —
    # reading `job.id` right after `db.add()` without assigning would
    # return None, which is how an earlier version silently queued
    # jobs that `schedule_generation_job(None)` then failed to run.
    job_ids: list[uuid.UUID] = []
    for item_id in source_item_ids:
        parent = item_by_id.get(item_id)
        if parent is None:
            # Source item was deleted between content snapshot and this
            # query. Skip — teacher ends with a partial practice set
            # and can retry missing slots via "Generate more".
            continue
        job_id = uuid.uuid4()
        job = QuestionBankGenerationJob(
            id=job_id,
            course_id=course_id,
            unit_id=parent.unit_id,
            originating_assignment_id=practice.id,
            created_by_id=current_user.user_id,
            status="queued",
            requested_count=1,
            difficulty=parent.difficulty,
            source_doc_ids=parent.source_doc_ids,
            parent_question_id=parent.id,
        )
        db.add(job)
        job_ids.append(job_id)

    await db.commit()

    # Fire after commit so rows are durable before any background task
    # attempts to read them.
    for jid in job_ids:
        schedule_generation_job(jid)

    return {
        "id": str(practice.id),
        "title": practice.title,
        "status": practice.status,
        "source_homework_id": str(practice.source_homework_id) if practice.source_homework_id else None,
        "job_ids": [str(j) for j in job_ids],
    }


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
    #
    # Rubric and description are deliberately NOT in this list — see
    # the matching block below the guard for why each is exempt.
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
    #
    # Description (student-visible instructions) is also allowed on
    # published HWs for the same shape of reason: it doesn't change
    # which problems students see, it just clarifies expectations.
    # Teachers commonly add notes like "no calculators" mid-flight.

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

    if body.description is not None:
        # Strip + collapse-to-null so we don't store all-whitespace
        # instructions that render as a visible empty box on the
        # student page. Editable while published like rubric.
        cleaned = body.description.strip()
        a.description = cleaned if cleaned else None

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
    # Enforce the same contract here. HW counts from content; practice
    # counts approved items via originating_assignment_id since its
    # content is empty by design.
    if a.type == "practice":
        approved_count = (await db.execute(
            select(func.count()).select_from(QuestionBankItem).where(
                QuestionBankItem.originating_assignment_id == a.id,
                QuestionBankItem.status == "approved",
            )
        )).scalar_one()
        has_problems = approved_count > 0
    else:
        has_problems = bool(problem_ids_in_content(a.content))
    if not has_problems:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish with no problems",
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
        due_at, total_students, submitted, flagged, to_grade, dirty,
        published }

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
    # Published but the live draft differs from the published snapshot
    # — teacher has edited the grade since publishing. Content-based
    # (not timestamp-based) so flipping a grade back to its original
    # value doesn't wrongly mark it dirty. `breakdown` is JSON, so
    # cast to jsonb to get structural equality.
    dirty_expr = func.sum(
        case(
            (
                (SubmissionGrade.grade_published_at.is_not(None))
                & (
                    SubmissionGrade.final_score.is_distinct_from(
                        SubmissionGrade.published_final_score,
                    )
                    | SubmissionGrade.teacher_notes.is_distinct_from(
                        SubmissionGrade.published_teacher_notes,
                    )
                    | SubmissionGrade.breakdown.cast(JSONB).is_distinct_from(
                        SubmissionGrade.published_breakdown.cast(JSONB),
                    )
                ),
                1,
            ),
            else_=0,
        ),
    ).cast(Integer).label("dirty")
    published_expr = func.sum(
        case(
            (SubmissionGrade.grade_published_at.is_not(None), 1),
            else_=0,
        ),
    ).cast(Integer).label("published")
    # "Flagged" here = submissions that need teacher attention:
    #   • agent emitted flag_for_review
    #   • extraction was unreadable (teacher decides what to do)
    #   • the check finalized without a disposition (turn cap / no
    #     sampled problems — teacher reviews inconclusive)
    #   • student raised "Reader got something wrong" before confirm,
    #     routing the submission straight to manual grading with no
    #     AI calls downstream
    # pass / needs_practice / tutor_pivot are teacher-facing notes
    # but not "flagged" for attention.
    flagged_expr = func.sum(
        case(
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
        ),
    ).cast(Integer).label("flagged")

    # SectionEnrollment guard mirrors the assignment-level stats: a
    # student who submitted then got unenrolled from the section
    # should drop out of all per-section aggregates so submitted /
    # graded / published / flagged stay in scope with `roster`
    # (which is computed via SectionEnrollment above). Without this,
    # the inbox card shows "Submitted 3/2" — numerator outpaces
    # denominator because the unenrolled student's Submission row
    # still exists.
    agg_rows = (await db.execute(
        select(
            Submission.assignment_id,
            Submission.section_id,
            submitted_expr,
            to_grade_expr,
            dirty_expr,
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
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.student_id == Submission.student_id,
                SectionEnrollment.section_id == Submission.section_id,
            ),
        )
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
            "dirty": int(r.dirty or 0),
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
            "dirty": counts.get("dirty", 0),
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
    # the list page doesn't N+1. The submission row itself carries
    # disposition + overall_status so no second query is needed.
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
    # query gives us that. A problem has a verdict when its rubric is
    # populated (or it's been dismissed/skipped — any terminal status).
    problem_count_by_check: dict[uuid.UUID, tuple[int, int]] = {}
    if check_rows:
        done_expr = func.sum(
            case((IntegrityCheckProblem.rubric.isnot(None), 1), else_=0),
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
            # Pull notable_count (the number of notable turns) out of
            # the precomputed activity_summary blob so the queue row's
            # Activity pill can render the count directly ("Activity:
            # 3 notable moments"). Full totals + per-turn detail is
            # loaded by the detail endpoint when the teacher opens a
            # submission. Keeps list payloads compact across many rows.
            activity_summary = check.activity_summary or None
            notable_turns = (
                activity_summary.get("notable_turns")
                if isinstance(activity_summary, dict)
                else None
            )
            notable_count = (
                len(notable_turns) if isinstance(notable_turns, list) else None
            )
            integrity_overview = {
                "overall_status": "complete" if terminal else "in_progress",
                "disposition": check.disposition if terminal else None,
                "problem_count": total,
                "complete_count": done,
                "notable_count": notable_count if terminal else None,
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
            # Frozen rubric the AI grader applied for this submission.
            # Frontend compares against the assignment's live rubric to
            # decide whether to surface the regrade CTA.
            "rubric_snapshot": grade.rubric_snapshot if grade else None,
            "grade_published_at": (
                grade.grade_published_at.isoformat()
                if grade and grade.grade_published_at else None
            ),
            "grade_dirty": _is_grade_dirty(grade),
            "reviewed_at": grade.reviewed_at.isoformat() if grade and grade.reviewed_at else None,
            "integrity_overview": integrity_overview,
            # Student flagged "reader got something wrong" on the
            # post-submit confirm screen. When set, no AI grading or
            # integrity has run — teacher grades manually.
            "extraction_flagged_at": (
                sub.extraction_flagged_at.isoformat()
                if sub.extraction_flagged_at else None
            ),
        })

    return {"submissions": submissions}


def _is_grade_dirty(grade: SubmissionGrade | None) -> bool:
    """True if the current draft differs from the published snapshot.

    Compares content, not timestamps — a teacher flipping Full → Zero →
    Full would bump `graded_at` each time but end up with the same
    values, so a timestamp check would wrongly mark them dirty. Python
    `!=` on lists/dicts does deep equality, which is what we want."""
    if grade is None or grade.grade_published_at is None:
        return False
    return (
        grade.final_score != grade.published_final_score
        or grade.teacher_notes != grade.published_teacher_notes
        or grade.breakdown != grade.published_breakdown
    )


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
        "grade_dirty": _is_grade_dirty(grade),
    }


@router.post("/submissions/{submission_id}/regrade")
async def regrade_submission(
    submission_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Re-run AI grading against the assignment's current rubric.

    Intended trigger: teacher edited the rubric after the AI first
    graded, so `rubric_snapshot` differs from `assignment.rubric` —
    the review page surfaces a regrade CTA that calls this endpoint.

    Override semantics: we replace the live `breakdown / final_score`
    even if the teacher had manually reviewed — the regrade is the
    teacher's explicit ask to throw out their edits and use the fresh
    AI pass against the updated rubric. `published_*` is untouched
    until the teacher republishes, so students keep seeing the old
    grade until then.

    Re-runs extraction (one Vision call) rather than reading a cache:
    the extraction snapshot lives on the integrity-check rows only for
    probed problems; using the same code path as the submission
    pipeline keeps behavior consistent.
    """
    from api.core.grading_ai import run_ai_grading_for_submission
    from api.core.integrity_ai import extract_student_work
    from api.services.bank import load_problems_for_assignment

    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found",
        )

    assignment = await get_teacher_assignment(
        db, sub.assignment_id, current_user.user_id,
    )
    if not assignment.ai_grading_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AI grading is not enabled for this homework",
        )

    # Teacher-initiated regrade — attribute LLM cost to the teacher so
    # the admin dashboard can distinguish student-submission grades
    # from teacher-triggered regrades and spot any over-use.
    actor_id = str(current_user.user_id)
    # Re-run extraction with the HW's problems as context so Vision
    # re-tags per-problem attribution against any problem edits the
    # teacher has made since the original grading run.
    problems = await load_problems_for_assignment(db, assignment)
    extraction = await extract_student_work(
        sub.id, db, problems=problems, user_id=actor_id,
    )
    await run_ai_grading_for_submission(
        sub.id, extraction, db, user_id=actor_id, force=True,
    )
    await db.commit()

    grade = (await db.execute(
        select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one_or_none()
    if grade is None:
        # Grader bailed early (e.g. no problems, no extraction). Surface
        # that honestly so the UI can show "couldn't regrade" instead of
        # a silent no-op.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not regrade — no gradeable content",
        )
    # Unwrap ai_breakdown to match get_submission_detail's shape —
    # it's stored as the full grader envelope {grades: [...]} but the
    # TeacherSubmissionDetail type (what the frontend replaces after
    # regrade) expects the already-flattened array. Shipping the raw
    # envelope here would desync the detail's ai_breakdown shape on
    # the review page and break AI-badge rendering until the student
    # row refetches.
    ai_breakdown_grades = None
    if grade.ai_breakdown:
        ai_breakdown_grades = grade.ai_breakdown.get("grades")
    return {
        "status": "ok",
        "final_score": grade.final_score,
        "ai_score": grade.ai_score,
        "breakdown": grade.breakdown,
        "ai_breakdown": ai_breakdown_grades,
        "rubric_snapshot": grade.rubric_snapshot,
        "graded_at": grade.graded_at.isoformat() if grade.graded_at else None,
        "grade_published_at": (
            grade.grade_published_at.isoformat()
            if grade.grade_published_at else None
        ),
        "grade_dirty": _is_grade_dirty(grade),
    }


@router.post("/assignments/{assignment_id}/publish-grades")
async def publish_grades(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Publish (or republish) all graded submissions on this HW.

    Two categories are picked up:
      • fresh — graded but never published
      • dirty — already published, but the live draft differs from
                the published snapshot (content diff, so a grade
                flipped back to its original value is not dirty)

    Either way, the live `final_score / breakdown / teacher_notes`
    are snapshotted into the `published_*` columns and
    `grade_published_at` is stamped. Ungraded submissions are skipped.
    """
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
            or_(
                SubmissionGrade.grade_published_at.is_(None),
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
        )
    )).scalars().all()

    now = datetime.now(UTC)
    for g in grades:
        g.published_final_score = g.final_score
        g.published_breakdown = g.breakdown
        g.published_teacher_notes = g.teacher_notes
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

class TeacherSubmissionStep(BaseModel):
    """One line of student work, attributed to a specific HW problem.

    `latex` and `plain_english` carry the *current* (edited if the
    student corrected it, else original Vision) view — so the teacher
    grading row renders the same content the AI grader saw.

    When the student edited this step on the post-submit confirm
    screen, `edited` is True and `original_plain_english` /
    `original_latex` carry the Vision read so the review page can
    surface a "view original" disclosure on demand.
    """

    latex: str
    plain_english: str
    edited: bool = False
    original_latex: str | None = None
    original_plain_english: str | None = None


class TeacherSubmissionDetailProblem(BaseModel):
    bank_item_id: str
    position: int
    question: str
    final_answer: str | None  # the teacher-side answer key (correct answer)
    student_answer: str | None  # what the student typed for this problem
    # Full step-by-step extraction filtered to this problem's
    # position. Empty list when the student left this problem blank or
    # the extractor couldn't attribute any step. The whole-submission
    # extraction lives on Submission.extraction; we slice it here so
    # the frontend doesn't need to filter client-side.
    student_steps: list[TeacherSubmissionStep] = []


class TeacherSubmissionDetail(BaseModel):
    submission_id: str
    assignment_id: str
    assignment_title: str
    student_id: str
    student_name: str
    student_email: str
    submitted_at: datetime
    is_late: bool
    # List of {data, media_type} the student submitted — multi-page
    # support landed in PR 3. Null only on rows pre-dating the
    # multi-file column.
    files: list[dict[str, str]] | None
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
    # True when this submission has been published AND the teacher has
    # edited the grade since. The live breakdown/final_score above are
    # the draft; students still see the published_* snapshot.
    grade_dirty: bool


@router.get("/submissions/{submission_id}")
async def get_submission_detail(
    submission_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> TeacherSubmissionDetail:
    """Full per-submission detail for the teacher view: image + per-
    problem typed answers shown alongside the original problem text
    and the answer key. No grading or annotations in this PR."""
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
    # Group the Vision extraction's per-line steps by problem_position
    # once, so each problem's slice is an O(1) dict lookup below
    # rather than a re-scan. None = extraction never ran (pipeline off
    # or failed); empty buckets are normal for blank problems and the
    # response carries an empty list for them.
    #
    # Apply any student-supplied corrections from the post-submit
    # confirm screen on top of the Vision read. The teacher grading
    # row should reflect what the AI graded against (the overlaid
    # view); the original Vision read travels alongside as
    # `original_*` so the UI can surface a "view original AI read"
    # disclosure on edited steps.
    edits = sub.extraction_edits or {}
    steps_by_position: dict[int, list[TeacherSubmissionStep]] = {}
    if sub.extraction:
        for step in sub.extraction.get("steps", []) or []:
            position = step.get("problem_position")
            if not isinstance(position, int):
                continue  # cross-problem scratchwork — skip
            step_num = step.get("step_num")
            edit_key = (
                f"{position}:{step_num}"
                if isinstance(step_num, int) and not isinstance(step_num, bool)
                else None
            )
            original_latex = step.get("latex") or ""
            original_plain = step.get("plain_english") or ""
            edited_text = (
                edits.get(edit_key, "").strip()
                if edit_key and edit_key in edits
                else None
            )
            if edited_text == "":
                # Student cleared the row — drop it entirely so the
                # grader's view and the teacher's view stay in sync.
                continue
            if edited_text is not None:
                # Student replaced this step's content. Route the edit
                # to the field that carried the original work: math
                # steps stay math (latex), text steps stay text. Mirrors
                # the apply_extraction_edits helper so the teacher view
                # renders with the same fidelity as the grader saw.
                # Vision read is preserved on original_* for the
                # disclosure regardless.
                if original_latex:
                    edited_step = TeacherSubmissionStep(
                        latex=edited_text,
                        plain_english="",
                        edited=True,
                        original_latex=original_latex,
                        original_plain_english=original_plain,
                    )
                else:
                    edited_step = TeacherSubmissionStep(
                        latex="",
                        plain_english=edited_text,
                        edited=True,
                        original_latex=original_latex,
                        original_plain_english=original_plain,
                    )
                steps_by_position.setdefault(position, []).append(edited_step)
                continue
            if not original_latex and not original_plain:
                continue
            steps_by_position.setdefault(position, []).append(
                TeacherSubmissionStep(
                    latex=original_latex,
                    plain_english=original_plain,
                )
            )

    problems: list[TeacherSubmissionDetailProblem] = []
    for pos, pid in enumerate(primary_ids, start=1):
        item = items_by_id.get(str(pid))
        if not item:
            continue
        # Priority order for the answer the teacher sees:
        #   1. The student's confirm-screen edit (the most explicit
        #      claim about what they wrote — also what AI grading uses
        #      once it runs).
        #   2. The AI-extracted answer from `grade.breakdown` (which
        #      already reflects the edit, since the grader reads the
        #      overlaid extraction). Available only post-grading.
        #   3. The student's optional typed answer at submit time.
        # Without (1), an edited :final wouldn't surface to the
        # teacher view in the window between confirm and AI grading
        # completion (or at all if `ai_grading_enabled=false`).
        edited_final = (edits.get(f"{pos}:final") or "").strip()
        student_answer = (
            edited_final
            or ai_answers.get(str(pid))
            or answers_map.get(str(pid))
            or None
        )
        problems.append(TeacherSubmissionDetailProblem(
            bank_item_id=str(item.id),
            position=pos,
            question=item.question,
            final_answer=item.final_answer,
            student_answer=student_answer,
            student_steps=steps_by_position.get(pos, []),
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
        files=sub.files,
        problems=problems,
        breakdown=grade.breakdown if grade else None,
        ai_breakdown=ai_breakdown_grades,
        final_score=grade.final_score if grade else None,
        teacher_notes=grade.teacher_notes if grade else None,
        grade_published_at=grade.grade_published_at if grade else None,
        grade_dirty=_is_grade_dirty(grade),
    )


