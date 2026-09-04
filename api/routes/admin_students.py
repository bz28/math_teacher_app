"""Admin per-student drill-in — the case file for one kid's work.

## Why this exists

The console could show you a teacher and it could show you an aggregate
quality report, but it could not show you a *student*. The comment in
`IndependentPanel.tsx` said so plainly: "students have no dedicated
detail page, so their most useful drill-in is their logged AI calls" —
a raw list of model invocations, which answers a question nobody asked.

Every fact needed was already stored. `submissions` keeps the photos,
Vision's read, the student's corrections, and the exact moment they
signed off; `submission_grades` keeps what the AI scored and what the
teacher did about it; `grading_jobs` keeps what is still owed. What was
missing was a door: no query anywhere started from a student id.

## What the two endpoints are for

`GET /admin/students/{id}` is the funnel — of everything this student
handed in, how much made it to a published grade, and where the rest
stopped. `GET /admin/students/{id}/submissions` is the list behind it,
one row per piece of work, each row naming its stage and how long it
has sat there.

The stage vocabulary is `api.core.submission_stage`, shared with the
submission trace so a row and the case file it opens cannot disagree.

## Deliberately not here

The photos. `submissions.files` holds base64 inline, so a list endpoint
that returned them would run to megabytes per page, and a bulk
disclosure of student work is exactly what the FERPA logging in
`admin_extraction_quality.extraction_detail` exists to keep narrow. The
list returns `files_count`; the strokes stay one-submission-at-a-time
behind that logged drill-in.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.core.submission_stage import (
    STAGE_ORDER,
    has_content_expr,
    stage_for,
    stage_since,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.grading_job import GradingJob
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.session import Session
from api.models.user import User

router = APIRouter()


async def _load_student(db: AsyncSession, student_id: uuid.UUID) -> User:
    """Fetch the user, 404ing unless they are actually a student.

    A typo'd UUID must not return an empty-but-valid case file, and a
    teacher id pointed at this page would render a roster of their own
    submissions — which is a different, already-existing page.
    """
    student = (await db.execute(
        select(User).where(User.id == student_id)
    )).scalar_one_or_none()
    if student is None or student.role != "student":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found",
        )
    return student


async def _log_read(
    db: AsyncSession,
    current_user: CurrentUser,
    student_id: uuid.UUID,
    record_type: str,
    request: Request,
) -> None:
    """FERPA: an admin just read one named student's record.

    Both endpoints return a named student's grades — every `ai_score`,
    `final_score`, grading stamp and integrity disposition they have.
    `teacher_grades.student_grades` logs exactly that disclosure with
    the comment "a teacher just read one student's full grade record",
    and an admin reading any student in any school is wider than a
    teacher reading their own roster, so it is logged at least as
    carefully.

    Authorization is already settled by `require_admin` and
    `_load_student`.

    CALL THIS LAST, after every ORM attribute the handler needs has been
    read into plain values. The helper swallows its own exceptions, but
    it recovers with `db.rollback()` (audit_log.py:100), and a rollback
    expires every object in the identity map — `expire_on_commit=False`
    does not cover it. Touching a lazily-expired attribute afterwards
    triggers a refresh inside the async handler and raises
    `MissingGreenlet`, turning an authorized 200 into a 500 on the one
    path that was supposed to be unable to break the read.

    Logging last also means a handler that dies before returning logs
    nothing — correct, because nothing was disclosed.
    """
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=student_id,
        record_type=record_type,
        request=request,
    )


def _stage_columns() -> list[Any]:
    """The columns `stage_for` needs, in one place.

    Both endpoints derive the stage in Python rather than in a SQL CASE.
    That costs a few extra selected columns and buys the guarantee that
    the funnel counts and the table rows can never disagree — two
    implementations of a seven-branch rule is exactly the kind of drift
    that makes an admin page untrustworthy.

    `extraction` is deliberately reduced to a boolean here: it is a JSON
    blob holding the whole transcription, and selecting it for a funnel
    over a year of work would pull megabytes to answer a yes/no.
    """
    return [
        Submission.extraction.isnot(None).label("extraction_present"),
        Submission.extraction_confirmed_at,
        Submission.extraction_flagged_at,
        SubmissionGrade.graded_at,
        SubmissionGrade.grade_published_at,
        Assignment.integrity_check_enabled,
        Assignment.ai_grading_enabled,
    ]


def _stage_of(r: Any) -> str:
    # Both toggles are non-nullable columns reached through an INNER
    # join, so they are always real booleans here. That matters more
    # than it looks: the whole point of the stage rule is telling "AI
    # was switched off" apart from "a read was owed and vanished", and
    # a NULL arriving from an outer join would coerce to False and
    # report the second as the first — lost work rendered as a teacher's
    # setting. `submissions.assignment_id` is NOT NULL with ON DELETE
    # CASCADE, so an orphan submission cannot exist to produce one.
    return stage_for(
        extraction_present=bool(r.extraction_present),
        extraction_confirmed_at=r.extraction_confirmed_at,
        extraction_flagged_at=r.extraction_flagged_at,
        graded_at=r.graded_at,
        grade_published_at=r.grade_published_at,
        integrity_check_enabled=r.integrity_check_enabled,
        ai_grading_enabled=r.ai_grading_enabled,
    )


@router.get("/students/{student_id}")
async def student_detail(
    student_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Who this student is, whose classes they are in, and the funnel.

    The funnel is the point of the page. Counting submissions tells you
    a student is participating; counting how many of them reached a
    published grade tells you whether the product worked for them, and
    the shortfall is itemised by the hop it died on.
    """
    student = await _load_student(db, student_id)

    school: dict[str, str] | None = None
    if student.school_id:
        srow = (await db.execute(
            select(School.id, School.name, School.kind)
            .where(School.id == student.school_id)
        )).one_or_none()
        if srow:
            school = {"id": str(srow.id), "name": srow.name, "kind": srow.kind}

    # Sections the student sits in, each with the teacher who owns the
    # course — the "who do I email about this kid" column. A course can
    # have several teachers; the roster shows them all rather than
    # silently picking one.
    section_rows = (await db.execute(
        select(
            Section.id,
            Section.name,
            Course.id.label("course_id"),
            Course.name.label("course_name"),
            Course.subject,
        )
        .join(SectionEnrollment, SectionEnrollment.section_id == Section.id)
        .join(Course, Course.id == Section.course_id)
        .where(SectionEnrollment.student_id == student_id)
        .order_by(Section.name.asc())
    )).all()

    course_ids = [r.course_id for r in section_rows]
    teachers_by_course: dict[uuid.UUID, list[dict[str, str]]] = {}
    if course_ids:
        for cid, tid, tname in (await db.execute(
            select(CourseTeacher.course_id, User.id, User.name)
            .join(User, User.id == CourseTeacher.teacher_id)
            .where(CourseTeacher.course_id.in_(course_ids))
        )).all():
            teachers_by_course.setdefault(cid, []).append(
                {"id": str(tid), "name": tname}
            )

    sections = [
        {
            "id": str(r.id),
            "name": r.name,
            "course_id": str(r.course_id),
            "course_name": r.course_name,
            "subject": r.subject,
            "teachers": teachers_by_course.get(r.course_id, []),
        }
        for r in section_rows
    ]

    # The funnel. Every submission this student ever made, reduced to
    # the columns the stage rule reads. Unpaged on purpose: a funnel
    # over the first 25 rows is a lie, and the row is seven small
    # scalars, so a heavy year is still a few hundred of them.
    stage_rows = (await db.execute(
        select(*_stage_columns())
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .outerjoin(
            SubmissionGrade, SubmissionGrade.submission_id == Submission.id
        )
        .where(Submission.student_id == student_id)
    )).all()

    funnel = dict.fromkeys(STAGE_ORDER, 0)
    for r in stage_rows:
        funnel[_stage_of(r)] += 1

    since_30d = datetime.now(UTC) - timedelta(days=30)
    llm_stats = (await db.execute(
        select(
            func.count().label("call_count"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0).label("total_cost"),
        )
        .where(LLMCall.user_id == student_id, LLMCall.created_at >= since_30d)
    )).one()

    last_active = (await db.execute(
        select(func.max(Session.created_at))
        .where(Session.user_id == student_id)
    )).scalar()
    last_submitted = (await db.execute(
        select(func.max(Submission.submitted_at))
        .where(Submission.student_id == student_id)
    )).scalar()

    payload = {
        "student": {
            "id": str(student.id),
            "name": student.name,
            "email": student.email,
            "grade_level": student.grade_level,
            "role": student.role,
            "is_active": student.is_active,
            "registered": student.created_at.isoformat(),
            "school": school,
            "subscription_tier": student.subscription_tier,
            "subscription_status": student.subscription_status,
            # Two different questions, both asked on this page: when did
            # they last open the app, and when did they last hand
            # something in. A student who logs in daily and submits
            # nothing is a different problem from one who vanished.
            "last_active_at": last_active.isoformat() if last_active else None,
            "last_submitted_at": (
                last_submitted.isoformat() if last_submitted else None
            ),
            "call_count_30d": int(llm_stats.call_count),
            "total_cost_30d": round(float(llm_stats.total_cost), 6),
        },
        "sections": sections,
        "funnel": funnel,
        "total_submissions": len(stage_rows),
    }
    # Last, once nothing further touches the ORM — see `_log_read`.
    await _log_read(db, current_user, student_id, "student_case_file", request)
    return payload


@router.get("/students/{student_id}/submissions")
async def student_submissions(
    student_id: uuid.UUID,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Everything this student handed in, newest first.

    Each row carries its stage, when it entered that stage, and the
    numbers that say whether anything is wrong with it: how many model
    calls it caused, how many failed, and what the durable grading queue
    thinks it still owes. That last one matters because a submission can
    be confirmed, have zero LLM calls, and be entirely healthy — the job
    is queued for a due date that has not arrived.
    """
    await _load_student(db, student_id)

    total = (await db.execute(
        select(func.count())
        .select_from(Submission)
        .where(Submission.student_id == student_id)
    )).scalar() or 0

    student_submission_ids = (
        select(Submission.id).where(Submission.student_id == student_id)
    )

    # Calls per submission, bounded to this student's rows. The bound is
    # load-bearing: without it the planner scans and aggregates the whole
    # of `llm_calls` — the fastest-growing table in the schema — before
    # joining the handful it needs. Same shape as the teacher panel's
    # subquery, for the same reason.
    calls_sq = (
        select(
            LLMCall.submission_id.label("submission_id"),
            func.count().label("call_count"),
            func.count()
            .filter(LLMCall.success.is_(False))
            .label("failed_count"),
        )
        .where(LLMCall.submission_id.in_(student_submission_ids))
        .group_by(LLMCall.submission_id)
        .subquery()
    )

    rows = (await db.execute(
        select(
            Submission.id,
            Submission.status,
            Submission.submitted_at,
            Submission.is_late,
            Submission.extraction_edited_at,
            Assignment.id.label("assignment_id"),
            Assignment.title.label("assignment_title"),
            Assignment.type.label("assignment_type"),
            Assignment.due_at,
            Course.name.label("course_name"),
            Course.subject,
            SubmissionGrade.ai_score,
            SubmissionGrade.final_score,
            SubmissionGrade.ai_grading_status,
            SubmissionGrade.reviewed_at,
            IntegrityCheckSubmission.status.label("integrity_status"),
            IntegrityCheckSubmission.disposition.label(
                "integrity_disposition"
            ),
            GradingJob.status.label("grading_job_status"),
            GradingJob.attempts.label("grading_job_attempts"),
            GradingJob.last_error.label("grading_job_error"),
            GradingJob.scheduled_for.label("grading_job_scheduled_for"),
            func.coalesce(func.json_array_length(Submission.files), 0)
            .label("files_count"),
            # Zero here means Vision ran and read nothing — a distinct
            # outcome from "no read yet", and one a student can confirm
            # their way past.
            #
            # Both coalesce to 0, so a NULL `extraction` also yields 0 and
            # is INDISTINGUISHABLE from a read that found nothing at this
            # level. `_row` is what separates them, by testing
            # `extraction_present` first — do not drop that guard, or
            # every never-read submission reports "read nothing" in
            # danger red and the one distinction this module exists to
            # preserve collapses.
            has_content_expr().label("read_rows"),
            func.coalesce(calls_sq.c.call_count, 0).label("call_count"),
            func.coalesce(calls_sq.c.failed_count, 0).label("failed_count"),
            *_stage_columns(),
        )
        .select_from(Submission)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .outerjoin(Course, Course.id == Assignment.course_id)
        .outerjoin(
            SubmissionGrade, SubmissionGrade.submission_id == Submission.id
        )
        .outerjoin(
            IntegrityCheckSubmission,
            IntegrityCheckSubmission.submission_id == Submission.id,
        )
        .outerjoin(GradingJob, GradingJob.submission_id == Submission.id)
        .outerjoin(calls_sq, calls_sq.c.submission_id == Submission.id)
        .where(Submission.student_id == student_id)
        .order_by(
            Submission.submitted_at.desc(),
            # Unique final key so OFFSET paging is stable. `submitted_at`
            # ties freely — a class handing in together, or a seeded
            # batch — and without a total order tied rows may sort
            # differently per query, so a page can repeat or skip one.
            # Same guard `admin_extraction_quality` applies to its list
            # for the same reason.
            Submission.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )).all()

    def _row(r: Any) -> dict[str, Any]:
        stage = _stage_of(r)
        entered = stage_since(
            stage,
            submitted_at=r.submitted_at,
            extraction_confirmed_at=r.extraction_confirmed_at,
            extraction_flagged_at=r.extraction_flagged_at,
            graded_at=r.graded_at,
            grade_published_at=r.grade_published_at,
        )
        # "Overridden" needs BOTH scores present: a submission the
        # teacher graded by hand with no AI attempt has a final_score
        # and no ai_score, and calling that a disagreement would invent
        # a defect out of the AI never having run.
        overridden = (
            r.ai_score is not None
            and r.final_score is not None
            and r.ai_score != r.final_score
        )
        return {
            "id": str(r.id),
            "status": r.status,
            "stage": stage,
            "stage_since": entered.isoformat() if entered else None,
            "submitted_at": (
                r.submitted_at.isoformat() if r.submitted_at else None
            ),
            "is_late": r.is_late,
            "due_at": r.due_at.isoformat() if r.due_at else None,
            "assignment_id": (
                str(r.assignment_id) if r.assignment_id else None
            ),
            "assignment_title": r.assignment_title,
            "assignment_type": r.assignment_type,
            "course_name": r.course_name,
            "subject": r.subject,
            "files_count": int(r.files_count or 0),
            "extraction_present": bool(r.extraction_present),
            # Null (not False) when no read exists — "the reader found
            # nothing" and "the reader has not run" are different
            # findings and the UI words them differently.
            "extraction_empty": (
                None if not r.extraction_present else int(r.read_rows or 0) == 0
            ),
            "extraction_edited": r.extraction_edited_at is not None,
            "confirmed_at": (
                r.extraction_confirmed_at.isoformat()
                if r.extraction_confirmed_at else None
            ),
            "flagged_at": (
                r.extraction_flagged_at.isoformat()
                if r.extraction_flagged_at else None
            ),
            "ai_score": r.ai_score,
            "final_score": r.final_score,
            "overridden": overridden,
            "ai_grading_status": r.ai_grading_status,
            "reviewed_at": (
                r.reviewed_at.isoformat() if r.reviewed_at else None
            ),
            "graded_at": r.graded_at.isoformat() if r.graded_at else None,
            "grade_published_at": (
                r.grade_published_at.isoformat()
                if r.grade_published_at else None
            ),
            "integrity_status": r.integrity_status,
            "integrity_disposition": r.integrity_disposition,
            "grading_job": (
                {
                    "status": r.grading_job_status,
                    "attempts": int(r.grading_job_attempts or 0),
                    "last_error": r.grading_job_error,
                    "scheduled_for": (
                        r.grading_job_scheduled_for.isoformat()
                        if r.grading_job_scheduled_for else None
                    ),
                }
                if r.grading_job_status else None
            ),
            "call_count": int(r.call_count),
            "failed_count": int(r.failed_count),
        }

    payload = {"total": int(total), "submissions": [_row(r) for r in rows]}
    # Last, once nothing further touches the ORM — see `_log_read`.
    await _log_read(db, current_user, student_id, "student_submissions", request)
    return payload
