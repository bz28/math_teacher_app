"""Per-school Overview tile aggregations.

Single endpoint feeding the dashboard's school-scope Overview page —
cost row, top spenders, quality row, and health row. Kept in one
endpoint rather than four to keep the page's loading state simple.

The `school_id` path segment can be either a real school UUID or the
literal `internal` sentinel — the latter scopes to LLMCall rows where
`school_id IS NULL` (the founder, test accounts, and any non-school
learners). Tiles that only make sense for real schools (top classes,
top teachers, integrity disposition) come back empty in the internal
scope; the frontend hides those cards. Cost / failed-call tiles still
work because LLMCall is the only table that meaningfully extends to
the no-school bucket.
"""

import calendar
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.llm_call import LLMCall
from api.models.school import School
from api.models.section import Section
from api.models.user import User

router = APIRouter()

INTERNAL_SCHOOL_SENTINEL = "internal"


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
        row = (await db.execute(
            select(School.name).where(School.id == school_id)
        )).first()
        if row is None:
            raise HTTPException(status_code=404, detail="School not found")
        school_name = row.name

    now = datetime.now(UTC)
    this_month_start, last_month_start, this_month_end = _month_window(now)
    llm_school = _llm_school_filter(school_id)

    # ---------- Cost row ----------
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

    # Linear projection — this-month / days-elapsed × days-in-month.
    # Crude on day 1 (one day of data implies the full month at that
    # rate) but the dashboard only shows the number after a meaningful
    # window has elapsed; teachers will read it as "if usage stays
    # flat".
    days_elapsed = max((now - this_month_start).days + 1, 1)
    days_in_month = (this_month_end - this_month_start).days
    projected_month_end = this_month_cost / days_elapsed * days_in_month

    # By-function breakdown for the stacked bar.
    by_function_rows = (await db.execute(
        select(
            LLMCall.function,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
            func.count().label("count"),
        )
        .where(llm_school, LLMCall.created_at >= this_month_start)
        .group_by(LLMCall.function)
        .order_by(func.sum(LLMCall.cost_usd).desc())
    )).all()

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

    # Cost per submission (this month, school-wide).
    distinct_subs_this_month = (await db.execute(
        select(func.count(func.distinct(LLMCall.submission_id))).where(
            llm_school,
            LLMCall.created_at >= this_month_start,
            LLMCall.submission_id.isnot(None),
        )
    )).scalar() or 0
    cost_per_submission = (
        this_month_cost / distinct_subs_this_month
        if distinct_subs_this_month
        else 0.0
    )

    # ---------- Top spenders ----------
    # The internal scope has no class/teacher/integrity surface — those
    # tables only exist for school users — so skip the joins and return
    # empty arrays. The frontend renders the "no data" state.
    top_classes: list[dict[str, Any]] = []
    top_teachers: list[dict[str, Any]] = []
    top_submissions_this_week: list[dict[str, Any]] = []
    integrity_disposition: list[dict[str, Any]] = []
    ai_override_rate: float | None = None
    unreadable_per_teacher: list[dict[str, Any]] = []

    week_start = (
        now - timedelta(days=now.weekday())
    ).replace(hour=0, minute=0, second=0, microsecond=0)

    if not is_internal:
        # Top 5 classes by spend this month. We go LLMCall → Submission →
        # Section → Course so we can present the section name + course
        # name (a class is "Algebra I · Period 3" not just "Period 3").
        top_classes_rows = (await db.execute(
            select(
                Section.id.label("section_id"),
                Section.name.label("section_name"),
                Course.name.label("course_name"),
                func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
            )
            .join(Submission, Submission.id == LLMCall.submission_id)
            .join(Section, Section.id == Submission.section_id)
            .join(Course, Course.id == Section.course_id)
            .where(
                llm_school,
                LLMCall.created_at >= this_month_start,
            )
            .group_by(Section.id, Section.name, Course.name)
            .order_by(func.sum(LLMCall.cost_usd).desc())
            .limit(5)
        )).all()
        top_classes = [
            {
                "section_id": str(r.section_id),
                "section_name": r.section_name,
                "course_name": r.course_name,
                "cost": round(r.cost, 4),
            }
            for r in top_classes_rows
        ]

        # Top 5 teachers by spend this month — Assignment.teacher_id is
        # the source of truth for "who owns this HW", so we group by it.
        top_teachers_rows = (await db.execute(
            select(
                User.id.label("teacher_id"),
                User.name.label("teacher_name"),
                User.email.label("teacher_email"),
                func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
            )
            .join(Submission, Submission.id == LLMCall.submission_id)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .join(User, User.id == Assignment.teacher_id)
            .where(
                llm_school,
                LLMCall.created_at >= this_month_start,
            )
            .group_by(User.id, User.name, User.email)
            .order_by(func.sum(LLMCall.cost_usd).desc())
            .limit(5)
        )).all()
        top_teachers = [
            {
                "teacher_id": str(r.teacher_id),
                "teacher_name": r.teacher_name or r.teacher_email,
                "teacher_email": r.teacher_email,
                "cost": round(r.cost, 4),
            }
            for r in top_teachers_rows
        ]

        # Top 5 most expensive submissions this week — drives the
        # flight-recorder drill-down (PR E). Until then the row at
        # least surfaces the offender by id.
        top_subs_rows = (await db.execute(
            select(
                LLMCall.submission_id,
                func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("cost"),
                func.count().label("call_count"),
            )
            .where(
                llm_school,
                LLMCall.created_at >= week_start,
                LLMCall.submission_id.isnot(None),
            )
            .group_by(LLMCall.submission_id)
            .order_by(func.sum(LLMCall.cost_usd).desc())
            .limit(5)
        )).all()
        top_submissions_this_week = [
            {
                "submission_id": str(r.submission_id),
                "cost": round(r.cost, 4),
                "call_count": r.call_count,
            }
            for r in top_subs_rows
        ]

        # ---------- Quality row ----------
        # Integrity disposition mix — count IntegrityCheckSubmission
        # rows joined to the school via submission → section → course.
        # `skipped_unreadable` lives on `status`, not `disposition`, so
        # we union the two columns into one bucket label for the bar.
        bucket = case(
            (
                IntegrityCheckSubmission.status == "skipped_unreadable",
                "skipped_unreadable",
            ),
            else_=IntegrityCheckSubmission.disposition,
        ).label("bucket")
        disposition_rows = (await db.execute(
            select(
                bucket,
                func.count().label("count"),
            )
            .join(Submission, Submission.id == IntegrityCheckSubmission.submission_id)
            .join(Section, Section.id == Submission.section_id)
            .join(Course, Course.id == Section.course_id)
            .where(Course.school_id == school_id)
            .group_by("bucket")
        )).all()
        integrity_disposition = [
            {"disposition": r.bucket or "unknown", "count": r.count}
            for r in disposition_rows
        ]

        # AI override rate: of teacher-reviewed grades, how many had
        # final_score != ai_score. Both columns nullable; require
        # non-null on both so we don't count "teacher reviewed but AI
        # never ran" as an override.
        override_stats = (await db.execute(
            select(
                func.count().label("reviewed"),
                func.sum(
                    case(
                        (SubmissionGrade.final_score != SubmissionGrade.ai_score, 1),
                        else_=0,
                    )
                ).label("overrides"),
            )
            .join(Submission, Submission.id == SubmissionGrade.submission_id)
            .join(Section, Section.id == Submission.section_id)
            .join(Course, Course.id == Section.course_id)
            .where(
                Course.school_id == school_id,
                SubmissionGrade.reviewed_by.isnot(None),
                SubmissionGrade.ai_score.isnot(None),
                SubmissionGrade.final_score.isnot(None),
            )
        )).first()
        if override_stats and override_stats.reviewed:
            ai_override_rate = round(
                (override_stats.overrides or 0) / override_stats.reviewed, 4,
            )
        else:
            ai_override_rate = None

        # Unreadable rate per teacher: of submissions on each teacher's
        # HWs, what fraction had the integrity check flip to
        # `skipped_unreadable`. Sort desc so the worst teachers
        # surface first; cap at 10.
        unreadable_rows = (await db.execute(
            select(
                User.id.label("teacher_id"),
                User.name.label("teacher_name"),
                User.email.label("teacher_email"),
                func.count(Submission.id).label("total_subs"),
                func.sum(
                    case(
                        (
                            IntegrityCheckSubmission.status == "skipped_unreadable",
                            1,
                        ),
                        else_=0,
                    )
                ).label("unreadable"),
            )
            .select_from(Assignment)
            .join(User, User.id == Assignment.teacher_id)
            .join(Submission, Submission.assignment_id == Assignment.id)
            .join(Course, Course.id == Assignment.course_id)
            .outerjoin(
                IntegrityCheckSubmission,
                IntegrityCheckSubmission.submission_id == Submission.id,
            )
            .where(Course.school_id == school_id)
            .group_by(User.id, User.name, User.email)
            .having(func.count(Submission.id) > 0)
            .order_by(
                (func.coalesce(func.sum(case(
                    (IntegrityCheckSubmission.status == "skipped_unreadable", 1),
                    else_=0,
                )), 0) * 1.0 / func.count(Submission.id)).desc()
            )
            .limit(10)
        )).all()
        unreadable_per_teacher = [
            {
                "teacher_id": str(r.teacher_id),
                "teacher_name": r.teacher_name or r.teacher_email,
                "total_submissions": r.total_subs,
                "unreadable_count": int(r.unreadable or 0),
                "rate": round(
                    (r.unreadable or 0) / r.total_subs, 4,
                ) if r.total_subs else 0.0,
            }
            for r in unreadable_rows
        ]

    # Failed LLM calls — simple count, works in both real-school and
    # internal scopes.
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

    return {
        "school_id": school_id,
        "school_name": school_name,
        "is_internal": is_internal,
        "generated_at": now.isoformat(),
        "cost": {
            "this_month": round(this_month_cost, 4),
            "last_month": round(last_month_cost, 4),
            "projected_month_end": round(projected_month_end, 4),
            "cost_per_submission": round(cost_per_submission, 4),
            "by_function": [
                {
                    "function": r.function,
                    "cost": round(r.cost, 4),
                    "count": r.count,
                }
                for r in by_function_rows
            ],
            "trend_12_weeks": [
                {
                    "week_start": r.week.date().isoformat() if r.week else None,
                    "cost": round(r.cost, 4),
                }
                for r in weekly_rows
            ],
        },
        "top_spenders": {
            "classes": top_classes,
            "teachers": top_teachers,
            "submissions_this_week": top_submissions_this_week,
        },
        "quality": {
            "integrity_disposition": integrity_disposition,
            "ai_override_rate": ai_override_rate,
            "unreadable_per_teacher": unreadable_per_teacher,
            "failed_calls_24h": failed_24h,
            "failed_calls_7d": failed_7d,
        },
    }
