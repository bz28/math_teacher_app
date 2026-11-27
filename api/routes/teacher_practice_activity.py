"""Teacher practice-activity insights — engagement + struggle signal.

Practice is ungraded by design, so this is deliberately NOT part of the
Grades tab. These reads surface ENGAGEMENT (did the student practice,
how recently, how did it go) and STRUGGLE (which problems/concepts the
class keeps retrying or revealing) — never a score, never a raw answer.

Mounted under the teacher router (so /v1/teacher/...):
  GET /courses/{course_id}/sections/{section_id}/students/{student_id}/practice-activity
      → one student's engagement + their personal struggle items
  GET /assignments/{assignment_id}/practiced
      → who in each period has practiced a set, and how many per problem
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import AssignmentSection
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
from api.routes.teacher_assignments import get_teacher_assignment
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()

# Cap on how many struggle items each read surfaces — a re-teach list,
# not an exhaustive dump.
_TOP_STRUGGLE_ITEMS = 20


def _accumulate_struggle(
    struggle_by_item: dict[uuid.UUID, dict[str, int]],
    bank_item_id: uuid.UUID,
    outcome: str | None,
) -> None:
    """Tally one struggle event (retry/revealed) onto a per-item map.
    Shared by every read that builds a struggle signal so the bucket
    shape stays identical."""
    s = struggle_by_item.setdefault(bank_item_id, {"retry": 0, "revealed": 0})
    if outcome == OUTCOME_RETRY:
        s["retry"] += 1
    else:
        s["revealed"] += 1


async def _resolve_titles(
    db: AsyncSession, item_ids: Any,
) -> dict[uuid.UUID, str]:
    """Resolve bank-item titles (the concept labels) in one query for a
    collection of item ids. Empty in → empty out (no DB hit)."""
    ids = set(item_ids)
    if not ids:
        return {}
    return {
        r.id: r.title for r in (await db.execute(
            select(QuestionBankItem.id, QuestionBankItem.title)
            .where(QuestionBankItem.id.in_(ids))
        )).all()
    }


def _rank_struggle_items(
    struggle_by_item: dict[uuid.UUID, dict[str, int]],
    titles: dict[uuid.UUID, str],
) -> list[dict[str, Any]]:
    """Title-attach + sort a struggle map, most-struggled first, capped
    at _TOP_STRUGGLE_ITEMS. Pure — the caller resolves titles, so this
    stays a pure function."""
    items: list[dict[str, Any]] = [
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
                _accumulate_struggle(
                    struggle_by_item, act.bank_item_id, act.outcome,
                )
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
    titles = await _resolve_titles(db, struggle_by_item.keys())
    return _rank_struggle_items(struggle_by_item, titles)


# ── Who practiced a set ─────────────────────────────────────────────


async def practiced_rows(
    db: AsyncSession, practice_id: uuid.UUID, section_ids: list[uuid.UUID],
) -> list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]]:
    """`(section_id, student_id, bank_item_id)` for every problem of the
    set a student answered in practice, once each. "Practiced" means
    answered at least one problem; a Learn walkthrough isn't practice.
    Shared with the Insights tray, so both count the same students."""
    if not section_ids:
        return []
    return [tuple(r) for r in (await db.execute(
        select(PracticeActivity.section_id, PracticeActivity.student_id, PracticeActivity.bank_item_id)
        .distinct()
        .where(
            PracticeActivity.practice_assignment_id == practice_id,
            PracticeActivity.section_id.in_(section_ids),
            PracticeActivity.mode == MODE_PRACTICE,
        )
    )).all()]


class PracticedStudent(BaseModel):
    id: uuid.UUID
    name: str


class PracticedSection(BaseModel):
    section_id: uuid.UUID
    section_name: str
    students: int
    practiced: int
    # Teacher-only, and shown behind a click on the set page.
    not_yet: list[PracticedStudent]


class SetPracticed(BaseModel):
    sections: list[PracticedSection]
    # Students who answered each problem, keyed by bank item id, across
    # the set's periods. Problems nobody answered are left out.
    problems: dict[str, int]


@router.get("/assignments/{assignment_id}/practiced", response_model=SetPracticed)
async def get_set_practiced(
    assignment_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> SetPracticed:
    """Who in each of the set's periods has practiced it, and how many
    answered each problem. Ungraded: no scores, no outcomes. Counts
    enrolled, non-preview students only."""
    practice = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    if practice.type != "practice":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Practice set not found")
    course = await get_teacher_course(db, practice.course_id, current_user.user_id)

    sections = (await db.execute(
        select(Section.id, Section.name)
        .join(AssignmentSection, AssignmentSection.section_id == Section.id)
        .where(AssignmentSection.assignment_id == practice.id)
        .order_by(Section.name)
    )).all()
    section_ids = [s.id for s in sections]
    roster = (await db.execute(
        select(SectionEnrollment.section_id, User.id, User.name)
        .join(User, User.id == SectionEnrollment.student_id)
        .where(SectionEnrollment.section_id.in_(section_ids), User.is_preview.is_(False))
    )).all() if section_ids else []

    # FERPA: the not-yet list names students. Authz is confirmed above.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=None,
        record_type="practice_roster",
        record_id=practice.id,
        accessor_school_id=course.school_id,
        request=request,
    )

    enrolled = {(r.section_id, r.id) for r in roster}
    rows = [r for r in await practiced_rows(db, practice.id, section_ids) if (r[0], r[1]) in enrolled]
    practiced = {(sec, sid) for sec, sid, _item in rows}
    by_problem: dict[str, set[uuid.UUID]] = {}
    for _sec, sid, item in rows:
        by_problem.setdefault(str(item), set()).add(sid)

    return SetPracticed(
        sections=[
            PracticedSection(
                section_id=sec.id,
                section_name=sec.name,
                students=sum(1 for r in roster if r.section_id == sec.id),
                practiced=sum(1 for r in roster if r.section_id == sec.id and (sec.id, r.id) in practiced),
                not_yet=sorted(
                    (PracticedStudent(id=r.id, name=r.name or "Student")
                     for r in roster if r.section_id == sec.id and (sec.id, r.id) not in practiced),
                    key=lambda st: st.name.casefold(),
                ),
            )
            for sec in sections
        ],
        problems={item: len(sids) for item, sids in by_problem.items()},
    )
