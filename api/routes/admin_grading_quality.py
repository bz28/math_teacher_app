"""Admin "AI Grading Quality" report.

Read-only analytics over data we already store. Surfaces where teachers
*override* the AI's grades so we can see where grading is weak — the
override rate, the direction of the bias (too harsh vs too generous), the
status-change matrix, and a breakdown by subject and course.

Override-detection + direction math live in
``api.services.grading_overrides`` (pure, unit-tested). This module is
the I/O shell: it pulls the eligible grade rows, hands each AI/teacher
breakdown pair to ``compare_grade``, and rolls the results up into the
report buckets.

Eligibility — only count grades a teacher genuinely reviewed or
published, never in-progress drafts:
- ``reviewed_at IS NOT NULL`` (the teacher edited a score, or explicitly
  vouched for the AI's call via mark-reviewed), OR ``grade_published_at
  IS NOT NULL``.
- The AI must have actually graded (``ai_breakdown`` present) and not been
  skipped as unreadable — those have no AI grade to override.

No student PII leaves the endpoint: outputs are aggregate counts and
averages, never an individual student's grade.
"""

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.grading_ai import GRADING_STATUS_SKIPPED_UNREADABLE
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.routes.admin_helpers import time_range
from api.services.grading_overrides import (
    ProblemDelta,
    compare_grade,
    status_matrix,
    summarize,
)

router = APIRouter()


@router.get("/grading-quality")
async def grading_quality(
    hours: int = Query(default=2160, ge=1, le=87600),
    subject: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)

    # The moment the override "happened" — when the teacher last reviewed,
    # falling back to publish time for a grade published without an
    # explicit review stamp. Drives the time-window filter and the trend.
    effective_at = func.coalesce(
        SubmissionGrade.reviewed_at, SubmissionGrade.grade_published_at
    )

    filters = [
        or_(
            SubmissionGrade.reviewed_at.is_not(None),
            SubmissionGrade.grade_published_at.is_not(None),
        ),
        SubmissionGrade.ai_breakdown.is_not(None),
        SubmissionGrade.breakdown.is_not(None),
        # Skipped-unreadable grades have no trustworthy AI grade — exclude.
        or_(
            SubmissionGrade.ai_grading_status.is_(None),
            SubmissionGrade.ai_grading_status != GRADING_STATUS_SKIPPED_UNREADABLE,
        ),
        effective_at >= since,
    ]
    if subject:
        filters.append(Course.subject == subject)

    rows = (await db.execute(
        select(
            SubmissionGrade.ai_breakdown,
            SubmissionGrade.breakdown,
            effective_at.label("at"),
            Course.subject,
            Course.name,
        )
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .where(*filters)
    )).all()

    all_deltas: list[ProblemDelta] = []
    by_subject: dict[str, list[ProblemDelta]] = defaultdict(list)
    by_course: dict[tuple[str, str], list[ProblemDelta]] = defaultdict(list)
    by_day: dict[str, list[ProblemDelta]] = defaultdict(list)
    reviewed_submissions = 0

    # Subjects the report covers — populated so the UI's subject filter
    # only ever offers subjects with data behind them.
    subjects_seen: set[str] = set()

    for ai_breakdown, breakdown, at, subj, course_name in rows:
        deltas = compare_grade(ai_breakdown, breakdown)
        if deltas is None:
            continue
        reviewed_submissions += 1
        day = at.date().isoformat() if at is not None else "unknown"
        subj = subj or "unknown"
        course_name = course_name or "Untitled course"
        subjects_seen.add(subj)
        all_deltas.extend(deltas)
        by_subject[subj].extend(deltas)
        by_course[(course_name, subj)].extend(deltas)
        by_day[day].extend(deltas)

    summary = summarize(all_deltas)
    summary["reviewed_submissions"] = reviewed_submissions

    # Subjects sorted by how weak the AI is there (highest override rate
    # first) — the lede an admin wants is "where is grading worst."
    subject_report = sorted(
        (
            {"subject": s, **summarize(ds)}
            for s, ds in by_subject.items()
        ),
        key=lambda r: r["override_rate"],
        reverse=True,
    )
    course_report = sorted(
        (
            {"course": name, "subject": subj, **summarize(ds)}
            for (name, subj), ds in by_course.items()
        ),
        key=lambda r: (r["override_rate"], r["graded_problems"]),
        reverse=True,
    )
    trend = [
        {"day": day, **summarize(by_day[day])}
        for day in sorted(by_day)
        if day != "unknown"
    ]

    return {
        "summary": summary,
        "status_matrix": status_matrix(all_deltas),
        "by_subject": subject_report,
        "by_course": course_report,
        "trend": trend,
        "subjects": sorted(subjects_seen),
    }
