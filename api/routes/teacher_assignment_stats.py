"""Per-homework submission and grading counts for the teacher's
homework list and detail (`total_students`, `submitted`, `published`, …).

Moved out of teacher_assignments.py, which is far past the size where
it's easy to change safely."""

import uuid
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.assignment import AssignmentSection, Submission, SubmissionGrade
from api.models.question_bank import QuestionBankItem
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User

EMPTY_STATS: dict[str, Any] = {
    "total_students": 0,
    "submitted": 0,
    "graded": 0,
    "to_review": 0,
    "published": 0,
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
    return (await bulk_assignment_stats(db, [assignment_id])).get(assignment_id, EMPTY_STATS)


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
    # grading signal. AI grading auto-sets it on submit whenever the
    # assignment has ai_grading_enabled (default true), so `graded` is
    # near-always true and no longer a useful progress signal on its
    # own — hence the to_review/published counts below. Same
    # SectionEnrollment guard as `submitted` above so the numerator
    # stays in scope with `total_students`.
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

    # 3b. To-review counts — submitted (non-preview) submissions whose
    # grade the teacher hasn't marked reviewed yet. LEFT JOIN so a
    # submission with no grade row also counts (reviewed_at reads NULL
    # for the missing row). `reviewed_at` is stamped by the teacher's
    # Approve on an AI grade, or by a hand grade covering every problem
    # — so this is the honest "still owes teacher review" signal, unlike
    # `graded` (final_score, set automatically on submit).
    to_review_rows = (await db.execute(
        select(Submission.assignment_id, func.count().label("c"))
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
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
            SubmissionGrade.reviewed_at.is_(None),
            User.is_preview.is_(False),
        )
        .group_by(Submission.assignment_id)
    )).all()
    to_review = {r.assignment_id: r.c for r in to_review_rows}

    # 3c. Published counts — submitted (non-preview) submissions whose
    # grade has been released to the student view (grade_published_at
    # set by "Publish grades"). Inner join: a missing grade row can
    # never satisfy grade_published_at IS NOT NULL.
    published_rows = (await db.execute(
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
            SubmissionGrade.grade_published_at.is_not(None),
            User.is_preview.is_(False),
        )
        .group_by(Submission.assignment_id)
    )).all()
    published = {r.assignment_id: r.c for r in published_rows}

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
            "to_review": to_review.get(aid, 0),
            "published": published.get(aid, 0),
            "pending_review": pending.get(aid, 0),
            "approved_count": approved.get(aid, 0),
            "avg_score": round(avgs[aid], 1) if aid in avgs and avgs[aid] is not None else None,
        }
    return out
