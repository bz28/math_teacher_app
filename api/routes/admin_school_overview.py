"""Per-school overview endpoint.

Feeds the dashboard's `/schools/:id` deep page. Scoped tightly to
operator concerns (finance + monitor + debug):

  * Cost — this month, last month, projection, 12-week trend.
  * Activity — counts of active classes/teachers/students plus HWs
    published and submissions, this week vs last.
  * Health — failed LLM call counts (24h + 7d).

Things deliberately dropped from the previous version (top spender
teachers/classes, by-function cost breakdown, AI override rate,
integrity disposition mix, unreadable-per-teacher) were product
intel — interesting but not actionable at the operator level. We can
add them back when we have a use case.

The `school_id` path segment can be a real school UUID or the literal
`internal` sentinel — the latter scopes to LLMCall rows where
`school_id IS NULL`. Post-bp1000059 every teacher/student is linked
to a school (institutional or synthetic individual), so the
`internal` bucket is now just admin/system calls plus the legacy
pre-backfill rows from indie teachers (LLMCall.school_id is a
snapshot, not refreshed by the migration). To inspect an indie
teacher's activity, navigate to their individual school's overview
by id. Activity counts come back zeroed for `internal` since no
submissions exist outside a school context; cost + failed-call tiles
still work.
"""

import calendar
import uuid as uuid_lib
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL

router = APIRouter()


def _month_window(now: datetime) -> tuple[datetime, datetime, datetime]:
    """Return (this_month_start, last_month_start, this_month_end_exclusive)."""
    this_month_start = now.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0,
    )
    if this_month_start.month == 1:
        last_month_start = this_month_start.replace(
            year=this_month_start.year - 1, month=12,
        )
    else:
        last_month_start = this_month_start.replace(
            month=this_month_start.month - 1,
        )
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    this_month_end = this_month_start + timedelta(days=days_in_month)
    return this_month_start, last_month_start, this_month_end


def _llm_school_filter(school_id: str) -> Any:
    """Build the LLMCall filter for a scope-id (real UUID or 'internal')."""
    if school_id == INTERNAL_SCHOOL_SENTINEL:
        return LLMCall.school_id.is_(None)
    return LLMCall.school_id == school_id


@router.get("/schools/{school_id}/overview")
async def school_overview(
    school_id: str = Path(..., description="School UUID or 'internal'"),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    is_internal = school_id == INTERNAL_SCHOOL_SENTINEL

    # Resolve the school name once so the page header is decided
    # server-side. 404 if the caller passed a bogus id — saves the
    # frontend from rendering "Loading…" forever on a typo URL.
    school_name: str
    if is_internal:
        school_name = "Internal (no-school)"
    else:
        # Reject malformed UUIDs up front so the lookup returns a
        # clean 404 instead of bubbling asyncpg's invalid-text-
        # representation error as a 500.
        try:
            uuid_lib.UUID(school_id)
        except ValueError as e:
            raise HTTPException(
                status_code=404, detail="School not found",
            ) from e
        row = (await db.execute(
            select(School.name).where(School.id == school_id)
        )).first()
        if row is None:
            raise HTTPException(status_code=404, detail="School not found")
        school_name = row.name

    now = datetime.now(UTC)
    this_month_start, last_month_start, this_month_end = _month_window(now)
    llm_school = _llm_school_filter(school_id)

    # ---------- Cost ----------
    this_month_cost = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            llm_school,
            LLMCall.created_at >= this_month_start,
        )
    )).scalar() or 0.0

    last_month_cost = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            llm_school,
            LLMCall.created_at >= last_month_start,
            LLMCall.created_at < this_month_start,
        )
    )).scalar() or 0.0

    # Rolling 30d cost (+ prior 30d) — the SAME window the Schools list
    # shows, so a school's KPI strip matches the number the operator
    # clicked in from. Distinct from the calendar-month breakdown below.
    cost_30d_start = now - timedelta(days=30)
    cost_60d_start = now - timedelta(days=60)
    cost_30d = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            llm_school,
            LLMCall.created_at >= cost_30d_start,
        )
    )).scalar() or 0.0
    cost_prev_30d = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(
            llm_school,
            LLMCall.created_at >= cost_60d_start,
            LLMCall.created_at < cost_30d_start,
        )
    )).scalar() or 0.0

    # Linear projection — this-month / days-elapsed × days-in-month.
    # Crude on day 1; the dashboard reads it as "if usage stays flat
    # for the rest of the month".
    days_elapsed = max((now - this_month_start).days + 1, 1)
    days_in_month = (this_month_end - this_month_start).days
    projected_month_end = this_month_cost / days_elapsed * days_in_month

    # 12-week sparkline. Buckets are stamped to the Monday of each
    # ISO week so the labels are stable across years.
    twelve_weeks_ago = (
        now - timedelta(days=now.weekday() + 7 * 11)
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    week_bucket = func.date_trunc("week", LLMCall.created_at).label("week")
    weekly_rows = (await db.execute(
        select(
            week_bucket,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
        )
        .where(llm_school, LLMCall.created_at >= twelve_weeks_ago)
        .group_by("week")
        .order_by("week")
    )).all()

    # ---------- Health (failed calls — works for both scopes) ----------
    failed_24h = (await db.execute(
        select(func.count()).select_from(LLMCall).where(
            llm_school,
            LLMCall.success.is_(False),
            LLMCall.created_at >= now - timedelta(hours=24),
        )
    )).scalar() or 0
    failed_7d = (await db.execute(
        select(func.count()).select_from(LLMCall).where(
            llm_school,
            LLMCall.success.is_(False),
            LLMCall.created_at >= now - timedelta(days=7),
        )
    )).scalar() or 0

    # ---------- Activity (week-over-week) ----------
    week_start = (
        now - timedelta(days=now.weekday())
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    last_week_start = week_start - timedelta(days=7)
    activity_this_week = await _activity_counts(
        db, school_id, week_start, week_start + timedelta(days=7), is_internal,
    )
    activity_last_week = await _activity_counts(
        db, school_id, last_week_start, week_start, is_internal,
    )

    # Last student-submission timestamp — the recency signal for the KPI
    # strip, mirroring the Schools list's last_activity_at. Internal
    # scope has no school submissions, so it stays null.
    last_activity_at: datetime | None = None
    last_active_at: datetime | None = None
    if not is_internal:
        last_activity_at = (await db.execute(
            select(func.max(Submission.submitted_at))
            .join(Section, Section.id == Submission.section_id)
            .join(Course, Course.id == Section.course_id)
            .where(Course.school_id == school_id)
        )).scalar()
        # Unified recency = max(last submission, last ActivityLog action)
        # for this school. Folds in teacher grade/publish actions that
        # leave no student submission, so the KPI strip's active/at-risk
        # reflects teacher activity too — not just student submissions.
        last_action_at = (await db.execute(
            select(func.max(ActivityLog.performed_at))
            .where(ActivityLog.school_id == school_id)
        )).scalar()
        candidates = [t for t in (last_activity_at, last_action_at) if t is not None]
        last_active_at = max(candidates) if candidates else None

    return {
        "school_id": school_id,
        "school_name": school_name,
        "is_internal": is_internal,
        "generated_at": now.isoformat(),
        "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
        # Prefer over last_activity_at for active/stale/dormant — folds in
        # teacher grade/publish actions that leave no student submission.
        "last_active_at": last_active_at.isoformat() if last_active_at else None,
        "cost": {
            "this_month": round(this_month_cost, 4),
            "last_month": round(last_month_cost, 4),
            "cost_30d": round(cost_30d, 4),
            "cost_prev_30d": round(cost_prev_30d, 4),
            "projected_month_end": round(projected_month_end, 4),
            "trend_12_weeks": [
                {
                    "week_start": r.week.date().isoformat() if r.week else None,
                    "cost": round(r.cost, 4),
                }
                for r in weekly_rows
            ],
        },
        "activity": {
            "this_week": activity_this_week,
            "last_week": activity_last_week,
        },
        "failed_calls_24h": failed_24h,
        "failed_calls_7d": failed_7d,
    }


async def _activity_counts(
    db: AsyncSession,
    school_id: str,
    window_start: datetime,
    window_end: datetime,
    is_internal: bool,
) -> dict[str, int]:
    """Compute weekly activity counts for one time window.

    Active counts derive from "did this entity show up in a
    submission this week". The internal scope has no school
    submissions, so everything comes back zero — the frontend
    hides this section in that case.
    """
    if is_internal:
        return {
            "active_classes": 0,
            "active_teachers": 0,
            "active_students": 0,
            "hws_published": 0,
            "submissions": 0,
        }

    active_classes = (await db.execute(
        select(func.count(func.distinct(Submission.section_id)))
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(
            Course.school_id == school_id,
            Submission.submitted_at >= window_start,
            Submission.submitted_at < window_end,
        )
    )).scalar() or 0

    active_teachers = (await db.execute(
        select(func.count(func.distinct(Assignment.teacher_id)))
        .join(Submission, Submission.assignment_id == Assignment.id)
        .join(Course, Course.id == Assignment.course_id)
        .where(
            Course.school_id == school_id,
            Submission.submitted_at >= window_start,
            Submission.submitted_at < window_end,
        )
    )).scalar() or 0

    active_students = (await db.execute(
        select(func.count(func.distinct(Submission.student_id)))
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(
            Course.school_id == school_id,
            Submission.submitted_at >= window_start,
            Submission.submitted_at < window_end,
        )
    )).scalar() or 0

    # "Published" = AssignmentSection.published_at is set in the
    # window. Dedupe assignment_id so an assignment fanned out to
    # multiple sections counts once.
    hws_published = (await db.execute(
        select(func.count(func.distinct(AssignmentSection.assignment_id)))
        .select_from(AssignmentSection)
        .join(Assignment, Assignment.id == AssignmentSection.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .where(
            Course.school_id == school_id,
            AssignmentSection.published_at >= window_start,
            AssignmentSection.published_at < window_end,
        )
    )).scalar() or 0

    submissions = (await db.execute(
        select(func.count())
        .select_from(Submission)
        .join(Section, Section.id == Submission.section_id)
        .join(Course, Course.id == Section.course_id)
        .where(
            Course.school_id == school_id,
            Submission.submitted_at >= window_start,
            Submission.submitted_at < window_end,
        )
    )).scalar() or 0

    return {
        "active_classes": active_classes,
        "active_teachers": active_teachers,
        "active_students": active_students,
        "hws_published": hws_published,
        "submissions": submissions,
    }
