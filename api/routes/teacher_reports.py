"""POST /teacher/reports — a teacher's "Report a problem".

The web dialog sends what the teacher was looking at (ids plus a
snapshot of the AI's grade and their own). This endpoint verifies the
submission is one of theirs, fills in the human-readable snapshot
(names, titles, the problem text) so the report stays legible after
the underlying rows change, stores it, and emails the founders.

Reporting never touches the grade — it's a message, not an action.
"""

from __future__ import annotations

import asyncio
import html
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.email import send_email
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.teacher_report import REPORT_KINDS, TeacherReport
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import problem_ids_in_content

logger = logging.getLogger(__name__)

router = APIRouter()

# The email is this feature's only push channel, so the fire-and-forget
# task is pinned here until it finishes — an unreferenced task can be
# garbage-collected mid-flight and the founder never hears about it.
_notify_tasks: set[asyncio.Task[None]] = set()

KIND_LABELS = {
    "wrong_grade": "Grade or reasoning is wrong",
    "misread_work": "Misread the student's handwriting",
    "understanding_check": "Understanding-check issue",
    "broken": "Something's broken",
    "confusing": "Confusing or hard to use",
    "other": "Something else",
}


class ReportedAiGrade(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    score_status: str = Field(max_length=20)
    percent: float = Field(ge=0, le=100)
    confidence: float | None = Field(default=None, ge=0, le=1)
    reasoning: str = Field(default="", max_length=4000)


class ReportedTeacherGrade(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    score_status: str | None = Field(default=None, max_length=20)
    percent: float | None = Field(default=None, ge=0, le=100)


class CreateReportRequest(BaseModel):
    kind: str
    note: str | None = Field(default=None, max_length=4000)
    # The admin console renders this as a link — only http(s) may land
    # in an href, or a teacher account could plant `javascript:` for an
    # admin to click.
    page_url: str | None = Field(default=None, max_length=2000, pattern=r"^https?://")
    submission_id: uuid.UUID | None = None
    assignment_id: uuid.UUID | None = None
    course_id: uuid.UUID | None = None
    section_id: uuid.UUID | None = None
    student_id: uuid.UUID | None = None
    problem_id: uuid.UUID | None = None
    problem_position: int | None = Field(default=None, ge=1, le=500)
    ai_grade: ReportedAiGrade | None = None
    teacher_grade: ReportedTeacherGrade | None = None


def _grade_label(g: dict[str, Any] | None) -> str:
    if not g or not g.get("score_status"):
        return "not set"
    st = g["score_status"]
    pct = g.get("percent")
    if st == "full":
        return "Full · 100%"
    if st == "zero":
        return "No credit · 0%"
    return f"Partial · {round(pct)}%" if pct is not None else "Partial"


def _notify(report: TeacherReport) -> None:
    """Email the founders. Everything teacher-controlled is escaped —
    this lands in an inbox as HTML."""
    if not settings.admin_alert_emails:
        return
    # No student name here on purpose — email leaves our systems; the
    # admin console link carries the full case.
    where = " · ".join(
        html.escape(x) for x in (
            report.course_name, report.assignment_title,
            f"Problem {report.problem_position}" if report.problem_position else None,
        ) if x
    ) or "no submission attached"
    note_block = (
        f"<blockquote style=\"border-left:3px solid #A66B15;margin:0;padding:8px 12px;"
        f"background:#F5E8C7\">{html.escape(report.note)}</blockquote>"
        if report.note else "<p><em>No note.</em></p>"
    )
    ai = report.ai_grade or {}
    conf = ai.get("confidence")
    conf_str = f" · confidence {round(conf * 100)}%" if conf is not None else ""
    grades = (
        f"<ul><li><strong>AI gave:</strong> {html.escape(_grade_label(ai))}{conf_str}</li>"
        f"<li><strong>Teacher gave:</strong> {html.escape(_grade_label(report.teacher_grade))}</li></ul>"
        if report.submission_id else ""
    )
    reasoning = (
        f"<p><strong>AI reasoning:</strong> {html.escape(ai['reasoning'])}</p>"
        if ai.get("reasoning") else ""
    )
    question = (
        f"<p><strong>Problem:</strong> {html.escape(report.problem_question)}</p>"
        if report.problem_question else ""
    )
    subject_where = " · ".join(x for x in (
        report.assignment_title, f"Problem {report.problem_position}" if report.problem_position else None,
    ) if x)
    subject = f"[Report] {KIND_LABELS.get(report.kind, report.kind)}" + (f" · {subject_where}" if subject_where else "")
    body = (
        f"<h2>{html.escape(KIND_LABELS.get(report.kind, report.kind))}</h2>"
        f"<p><strong>{html.escape(report.teacher_name or 'A teacher')}</strong>"
        f" ({html.escape(report.teacher_email or '')}) reported a problem — {where}.</p>"
        f"{note_block}{grades}{question}{reasoning}"
        f"<p><a href=\"https://admin.veradicai.com/reports/{report.id}\" style=\"display:inline-block;"
        f"padding:10px 16px;background:#0E5238;color:#fff;border-radius:6px;text-decoration:none;"
        f"font-weight:600\">Open in admin console</a></p>"
    )
    if report.page_url:
        body += f"<p style=\"color:#64748b;font-size:12px\">Page: {html.escape(report.page_url)}</p>"

    async def _send() -> None:
        try:
            await send_email(to=settings.admin_alert_emails, subject=subject, html=body)
        except Exception:  # noqa: BLE001 — never let notification failure surface to the teacher
            logger.exception("teacher report email failed report=%s", report.id)

    task = asyncio.create_task(_send())
    _notify_tasks.add(task)
    task.add_done_callback(_notify_tasks.discard)


@router.post("/reports", status_code=status.HTTP_201_CREATED)
async def create_report(
    body: CreateReportRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.kind not in REPORT_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown report kind")

    teacher = (await db.execute(select(User).where(User.id == current_user.user_id))).scalar_one()
    report = TeacherReport(
        teacher_id=teacher.id, teacher_name=teacher.name, teacher_email=teacher.email,
        school_id=teacher.school_id, kind=body.kind,
        note=(body.note or "").strip() or None, page_url=body.page_url,
        problem_position=body.problem_position,
        ai_grade=body.ai_grade.model_dump() if body.ai_grade else None,
        teacher_grade=body.teacher_grade.model_dump() if body.teacher_grade else None,
    )

    # A submission-scoped report must be about a submission on one of
    # the teacher's own courses — otherwise the ids are dropped rather
    # than stored, so a guessed id can't be laundered into a report.
    if body.submission_id:
        sub = (await db.execute(
            select(Submission, Assignment, Course)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .join(Course, Course.id == Assignment.course_id)
            .where(Submission.id == body.submission_id)
        )).first()
        if not sub:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
        submission, assignment, course = sub
        await get_teacher_course(db, course.id, current_user.user_id)
        student = (await db.execute(select(User).where(User.id == submission.student_id))).scalar_one_or_none()
        report.submission_id = submission.id
        report.assignment_id = assignment.id
        report.assignment_title = assignment.title
        report.course_id = course.id
        report.course_name = course.name
        report.section_id = submission.section_id
        report.student_id = submission.student_id
        report.student_name = student.name if student else None
        # The problem must be on THIS assignment — otherwise any bank
        # item's text could be laundered into a report's snapshot.
        if body.problem_id and str(body.problem_id) in problem_ids_in_content(assignment.content):
            item = (await db.execute(
                select(QuestionBankItem).where(QuestionBankItem.id == body.problem_id)
            )).scalar_one_or_none()
            if item:
                report.problem_id = item.id
                report.problem_question = item.question

    db.add(report)
    await db.commit()
    logger.info(
        "AUDIT: teacher=%s filed report=%s kind=%s submission=%s",
        current_user.user_id, report.id, report.kind, report.submission_id,
    )
    _notify(report)
    return {"id": str(report.id)}
