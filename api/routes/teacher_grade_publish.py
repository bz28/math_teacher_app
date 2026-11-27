"""Releasing grades to students: the teacher's Publish."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import record_activity
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Submission, SubmissionGrade
from api.models.user import User
from api.routes.teacher_assignments import get_teacher_assignment

router = APIRouter()


class PublishGradesRequest(BaseModel):
    # When True, only grades the teacher stands behind (reviewed_at IS
    # NOT NULL — the explicit Approve on an AI grade, or a hand grade
    # with every problem scored) are released. The "publish only what I've checked" path the review-page
    # dialog offers alongside "Publish all". Default False preserves the
    # publish-everything behaviour.
    reviewed_only: bool = False


@router.post("/assignments/{assignment_id}/publish-grades")
async def publish_grades(
    assignment_id: uuid.UUID,
    body: PublishGradesRequest | None = None,
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

    When `reviewed_only` is set, the eligible set is further narrowed to
    grades the teacher has vetted (reviewed_at IS NOT NULL), so the
    AI-suggested grades they never opened stay unpublished.
    """
    reviewed_only = bool(body and body.reviewed_only)
    a = await get_teacher_assignment(db, assignment_id, current_user.user_id)
    # Grades are only visible to students once the HW itself is
    # published. Publishing grades on a draft HW would orphan them
    # (student has no view of the HW to show the grade on), so reject.
    if a.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish grades on a draft homework",
        )

    # Preview shadows are deliberately NOT filtered here, unlike every
    # count on this page. A teacher's rehearsal runs the whole pipeline
    # — extraction, integrity, grading — and then stopped dead: the
    # grade existed and nothing could ever set grade_published_at on it,
    # so the student view she was checking never showed a score. This is
    # the only writer of that column, so the release sweep has to
    # include her or the back half of the loop is unreachable. Only she
    # can see the result; the graded/published counts and the gradebook
    # still filter her out.
    stmt = (
        select(SubmissionGrade, User.is_preview)
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.assignment_id == a.id,
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
    )
    if reviewed_only:
        stmt = stmt.where(SubmissionGrade.reviewed_at.is_not(None))
    rows = (await db.execute(stmt)).all()

    now = datetime.now(UTC)
    for g, _is_preview in rows:
        g.published_final_score = g.final_score
        g.published_late_penalty = g.late_penalty
        g.published_breakdown = g.breakdown
        g.published_teacher_notes = g.teacher_notes
        g.grade_published_at = now

    # The teacher's own rehearsal is released alongside the class — it
    # has to be, or she can never see the score on the student view she
    # was checking. But it is not a grade that went out to anybody, so
    # the number reported back and written to the audit log counts only
    # her students' grades.
    published_count = sum(1 for _, is_preview in rows if not is_preview)

    await record_activity(
        db, current_user, "grade.publish", "assignment", a.id,
        {
            "published_count": published_count,
            # published_count counts grades that went to students; a
            # rehearsal of the teacher's own is released in the same
            # sweep, so record what was actually written too or the
            # audit trail disagrees with the rows.
            "rows_written": len(rows),
            "reviewed_only": reviewed_only,
        },
    )
    await db.commit()
    return {"status": "ok", "published_count": published_count}
