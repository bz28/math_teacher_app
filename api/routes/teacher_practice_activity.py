"""Teacher practice-activity insights — engagement + struggle signal.

Practice is ungraded by design, so this is deliberately NOT part of the
Grades tab. These reads surface ENGAGEMENT (did the student practice,
how recently, how did it go) and STRUGGLE (which problems/concepts the
class keeps retrying or revealing) — never a score, never a raw answer.

Two endpoints, mounted under the teacher router (so /v1/teacher/...),
matching the path shape of teacher_grades.py:
  GET /courses/{course_id}/sections/{section_id}/students/{student_id}/practice-activity
      → one student's engagement + their personal struggle items
  GET /courses/{course_id}/sections/{section_id}/practice-insights
      → class-level struggle aggregate (anonymous; per bank item)
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.practice_activity import (
    MODE_LEARN,
    MODE_PRACTICE,
    OUTCOME_FIRST_TRY,
    OUTCOME_RETRY,
    OUTCOME_REVEALED,
    STRUGGLE_OUTCOMES,
    PracticeActivity,
)
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()

# Cap on how many struggle items each read surfaces — a re-teach list,
# not an exhaustive dump.
_TOP_STRUGGLE_ITEMS = 20


@router.get("/courses/{course_id}/sections/{section_id}/students/{student_id}/practice-activity")
async def get_student_practice_activity(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    student_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One student's practice/learn engagement for the teacher. Practiced
    count, last active, outcome breakdown, and the bank items/concepts
    the student most often retried or revealed (their struggle signal).
    No raw answers, no grade — insight only."""
    course = await get_teacher_course(db, course_id, current_user.user_id)

    # Confirm the section is in this course AND the student is enrolled
    # in it — one query, same gate as teacher_grades.get_student_grades.
    student_row = (await db.execute(
        select(User.id, User.name, Section.name.label("section_name"))
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .where(
            User.id == student_id,
            Section.id == section_id,
            Section.course_id == course_id,
        )
    )).first()
    if not student_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not enrolled in this section",
        )

    # FERPA: a teacher just read one student's practice record. Authz is
    # confirmed above. The helper commits its own row and never raises.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=student_id,
        record_type="practice_activity",
        accessor_school_id=course.school_id,
        request=request,
    )

    rows = (await db.execute(
        select(PracticeActivity)
        .where(
            PracticeActivity.student_id == student_id,
            PracticeActivity.section_id == section_id,
        )
        .order_by(PracticeActivity.created_at.desc())
    )).scalars().all()

    breakdown = {
        OUTCOME_FIRST_TRY: 0,
        OUTCOME_RETRY: 0,
        OUTCOME_REVEALED: 0,
        "learn_completed": 0,
    }
    practiced_count = 0
    # Per bank item: count of struggle events (retry/revealed).
    struggle_by_item: dict[uuid.UUID, dict[str, int]] = {}
    last_active = rows[0].created_at if rows else None

    for act in rows:
        if act.mode == MODE_PRACTICE:
            practiced_count += 1
            if act.outcome in breakdown:
                breakdown[act.outcome] += 1
            if act.outcome in STRUGGLE_OUTCOMES:
                s = struggle_by_item.setdefault(
                    act.bank_item_id, {"retry": 0, "revealed": 0},
                )
                if act.outcome == OUTCOME_RETRY:
                    s["retry"] += 1
                else:
                    s["revealed"] += 1
        elif act.mode == MODE_LEARN:
            breakdown["learn_completed"] += 1

    struggle_items = await _attach_titles(db, struggle_by_item)

    return {
        "student": {
            "id": str(student_row.id),
            "name": student_row.name,
            "section_id": str(section_id),
            "section_name": student_row.section_name,
        },
        "practiced_count": practiced_count,
        "learn_walkthroughs": breakdown["learn_completed"],
        "last_active": last_active.isoformat() if last_active else None,
        "outcome_breakdown": breakdown,
        "struggle_items": struggle_items,
    }


async def _attach_titles(
    db: AsyncSession, struggle_by_item: dict[uuid.UUID, dict[str, int]],
) -> list[dict[str, Any]]:
    """Resolve bank-item titles (the concept label) for a struggle map
    and return it as a list sorted by total struggle events desc,
    capped at _TOP_STRUGGLE_ITEMS."""
    if not struggle_by_item:
        return []
    titles = {
        r.id: r.title for r in (await db.execute(
            select(QuestionBankItem.id, QuestionBankItem.title)
            .where(QuestionBankItem.id.in_(struggle_by_item.keys()))
        )).all()
    }
    items = [
        {
            "bank_item_id": str(item_id),
            "concept": titles.get(item_id, "—"),
            "retry_count": counts["retry"],
            "revealed_count": counts["revealed"],
            "struggle_count": counts["retry"] + counts["revealed"],
        }
        for item_id, counts in struggle_by_item.items()
    ]
    items.sort(key=lambda x: x["struggle_count"], reverse=True)
    return items[:_TOP_STRUGGLE_ITEMS]


@router.get("/courses/{course_id}/sections/{section_id}/practice-insights")
async def get_section_practice_insights(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Class-level struggle aggregate for one section: per bank item, how
    many distinct students struggled (retried/revealed) vs how many
    practiced it. Aggregate/anonymous — names the concept to re-teach,
    not the student."""
    await get_teacher_course(db, course_id, current_user.user_id)

    # The section must belong to this course. 404 (not 403) so we don't
    # confirm the existence of a section in someone else's course.
    section_ok = (await db.execute(
        select(Section.id).where(
            Section.id == section_id, Section.course_id == course_id,
        )
    )).scalar_one_or_none()
    if section_ok is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Section not found",
        )

    # Per bank item: distinct students who practiced it, and distinct
    # students who struggled on it. Two grouped queries (one filtered to
    # struggle outcomes) merged in Python — keeps each query simple.
    practiced_rows = (await db.execute(
        select(
            PracticeActivity.bank_item_id,
            func.count(func.distinct(PracticeActivity.student_id)).label("students"),
        )
        .where(
            PracticeActivity.section_id == section_id,
            PracticeActivity.mode == MODE_PRACTICE,
        )
        .group_by(PracticeActivity.bank_item_id)
    )).all()
    practiced_by_item = {r.bank_item_id: int(r.students) for r in practiced_rows}

    struggle_rows = (await db.execute(
        select(
            PracticeActivity.bank_item_id,
            func.count(func.distinct(PracticeActivity.student_id)).label("students"),
            func.count().label("events"),
        )
        .where(
            PracticeActivity.section_id == section_id,
            PracticeActivity.mode == MODE_PRACTICE,
            PracticeActivity.outcome.in_(STRUGGLE_OUTCOMES),
        )
        .group_by(PracticeActivity.bank_item_id)
    )).all()
    struggle_by_item = {
        r.bank_item_id: (int(r.students), int(r.events)) for r in struggle_rows
    }

    item_ids = set(practiced_by_item) | set(struggle_by_item)
    titles = {
        r.id: r.title for r in (await db.execute(
            select(QuestionBankItem.id, QuestionBankItem.title)
            .where(QuestionBankItem.id.in_(item_ids))
        )).all()
    } if item_ids else {}

    items = []
    for item_id in item_ids:
        students_struggled, struggle_events = struggle_by_item.get(item_id, (0, 0))
        items.append({
            "bank_item_id": str(item_id),
            "concept": titles.get(item_id, "—"),
            "students_practiced": practiced_by_item.get(item_id, 0),
            "students_struggled": students_struggled,
            "struggle_events": struggle_events,
        })
    # Most-struggled first — that's the re-teach priority list.
    items.sort(
        key=lambda x: (x["students_struggled"], x["struggle_events"]), reverse=True,
    )

    return {
        "section_id": str(section_id),
        "students_active": int((await db.execute(
            select(func.count(func.distinct(PracticeActivity.student_id)))
            .where(PracticeActivity.section_id == section_id)
        )).scalar() or 0),
        "items": items,
    }
