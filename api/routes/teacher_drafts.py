"""The teacher's unfinished homework, for the home page's "Drafts in
progress" line: a draft otherwise lives three levels down (course →
Homework → Upcoming), and real drafts sat there for days.

Routing metadata only: which homework, which course, when it's due, how
many problems it has and how many generated ones still wait for the
teacher's approval (the same count as the homework card's nudge).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.services.bank import problem_ids_in_content

router = APIRouter()

# Home shows the few most recently touched; the rest are a click away in
# each course's Homework tab.
DRAFTS_SHOWN = 5


class DraftHomework(BaseModel):
    assignment_id: uuid.UUID
    title: str
    course_id: uuid.UUID
    course_name: str
    due_at: datetime | None
    problem_count: int
    pending_review: int


class Drafts(BaseModel):
    drafts: list[DraftHomework]
    total: int


@router.get("/drafts")
async def list_drafts(
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Drafts:
    """This teacher's draft homework in courses that aren't archived,
    most recently edited first."""
    where = (
        Assignment.teacher_id == current_user.user_id,
        Assignment.type == "homework",
        Assignment.status == "draft",
        Course.status != "archived",
    )
    total = (await db.execute(
        select(func.count()).select_from(Assignment)
        .join(Course, Course.id == Assignment.course_id).where(*where)
    )).scalar_one()
    rows = (await db.execute(
        select(Assignment.id, Assignment.title, Assignment.due_at, Assignment.content,
               Course.id.label("course_id"), Course.name.label("course_name"))
        .join(Course, Course.id == Assignment.course_id)
        .where(*where)
        .order_by(Assignment.updated_at.desc())
        .limit(DRAFTS_SHOWN)
    )).all()
    ids = [r.id for r in rows]
    pending = dict((await db.execute(
        select(QuestionBankItem.originating_assignment_id, func.count())
        .where(QuestionBankItem.originating_assignment_id.in_(ids),
               QuestionBankItem.status == "pending")
        .group_by(QuestionBankItem.originating_assignment_id)
    )).tuples().all()) if ids else {}
    return Drafts(
        drafts=[
            DraftHomework(
                assignment_id=r.id, title=r.title, course_id=r.course_id,
                course_name=r.course_name, due_at=r.due_at,
                problem_count=len(problem_ids_in_content(r.content)),
                pending_review=pending.get(r.id, 0),
            )
            for r in rows
        ],
        total=total,
    )
