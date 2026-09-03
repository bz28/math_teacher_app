"""Admin view of a single assignment — what a teacher actually assigned.

The activity log records that a teacher published something, and
`GenerationQuality` shows which generated questions teachers had to fix.
Neither shows the artifact: the problems a teacher *kept* and put in
front of a class. A teacher generates twelve questions, approves four,
edits one, writes one by hand and publishes six — and the gap between
what we produced and what she was willing to assign is the signal this
endpoint exists to expose.

Read-only. Per-problem class accuracy lives in the teacher's own Class
Item Analysis and individual student answers in the submission trace;
duplicating either here would mean two implementations of the same thing.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course
from api.models.question_bank import (
    QuestionBankGenerationJob,
    QuestionBankItem,
)
from api.models.question_edit import QuestionEdit
from api.models.section import Section
from api.models.user import User
from api.services.bank import hydrate_assignment_content, problem_ids_in_content

router = APIRouter()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _provenance(item: QuestionBankItem | None, edited: bool) -> str | None:
    """How this problem came to exist, as the dashboard labels it.

    `None` means "we can't tell" and the UI shows no badge. That is the
    right answer for a legacy snapshot assignment, whose content carries
    the question text but no bank item to read `source` from — a missing
    badge costs a reader nothing, a wrong one costs them their trust in
    the column.
    """
    if item is None:
        return None
    if item.source != "generated":
        # "manual" (typed by the teacher) and "imported" (from a PDF)
        # are both non-AI provenance and worth distinguishing.
        return "hand-written" if item.source == "manual" else item.source
    return "AI · edited" if edited else "AI · approved"


@router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One assignment, as the teacher built it.

    Problems resolve through `hydrate_assignment_content` — the same
    helper the teacher's own app uses — rather than reading
    `content.problem_ids` directly. Practice assignments don't populate
    that field at all (their items are bank *variations*, which the
    snapshot path deliberately rejects) and would render as empty
    assignments if we read content ourselves.
    """
    assignment = (
        await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    ).scalar_one_or_none()
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found"
        )

    course = (
        await db.execute(select(Course).where(Course.id == assignment.course_id))
    ).scalar_one_or_none()
    teacher = (
        await db.execute(select(User).where(User.id == assignment.teacher_id))
    ).scalar_one_or_none()

    # ── Sections ────────────────────────────────────────────────────
    # `published_at` lives on the JOIN, not on the assignment: the same
    # homework can go out to Period 3 on Monday and Period 5 on Tuesday,
    # so there is no single publish time to put in the header.
    section_rows = (
        await db.execute(
            select(Section, AssignmentSection.published_at)
            .join(AssignmentSection, AssignmentSection.section_id == Section.id)
            .where(AssignmentSection.assignment_id == assignment.id)
            .order_by(Section.name.asc())
        )
    ).all()
    sections = [
        {"id": str(s.id), "name": s.name, "published_at": _iso(pub)}
        for s, pub in section_rows
    ]
    published_times = [pub for _, pub in section_rows if pub is not None]
    first_published_at = min(published_times) if published_times else None

    # ── Problems ────────────────────────────────────────────────────
    hydrated = await hydrate_assignment_content(db, assignment)
    raw_problems: list[dict[str, Any]] = []
    if isinstance(hydrated, dict) and isinstance(hydrated.get("problems"), list):
        raw_problems = [p for p in hydrated["problems"] if isinstance(p, dict)]

    bank_ids = [
        p["bank_item_id"]
        for p in raw_problems
        if isinstance(p.get("bank_item_id"), str)
    ]
    items_by_id: dict[str, QuestionBankItem] = {}
    edited_ids: set[str] = set()
    if bank_ids:
        parsed: list[uuid.UUID] = []
        for bid in bank_ids:
            try:
                parsed.append(uuid.UUID(bid))
            except (ValueError, TypeError):
                continue
        if parsed:
            items = (
                await db.execute(
                    select(QuestionBankItem).where(QuestionBankItem.id.in_(parsed))
                )
            ).scalars().all()
            items_by_id = {str(i.id): i for i in items}
            # One query for "has this item ever been edited", not one per
            # problem. `QuestionEdit` is the same table GenerationQuality
            # reads, so "edited" means the same thing on both pages.
            edited_ids = {
                str(bid)
                for (bid,) in (
                    await db.execute(
                        select(QuestionEdit.bank_item_id)
                        .where(QuestionEdit.bank_item_id.in_(parsed))
                        .distinct()
                    )
                ).all()
            }

    problems: list[dict[str, Any]] = []
    for index, p in enumerate(raw_problems, start=1):
        bank_item_id = p.get("bank_item_id")
        item = items_by_id.get(bank_item_id) if isinstance(bank_item_id, str) else None
        problems.append(
            {
                # Legacy snapshots predate the `position` key; fall back to
                # the list order rather than emitting a null the UI has to
                # special-case.
                "position": p.get("position") or index,
                "bank_item_id": bank_item_id,
                "question": p.get("question"),
                "final_answer": p.get("final_answer"),
                "figure_svg": p.get("figure_svg"),
                "difficulty": p.get("difficulty"),
                "format": item.format if item else None,
                "provenance": _provenance(item, bank_item_id in edited_ids),
                "missing": False,
            }
        )

    # A bank item that was hard-deleted is dropped by the hydrator, which
    # is right for the teacher (it isn't on the paper any more) and wrong
    # here: an admin reading "4 problems" on the list and seeing 3 rows
    # needs to know why. Positions are preserved by the hydrator, so any
    # gap in the expected id list is a deleted reference — emit a
    # tombstone in its slot rather than renumbering the survivors.
    if assignment.type != "practice":
        expected = problem_ids_in_content(assignment.content)
        if expected:
            seen = {p["position"] for p in problems}
            for position in range(1, len(expected) + 1):
                if position not in seen:
                    problems.append(
                        {
                            "position": position,
                            "bank_item_id": expected[position - 1],
                            "question": None,
                            "final_answer": None,
                            "figure_svg": None,
                            "difficulty": None,
                            "format": None,
                            "provenance": None,
                            "missing": True,
                        }
                    )
            problems.sort(key=lambda p: p["position"])

    # ── Lifecycle ───────────────────────────────────────────────────
    job = (
        await db.execute(
            select(QuestionBankGenerationJob)
            .where(QuestionBankGenerationJob.originating_assignment_id == assignment.id)
            .order_by(QuestionBankGenerationJob.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    generated_count = (
        await db.execute(
            select(func.count())
            .select_from(QuestionBankItem)
            .where(QuestionBankItem.originating_assignment_id == assignment.id)
        )
    ).scalar_one()

    submitted = (
        await db.execute(
            select(func.count())
            .select_from(Submission)
            .where(Submission.assignment_id == assignment.id)
        )
    ).scalar_one()
    # Graded and released are counted off the grade row, not the
    # submission: a submission with no grade row has not been graded, and
    # `grade_published_at` is what a student can actually see.
    graded = (
        await db.execute(
            select(func.count())
            .select_from(SubmissionGrade)
            .join(Submission, Submission.id == SubmissionGrade.submission_id)
            .where(Submission.assignment_id == assignment.id)
        )
    ).scalar_one()
    released = (
        await db.execute(
            select(func.count())
            .select_from(SubmissionGrade)
            .join(Submission, Submission.id == SubmissionGrade.submission_id)
            .where(
                Submission.assignment_id == assignment.id,
                SubmissionGrade.grade_published_at.is_not(None),
            )
        )
    ).scalar_one()

    return {
        "id": str(assignment.id),
        "title": assignment.title,
        "type": assignment.type,
        "status": assignment.status,
        "description": assignment.description,
        "source_type": assignment.source_type,
        "due_at": _iso(assignment.due_at),
        "late_policy": assignment.late_policy,
        "integrity_check_enabled": assignment.integrity_check_enabled,
        "created_at": _iso(assignment.created_at),
        "first_published_at": _iso(first_published_at),
        "course": (
            {"id": str(course.id), "name": course.name} if course else None
        ),
        "teacher": (
            {
                "id": str(teacher.id),
                "name": teacher.name or teacher.email,
            }
            if teacher
            else None
        ),
        "sections": sections,
        "generation": (
            {
                "status": job.status,
                "requested_count": job.requested_count,
                "created_at": _iso(job.created_at),
                "generated_count": generated_count,
            }
            if job
            else None
        ),
        "submitted_count": submitted,
        "graded_count": graded,
        "released_count": released,
        "problems": problems,
    }
