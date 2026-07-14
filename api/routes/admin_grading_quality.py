"""Admin "AI Grading Quality" report.

Read-only analytics over data we already store. Surfaces where teachers
*override* the AI's grades so we can see where grading is weak — the
override rate, the direction of the bias (too harsh vs too generous), the
status-change matrix, and a breakdown by subject and course. A companion
drill-in (``/grading-quality/overrides``) returns the actual overridden
cases behind any weak row or catastrophic status cell.

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
averages, or per-problem AI-vs-teacher score pairs — never an individual
student's identity or their written work.
"""

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Row, func, or_, select
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


def _unreadable_ok() -> Any:
    """Filter: exclude grades skipped as unreadable (no trustworthy AI
    grade to override)."""
    return or_(
        SubmissionGrade.ai_grading_status.is_(None),
        SubmissionGrade.ai_grading_status != GRADING_STATUS_SKIPPED_UNREADABLE,
    )


# The moment the override "happened" — when the teacher last reviewed,
# falling back to publish time for a grade published without an explicit
# review stamp. Drives the time-window filter and the trend.
_EFFECTIVE_AT = func.coalesce(
    SubmissionGrade.reviewed_at, SubmissionGrade.grade_published_at
)


async def _reviewed_rows(
    db: AsyncSession,
    since: Any,
    subject: str | None,
    course: str | None = None,
) -> list[Row[Any]]:
    """The eligible reviewed/published AI grades in-window, one row per
    submission grade: (ai_breakdown, breakdown, effective_at, subject,
    course name). Shared by the summary report and the drill-in so both
    read the exact same population."""
    filters = [
        or_(
            SubmissionGrade.reviewed_at.is_not(None),
            SubmissionGrade.grade_published_at.is_not(None),
        ),
        SubmissionGrade.ai_breakdown.is_not(None),
        SubmissionGrade.breakdown.is_not(None),
        _unreadable_ok(),
        _EFFECTIVE_AT >= since,
    ]
    if subject:
        filters.append(Course.subject == subject)
    if course:
        filters.append(Course.name == course)

    return list((await db.execute(
        select(
            SubmissionGrade.ai_breakdown,
            SubmissionGrade.breakdown,
            _EFFECTIVE_AT.label("at"),
            Course.subject,
            Course.name,
        )
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .where(*filters)
    )).all())


@router.get("/grading-quality")
async def grading_quality(
    hours: int = Query(default=2160, ge=1, le=87600),
    subject: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)
    rows = await _reviewed_rows(db, since, subject)

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

    # Review coverage — the denominator for trust. Of every AI grade the
    # model *produced* in this window (by graded_at), what fraction did a
    # teacher actually review or publish? The override stats above only
    # speak for that reviewed slice; the rest is ungraded-by-a-human.
    # Counted independently over `graded_at` so the numerator is always a
    # subset of the denominator (coverage can never exceed 100%).
    coverage = await _coverage_counts(db, since, subject)
    summary["ai_graded_submissions"] = coverage["total"]
    summary["reviewed_ai_grades"] = coverage["reviewed"]

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


async def _coverage_counts(
    db: AsyncSession, since: Any, subject: str | None
) -> dict[str, int]:
    """Count AI grades produced in-window and how many a teacher reviewed.

    Denominator = every submission the AI actually graded (``ai_breakdown``
    present, not skipped-unreadable) with ``graded_at`` in the window.
    Numerator = the subset a teacher reviewed or published. Keyed on
    ``graded_at`` for both so the numerator is always ⊆ the denominator.
    """
    filters = [
        SubmissionGrade.ai_breakdown.is_not(None),
        _unreadable_ok(),
        SubmissionGrade.graded_at.is_not(None),
        SubmissionGrade.graded_at >= since,
    ]
    if subject:
        filters.append(Course.subject == subject)

    row = (await db.execute(
        select(
            func.count().label("total"),
            func.count().filter(
                or_(
                    SubmissionGrade.reviewed_at.is_not(None),
                    SubmissionGrade.grade_published_at.is_not(None),
                )
            ).label("reviewed"),
        )
        .select_from(SubmissionGrade)
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .where(*filters)
    )).one()
    return {"total": int(row.total or 0), "reviewed": int(row.reviewed or 0)}


# The most cases a single drill-in returns. A weak row or a catastrophic
# cell is for eyeballing patterns, not exporting a ledger — cap it so a
# huge population can't balloon the payload. Biggest misgrades come first,
# so the cap keeps the ones that matter.
_DRILL_LIMIT = 100


@router.get("/grading-quality/overrides")
async def grading_quality_overrides(
    hours: int = Query(default=2160, ge=1, le=87600),
    subject: str | None = Query(default=None),
    course: str | None = Query(default=None),
    from_status: str | None = Query(default=None),
    to_status: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The actual overridden problems behind a weak subject/course row or a
    catastrophic status cell.

    Filter by ``subject`` and/or ``course`` (a weak-spot row) and/or a
    ``from_status``→``to_status`` transition (a status-matrix cell). Each
    case carries the AI's original call, the teacher's final call, and the
    signed delta — no student identity or written work. Sorted by change
    size (biggest misgrades first) and capped at ``_DRILL_LIMIT``.
    """
    since = time_range(hours)
    rows = await _reviewed_rows(db, since, subject, course)

    cases: list[dict[str, Any]] = []
    for ai_breakdown, breakdown, at, subj, course_name in rows:
        deltas = compare_grade(ai_breakdown, breakdown)
        if deltas is None:
            continue
        day = at.date().isoformat() if at is not None else None
        subj = subj or "unknown"
        course_name = course_name or "Untitled course"
        for d in deltas:
            if not d.is_override:
                continue
            if from_status and d.ai_status != from_status:
                continue
            if to_status and d.final_status != to_status:
                continue
            cases.append(
                {
                    "subject": subj,
                    "course": course_name,
                    "day": day,
                    "ai_status": d.ai_status,
                    "ai_percent": d.ai_percent,
                    "final_status": d.final_status,
                    "final_percent": d.final_percent,
                    "delta": d.delta,
                }
            )

    # Biggest misgrades first — a full↔zero flip outranks a 5-point nudge.
    cases.sort(key=lambda c: abs(c["delta"]), reverse=True)
    total = len(cases)
    return {
        "cases": cases[:_DRILL_LIMIT],
        "total_count": total,
        "truncated": total > _DRILL_LIMIT,
    }
