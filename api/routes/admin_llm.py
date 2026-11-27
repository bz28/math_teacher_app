"""Admin LLM call analytics endpoint."""

import uuid as uuid_lib
from datetime import UTC, date, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Date, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from api.config import settings
from api.core.llm_attribution import calls_of, is_deleted_submission_call, school_calls
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.llm_call import LLMCall
from api.models.llm_payload import LLMPayload
from api.models.school import School
from api.models.user import User
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL, resolve_window

router = APIRouter()

# Cap each dispatched text field so client_payload stays well under GitHub's
# ~64KB repository_dispatch limit.
_DISPATCH_TEXT_CAP = 20000


def _escape_like(term: str) -> str:
    """Escape LIKE/ILIKE wildcards so a free-text search term matches
    literally — an operator searching for "50%" or "user_id" shouldn't get
    surprise wildcard behavior. Backslash first so we don't double-escape."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CallFilters:
    """Every filter the calls views take. All of them narrow the
    aggregates AND the list, so the strip above the table always
    describes exactly the rows below it.

    `hours` is the preset window; `from`/`to` (whole UTC days, inclusive)
    override it with a custom range. `user_id` is "made the call";
    `teacher_id` / `student_id` use the one whose-call rule
    (api/core/llm_attribution.py) — the same rule every per-level cost
    on the console reads.
    """

    def __init__(
        self,
        hours: int = Query(default=168, ge=1, le=8760),
        date_from: date | None = Query(default=None, alias="from"),
        date_to: date | None = Query(default=None, alias="to"),
        function: str | None = Query(default=None),
        model: str | None = Query(default=None),
        user_id: str | None = Query(default=None),
        teacher_id: str | None = Query(default=None),
        student_id: str | None = Query(default=None),
        assignment_id: str | None = Query(default=None),
        submission_id: str | None = Query(default=None),
        session_id: str | None = Query(default=None),
        school_id: str | None = Query(default=None),
        success: bool | None = Query(default=None),
        search: str | None = Query(default=None),
    ) -> None:
        # Reject malformed UUIDs up front so a typo in the URL surfaces
        # as a clean 400 rather than asyncpg's invalid-text-representation
        # bubbling out as a 500.
        for label, value in (
            ("user_id", user_id),
            ("teacher_id", teacher_id),
            ("student_id", student_id),
            ("assignment_id", assignment_id),
            ("submission_id", submission_id),
            ("session_id", session_id),
            ("school_id", None if school_id == INTERNAL_SCHOOL_SENTINEL else school_id),
        ):
            if value:
                try:
                    uuid_lib.UUID(value)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=f"invalid {label}") from e

        self.window = resolve_window(hours, date_from, date_to)
        in_window = self.window.covers(LLMCall.created_at)

        # WHERE the calls come from: the window and the school.
        place: list[Any] = [in_window]
        if school_id:
            # "internal" = calls stamped with no school (admin/system calls
            # and legacy pre-backfill rows).
            place.append(school_calls(
                None if school_id == INTERNAL_SCHOOL_SENTINEL else school_id,
            ))

        # WHOSE calls they are.
        who: list[Any] = []
        if user_id:
            who.append(LLMCall.user_id == user_id)
        for person in (teacher_id, student_id):
            if person:
                who.append(calls_of(person))
        if assignment_id:
            # One homework: every call on a submission handed in to it.
            who.append(LLMCall.submission_id.in_(
                select(Submission.id).where(Submission.assignment_id == assignment_id)
            ))
        if submission_id:
            # Per-submission flight recorder: every Vision, integrity and
            # grading call for one homework.
            who.append(LLMCall.submission_id == submission_id)
        if session_id:
            # Every call sharing one conversational session.
            who.append(LLMCall.session_id == session_id)

        # WHICH of those calls: the narrowing filters.
        which: list[Any] = []
        if function:
            which.append(LLMCall.function == function)
        if model:
            which.append(LLMCall.model == model)
        if success is not None:
            which.append(LLMCall.success.is_(success))
        if search:
            # Free-text search over the exact prompt in / response out.
            # %/_ are escaped so a search term reads as a literal.
            like = f"%{_escape_like(search)}%"
            which.append(or_(
                LLMCall.input_text.ilike(like, escape="\\"),
                LLMCall.output_text.ilike(like, escape="\\"),
            ))

        self.conditions = [*place, *who, *which]
        # The school the rail is scoped to, for the teacher picker: a
        # school id, the "internal" sentinel, or None for every school.
        self.school_scope = school_id
        # Dropdown options must not shrink to the current choice: the user
        # list spans the window and school, the function and model lists
        # everything but the narrowing filters.
        self.user_options = place
        self.option_scope = [*place, *who]
        self.submission_id = submission_id


async def call_summary(db: AsyncSession, conds: list[Any]) -> dict[str, Any]:
    """The compact picture of a set of calls, for the calls panel at every
    level (school, teacher, student, submission) and the Calls page strip.

    Latency percentiles are over SUCCESSFUL calls only, with their sample
    size: a failed call's latency is a timeout or an instant refusal, and
    mixing those in moves p95 for reasons that aren't speed.
    """
    totals = (await db.execute(
        select(
            func.count().label("calls"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("spend"),
            func.count().filter(LLMCall.success.is_(False)).label("failed"),
        ).where(*conds)
    )).one()
    latency = (await db.execute(
        select(
            func.percentile_cont(0.5).within_group(LLMCall.latency_ms.asc()).label("p50"),
            func.percentile_cont(0.95).within_group(LLMCall.latency_ms.asc()).label("p95"),
            func.count().label("n"),
        ).where(*conds, LLMCall.success.is_(True))
    )).one()
    by_function = (await db.execute(
        select(
            LLMCall.function,
            func.count().label("calls"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("spend"),
        )
        .where(*conds)
        .group_by(LLMCall.function)
        .order_by(func.sum(LLMCall.cost_usd).desc(), LLMCall.function)
    )).all()
    failures = (await db.execute(
        select(
            LLMCall.id, LLMCall.function, LLMCall.model, LLMCall.created_at,
            LLMCall.latency_ms, LLMCall.retry_count, LLMCall.submission_id,
            LLMCall.output_text,
        )
        .where(*conds, LLMCall.success.is_(False))
        .order_by(LLMCall.created_at.desc(), LLMCall.id)
        .limit(5)
    )).all()
    calls = int(totals.calls)
    failed = int(totals.failed)
    return {
        "calls": calls,
        "spend": round(float(totals.spend), 4),
        "failed": failed,
        "failure_rate": round(failed / calls * 100, 1) if calls else 0.0,
        "latency_p50_ms": round(float(latency.p50), 1) if latency.p50 is not None else None,
        "latency_p95_ms": round(float(latency.p95), 1) if latency.p95 is not None else None,
        "latency_n": int(latency.n),
        "spend_by_function": [
            {"function": r.function, "calls": int(r.calls), "spend": round(float(r.spend), 4)}
            for r in by_function
        ],
        "latest_failures": [
            {
                "id": str(f.id),
                "function": f.function,
                "model": f.model,
                "created_at": f.created_at.isoformat(),
                "latency_ms": round(f.latency_ms, 1),
                "retry_count": f.retry_count,
                "submission_id": str(f.submission_id) if f.submission_id else None,
                "deleted_submission": is_deleted_submission_call(
                    f.function, f.submission_id, f.created_at,
                ),
                # Failed calls store the error in output_text.
                "error": (f.output_text or "")[:300] or None,
            }
            for f in failures
        ],
    }


@router.get("/llm-calls/summary")
async def llm_calls_summary(
    filters: CallFilters = Depends(),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The calls panel: `call_summary` for any scope the filters name."""
    return await call_summary(db, filters.conditions)


@router.get("/llm-calls")
async def llm_calls(
    filters: CallFilters = Depends(),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    base_filters = filters.conditions
    submission_id = filters.submission_id
    summary = await call_summary(db, base_filters)

    # Aggregated stats
    stats_query = (
        select(
            LLMCall.function,
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("total_cost"),
            func.avg(LLMCall.latency_ms).label("avg_latency"),
        )
        .where(*base_filters)
        .group_by(LLMCall.function)
        .order_by(func.sum(LLMCall.cost_usd).desc())
    )
    stats = (await db.execute(stats_query)).all()

    # By model
    model_stats = (await db.execute(
        select(
            LLMCall.model,
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("total_cost"),
        )
        .where(*base_filters)
        .group_by(LLMCall.model)
    )).all()

    # Calls per day (with latency)
    calls_by_day = (await db.execute(
        select(
            cast(LLMCall.created_at, Date).label("day"),
            func.count().label("count"),
            func.sum(LLMCall.cost_usd).label("cost"),
            func.avg(LLMCall.latency_ms).label("avg_latency"),
        )
        .where(*base_filters)
        .group_by("day")
        .order_by("day")
    )).all()

    # Recent calls (paginated), each with who it was for: the school
    # stamped on it, and — for a call on a submission — the student who
    # handed it in and the teacher who set the homework.
    student = aliased(User)
    teacher = aliased(User)
    calls_query = (
        select(
            LLMCall,
            User.email.label("user_email"),
            User.name.label("user_name"),
            School.name.label("school_name"),
            student.name.label("student_name"),
            teacher.name.label("teacher_name"),
        )
        .outerjoin(User, User.id == LLMCall.user_id)
        .outerjoin(School, School.id == LLMCall.school_id)
        .outerjoin(Submission, Submission.id == LLMCall.submission_id)
        .outerjoin(student, student.id == Submission.student_id)
        .outerjoin(Assignment, Assignment.id == Submission.assignment_id)
        .outerjoin(teacher, teacher.id == Assignment.teacher_id)
        .where(*base_filters)
    )
    calls_query = (
        calls_query
        # `id` breaks ties: created_at defaults to now(), the TRANSACTION
        # timestamp, so calls logged in one transaction share a value and
        # OFFSET paging over an unstable order repeats and skips rows.
        .order_by(LLMCall.created_at.desc(), LLMCall.id)
        .offset(offset)
        .limit(limit)
    )
    calls = (await db.execute(calls_query)).all()

    # Submission case-file identity + outcome. Only materialized when the
    # caller scopes to a single submission (the SubmissionTrace drill-in) —
    # a one-row join that turns a raw UUID into "who / which HW / what the
    # AI grade + integrity check + teacher decided". Null on the general
    # LLM-calls list (no submission_id), so that view pays nothing for it.
    submission_summary: dict[str, Any] | None = None
    if submission_id:
        srow = (await db.execute(
            select(
                Submission.id,
                Submission.status,
                Submission.student_id,
                Assignment.title.label("assignment_title"),
                Assignment.type.label("assignment_type"),
                User.name.label("student_name"),
                User.school_id.label("school_id"),
                School.name.label("school_name"),
                School.kind.label("school_kind"),
                SubmissionGrade.ai_score,
                SubmissionGrade.final_score,
                SubmissionGrade.ai_grading_status,
                SubmissionGrade.graded_at,
                SubmissionGrade.reviewed_at,
                SubmissionGrade.grade_published_at,
                IntegrityCheckSubmission.disposition.label("integrity_disposition"),
                IntegrityCheckSubmission.headline.label("integrity_headline"),
                IntegrityCheckSubmission.status.label("integrity_status"),
                IntegrityCheckSubmission.resolution.label("integrity_resolution"),
            )
            .select_from(Submission)
            .outerjoin(Assignment, Assignment.id == Submission.assignment_id)
            .outerjoin(User, User.id == Submission.student_id)
            .outerjoin(School, School.id == User.school_id)
            .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
            .outerjoin(
                IntegrityCheckSubmission,
                IntegrityCheckSubmission.submission_id == Submission.id,
            )
            .where(Submission.id == submission_id)
        )).first()
        if srow is not None:
            submission_summary = {
                "id": str(srow.id),
                "status": srow.status,
                "student_id": str(srow.student_id) if srow.student_id else None,
                "student_name": srow.student_name,
                "school_id": str(srow.school_id) if srow.school_id else None,
                "school_name": srow.school_name,
                "school_kind": srow.school_kind,
                "assignment_title": srow.assignment_title,
                "assignment_type": srow.assignment_type,
                "ai_score": srow.ai_score,
                "final_score": srow.final_score,
                "ai_grading_status": srow.ai_grading_status,
                "graded_at": srow.graded_at.isoformat() if srow.graded_at else None,
                "reviewed_at": srow.reviewed_at.isoformat() if srow.reviewed_at else None,
                "grade_published_at": (
                    srow.grade_published_at.isoformat()
                    if srow.grade_published_at else None
                ),
                "integrity_disposition": srow.integrity_disposition,
                "integrity_headline": srow.integrity_headline,
                "integrity_status": srow.integrity_status,
                "integrity_resolution": srow.integrity_resolution,
            }

    # Failure analysis
    failure_filters = [*base_filters, LLMCall.success.is_(False)]
    failures_by_function = (await db.execute(
        select(
            LLMCall.function,
            func.count().label("count"),
            func.avg(LLMCall.retry_count).label("avg_retries"),
        )
        .where(*failure_filters)
        .group_by(LLMCall.function)
        .order_by(func.count().desc())
    )).all()

    # Users who have LLM calls in this period (for filter dropdown).
    # Honors the school scope so the dropdown only lists users whose
    # calls are visible under the current filter — otherwise picking
    # a school would still surface every founder/test account.
    user_rows = (await db.execute(
        select(User.id, User.email)
        .where(
            User.id.in_(
                select(func.distinct(LLMCall.user_id))
                .where(*filters.user_options, LLMCall.user_id.isnot(None))
            )
        )
        .order_by(User.email)
    )).all()

    # The teacher and student pickers: the people the window and school
    # reach — teachers of the school (or every teacher), and students who
    # had a call in the window (every grading/integrity call is stamped
    # with its student, so that is everyone with work in it).
    teacher_rows = (await db.execute(
        select(User.id, User.name, User.email)
        .where(
            User.role == "teacher",
            *(
                [] if not filters.school_scope
                else [User.school_id.is_(None)]
                if filters.school_scope == INTERNAL_SCHOOL_SENTINEL
                else [User.school_id == filters.school_scope]
            ),
        )
        .order_by(User.name)
    )).all()
    student_rows = (await db.execute(
        select(User.id, User.name, User.email)
        .where(
            User.role == "student",
            User.id.in_(
                select(func.distinct(LLMCall.user_id))
                .where(*filters.user_options, LLMCall.user_id.isnot(None))
            ),
        )
        .order_by(User.name)
    )).all()

    # The function and model choices for the filter dropdowns. The
    # aggregates follow every filter now, so they can't double as the
    # option list (picking a function would leave a list of one).
    function_options = (await db.execute(
        select(LLMCall.function).where(*filters.option_scope)
        .distinct().order_by(LLMCall.function)
    )).scalars().all()
    model_options = (await db.execute(
        select(LLMCall.model).where(*filters.option_scope)
        .distinct().order_by(LLMCall.model)
    )).scalars().all()

    return {
        "functions": list(function_options),
        "models": list(model_options),
        # Every filter narrows these too: the strip describes the rows.
        "summary": summary,
        "failures_by_function": [
            {
                "function": r.function,
                "count": r.count,
                # float() first: avg() of the integer retry_count comes back as a
                # Decimal, which round() keeps Decimal → JSON-encodes as a STRING
                # ("2.0"), breaking the dashboard's numeric .toFixed(). Cast so the
                # wire value is a real number.
                "avg_retries": round(float(r.avg_retries or 0), 1),
            }
            for r in failures_by_function
        ],
        "by_function": [
            {
                "function": r.function,
                "count": r.count,
                "total_cost": round(r.total_cost or 0, 4),
                "avg_latency_ms": round(r.avg_latency or 0, 1),
            }
            for r in stats
        ],
        "by_model": [
            {
                "model": r.model,
                "count": r.count,
                "total_cost": round(r.total_cost or 0, 4),
            }
            for r in model_stats
        ],
        "by_day": [
            {
                "day": str(r.day),
                "count": r.count,
                "cost": round(r.cost or 0, 4),
                "avg_latency": round(r.avg_latency or 0, 0),
            }
            for r in calls_by_day
        ],
        "calls": [
            {
                "id": str(c.id),
                "function": c.function,
                "model": c.model,
                "input_tokens": c.input_tokens,
                "output_tokens": c.output_tokens,
                "cache_read_tokens": c.cache_read_tokens,
                "cache_write_tokens": c.cache_write_tokens,
                "latency_ms": round(c.latency_ms, 1),
                "cost_usd": round(c.cost_usd, 6),
                "success": c.success,
                "retry_count": c.retry_count,
                "input_text": c.input_text,
                "output_text": c.output_text,
                "session_id": str(c.session_id) if c.session_id else None,
                "user_id": str(c.user_id) if c.user_id else None,
                "user_name": user_name or user_email or "Deleted User",
                "school_id": str(c.school_id) if c.school_id else None,
                "school_name": school_name,
                "student_name": student_name,
                "teacher_name": teacher_name,
                "submission_id": str(c.submission_id) if c.submission_id else None,
                # A submission-pipeline call whose submission was deleted.
                # Still the student's (user_id) — labelled, never re-homed.
                "deleted_submission": is_deleted_submission_call(
                    c.function, c.submission_id, c.created_at,
                ),
                "metadata": c.call_metadata,
                # The ID of the system prompt this call sent, not its
                # text: prompts run to ~18KB and dedupe heavily, so
                # inlining one per row would put close to a megabyte on
                # a 50-row page to render text nobody has expanded yet.
                # The body comes from /admin/llm-payloads/{id} when a
                # row is opened. Null means genuinely not recorded —
                # every call predating this column, which is deliberately
                # not backfilled because the text was never captured.
                "system_prompt_id": (
                    str(c.system_prompt_id) if c.system_prompt_id else None
                ),
                "tool_schema_id": (
                    str(c.tool_schema_id) if c.tool_schema_id else None
                ),
                "created_at": c.created_at.isoformat(),
            }
            for c, user_email, user_name, school_name, student_name, teacher_name in calls
        ],
        "total_count": summary["calls"],
        # Case-file identity for the single-submission trace view. Null on the
        # general list. See submission_summary above.
        "submission": submission_summary,
        "users": [
            {"id": str(r.id), "email": r.email}
            for r in user_rows
        ],
        "teachers": [
            {"id": str(r.id), "name": r.name or r.email} for r in teacher_rows
        ],
        "students": [
            {"id": str(r.id), "name": r.name or r.email} for r in student_rows
        ],
        # Lets the dashboard build a "Debug results" link to the GitHub issue the
        # debug agent files (labelled llm-debug, with the call id in its body).
        "repo": settings.github_repo,
    }


async def _github_dispatch(payload: dict[str, object]) -> int:
    """Fire a `debug-llm-call` repository_dispatch. Returns the HTTP status.
    Isolated so tests can stub it without touching the test HTTP client."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"https://api.github.com/repos/{settings.github_repo}/dispatches",
            headers={
                "Authorization": f"Bearer {settings.github_dispatch_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json={"event_type": "debug-llm-call", "client_payload": payload},
        )
    return resp.status_code


@router.post("/llm-calls/{call_id}/debug")
async def debug_llm_call(
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_admin),
) -> dict[str, str]:
    """Fire a GitHub Actions agent to debug this one prod LLM call.

    Dispatches a `debug-llm-call` repository_dispatch carrying the call's
    input/output; the workflow runs Claude Code to trace it through the
    rendering pipeline and post a GitHub issue with the root cause. Admin-only.
    """
    if not settings.github_dispatch_token:
        raise HTTPException(
            status_code=503,
            detail="debug agent not configured (set GITHUB_DISPATCH_TOKEN)",
        )
    try:
        cid = uuid_lib.UUID(call_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid call_id") from None

    call = (
        await db.execute(select(LLMCall).where(LLMCall.id == cid))
    ).scalar_one_or_none()
    if call is None:
        raise HTTPException(status_code=404, detail="LLM call not found")

    # Only the fields the workflow needs, each truncated, so client_payload stays
    # well under GitHub's ~64KB cap (metadata is unbounded + unused — omitted).
    payload: dict[str, object] = {
        "call_id": str(call.id),
        "function": call.function,
        "model": call.model,
        "input_text": (call.input_text or "")[:_DISPATCH_TEXT_CAP],
        "output_text": (call.output_text or "")[:_DISPATCH_TEXT_CAP],
    }
    try:
        status_code = await _github_dispatch(payload)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"GitHub dispatch failed: {e}") from e
    if status_code not in (200, 204):
        raise HTTPException(
            status_code=502, detail=f"GitHub dispatch rejected ({status_code})",
        )
    # Mark the call debugged so the dashboard shows its "Debug results" link only
    # for calls actually dispatched. Reassign (not mutate) so SQLAlchemy flags
    # the JSON column dirty.
    call.call_metadata = {
        **(call.call_metadata or {}),
        "debug_dispatched_at": datetime.now(UTC).isoformat(),
    }
    await db.commit()
    return {"status": "dispatched", "call_id": str(call.id)}


@router.get("/llm-payloads/{payload_id}")
async def llm_payload(
    payload_id: uuid_lib.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The system prompt or tool schema behind a call, fetched on expand.

    Split from the call list rather than inlined because these are large
    (~18KB for a grading prompt) and heavily shared: one row serves every
    submission in a class, so a list of 50 calls may reference only two
    or three distinct prompts. Sending each row its own copy would move
    the better part of a megabyte to render text nobody has opened.

    `used_by` is the diagnostic that falls out of content-addressing.
    Because a system prompt is built to be byte-identical across a class
    (that IS the caching contract), a prompt used once where you expected
    thirty means something student-specific leaked into the cached half
    and silently killed the cache hit for every submission after it.
    """
    row = (await db.execute(
        select(LLMPayload).where(LLMPayload.id == payload_id)
    )).scalars().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Payload not found")

    used_by = (await db.execute(
        select(func.count()).select_from(LLMCall).where(
            or_(
                LLMCall.system_prompt_id == payload_id,
                LLMCall.tool_schema_id == payload_id,
            )
        )
    )).scalar() or 0

    return {
        "id": str(row.id),
        "sha256": row.sha256,
        "text": row.text,
        "char_len": row.char_len,
        "kind": row.kind,
        # Named for what it is. A payload can be shared across call sites
        # (every vision call sends the same safety preamble), and only the
        # first writer's function is recorded, so calling this "function"
        # would assert an ownership that doesn't hold.
        "first_seen_from": row.function,
        "first_seen_at": row.first_seen_at.isoformat(),
        "used_by": int(used_by),
    }
