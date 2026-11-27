"""The Submissions inbox: per-(homework × section) counts of turned-in
work and what's waiting on the teacher. Split out of teacher_assignments."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import Integer, and_, case, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import flagged_case, get_teacher_course

router = APIRouter()


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
        published, to_publish }

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
    is_dirty = (SubmissionGrade.grade_published_at.is_not(None)) & (
        SubmissionGrade.final_score.is_distinct_from(
            SubmissionGrade.published_final_score,
        )
        | SubmissionGrade.teacher_notes.is_distinct_from(
            SubmissionGrade.published_teacher_notes,
        )
        | SubmissionGrade.breakdown.cast(JSONB).is_distinct_from(
            SubmissionGrade.published_breakdown.cast(JSONB),
        )
    )
    dirty_expr = func.sum(case((is_dirty, 1), else_=0)).cast(Integer).label("dirty")
    # Of the grades waiting to go out, the ones already approved — a hand
    # grade, an Approve ✓, or an approved grade edited since — so only
    # Publish is left. The rest still want Approve ✓.
    to_publish_expr = func.sum(
        case(
            (
                SubmissionGrade.final_score.is_not(None)
                & SubmissionGrade.reviewed_at.is_not(None)
                & (SubmissionGrade.grade_published_at.is_(None) | is_dirty),
                1,
            ),
            else_=0,
        ),
    ).cast(Integer).label("to_publish")
    published_expr = func.sum(
        case(
            (SubmissionGrade.grade_published_at.is_not(None), 1),
            else_=0,
        ),
    ).cast(Integer).label("published")
    # "Flagged" = the one shared definition (teacher_courses.flagged_case),
    # so this inbox, the courses dashboard, the needs-attention queue and
    # the review page's Flagged filter all count the same rows.
    flagged_expr = func.sum(flagged_case()).cast(Integer).label("flagged")

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
            to_publish_expr,
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
            "to_publish": int(r.to_publish or 0),
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
            "to_publish": counts.get("to_publish", 0),
        })
    return {"rows": rows}
