"""Teacher routes that copy a homework's problems into a practice set."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import record_activity
from api.core.entitlements import Entitlement, check_entitlement
from api.core.question_bank_generation import schedule_generation_job
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user_full, require_teacher
from api.middleware.rate_limit import limiter
from api.models.assignment import Assignment, AssignmentSection
from api.models.section import Section
from api.models.user import User
from api.routes.teacher_assignments import get_teacher_assignment
from api.routes.teacher_courses import get_teacher_course
from api.services.assignment_duplicate import (
    duplicate_homework,
    homework_bank_items,
    queue_variation_jobs,
)

router = APIRouter()


class PracticeProblemsRequest(BaseModel):
    """Which homework problems a practice set covers, and how many new
    versions of each to write. `item_ids` = None means every problem."""
    item_ids: list[uuid.UUID] | None = None
    count: int = Field(default=1, ge=1, le=5)


class ClonePracticeRequest(PracticeProblemsRequest):
    # None → every period the homework is assigned to.
    section_ids: list[uuid.UUID] | None = None


@router.post(
    "/courses/{course_id}/assignments/{hw_id}/clone-as-practice",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("3/minute")
async def clone_homework_as_practice(
    request: Request,
    course_id: uuid.UUID, hw_id: uuid.UUID,
    body: ClonePracticeRequest | None = None,
    current_user: CurrentUser = Depends(require_teacher),
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Make a draft practice set from a homework: `count` new versions of
    each chosen problem, for the chosen periods. The teacher approves
    each version in the review queue, then publishes."""
    body = body or ClonePracticeRequest()
    # Ownership/existence checks first so a teacher poking at someone
    # else's homework gets 404, not a misleading 'limit reached' that
    # would confirm the resource exists.
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
    parents = await homework_bank_items(db, course_id, source, body.item_ids)

    hw_sections = (await db.execute(
        select(Section.id, Section.name)
        .join(AssignmentSection, AssignmentSection.section_id == Section.id)
        .where(AssignmentSection.assignment_id == source.id)
        .order_by(Section.name)
    )).all()
    sections = hw_sections
    if body.section_ids is not None:
        sections = [s for s in hw_sections if s.id in set(body.section_ids)]
        if not body.section_ids or len(sections) != len(set(body.section_ids)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pick periods this homework is assigned to",
            )

    # Each problem fires its own generation call, so gate behind the
    # same cap as direct generation. Runs AFTER the ownership and content
    # checks so 'limit reached' never leaks resources the teacher
    # couldn't have touched.
    await check_entitlement(db, user, Entitlement.GENERATE_PROBLEM)

    # "[Practice]" keeps cross-type surfaces (search, activity log) from
    # confusing the set with its homework; a set for some of the
    # homework's periods names them so two periods' sets read apart.
    # Just part of the title — the teacher can edit it freely.
    title = f"[Practice] {source.title}"
    if len(sections) < len(hw_sections):
        title += " · " + ", ".join(s.name for s in sections)
    practice = Assignment(
        course_id=course_id,
        teacher_id=current_user.user_id,
        title=title,
        type="practice",
        unit_ids=list(source.unit_ids or []),
        source_homework_id=source.id,
        # Teacher publishes explicitly after reviewing.
        status="draft",
    )
    db.add(practice)
    await db.flush()
    for s in sections:
        db.add(AssignmentSection(assignment_id=practice.id, section_id=s.id))

    job_ids = queue_variation_jobs(db, practice, parents, body.count, current_user.user_id)
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


@router.post(
    "/courses/{course_id}/assignments/{practice_id}/practice-problems",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("3/minute")
async def add_practice_problems(
    request: Request,
    course_id: uuid.UUID, practice_id: uuid.UUID,
    body: PracticeProblemsRequest,
    current_user: CurrentUser = Depends(require_teacher),
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Write versions of more homework problems into an existing practice
    set made from that homework. Drafts and published sets alike: each
    new version still waits for the teacher's approval."""
    await get_teacher_course(db, course_id, current_user.user_id)
    practice = await get_teacher_assignment(db, practice_id, current_user.user_id)
    if practice.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment not found in this course",
        )
    source = (
        await db.get(Assignment, practice.source_homework_id)
        if practice.type == "practice" and practice.source_homework_id else None
    )
    if source is None or source.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only practice made from a homework can take its problems",
        )
    parents = await homework_bank_items(db, course_id, source, body.item_ids)
    await check_entitlement(db, user, Entitlement.GENERATE_PROBLEM)

    job_ids = queue_variation_jobs(db, practice, parents, body.count, current_user.user_id)
    await db.commit()
    for jid in job_ids:
        schedule_generation_job(jid)
    return {"id": str(practice.id), "job_ids": [str(j) for j in job_ids]}


class DuplicateHomeworkRequest(BaseModel):
    """Where the copy goes and when it's due. Sections and the due date
    are picked fresh: the source's own never carry over."""
    course_id: uuid.UUID | None = None  # None → the homework's own course
    due_at: str | None = None
    section_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)


@router.post("/assignments/{assignment_id}/duplicate", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def duplicate_homework_route(
    request: Request,
    assignment_id: uuid.UUID,
    body: DuplicateHomeworkRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Copy a homework into a new draft, in its course or another of the
    teacher's: problems, grading rules, points, late policy and
    instructions. Nothing is generated and nothing needs review again."""
    source = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    if source.type != "homework":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only homeworks can be duplicated",
        )
    target_course_id = body.course_id or source.course_id
    await get_teacher_course(db, target_course_id, current_user.user_id)
    due_at = None
    if body.due_at:
        try:
            due_at = datetime.fromisoformat(body.due_at)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid due_at format")
        if due_at.tzinfo is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="due_at needs a timezone",
            )

    dup = await duplicate_homework(
        db, source,
        target_course_id=target_course_id,
        teacher_id=current_user.user_id,
        due_at=due_at,
        section_ids=body.section_ids,
    )
    await record_activity(
        db, current_user, "assignment.duplicate", "assignment", dup.id,
        {"title": dup.title, "source_id": str(source.id)},
    )
    await db.commit()
    return {
        "id": str(dup.id),
        "title": dup.title,
        "status": dup.status,
        "course_id": str(dup.course_id),
    }
