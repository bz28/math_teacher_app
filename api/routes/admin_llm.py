"""Admin LLM call analytics endpoint."""

import hashlib
import json
import secrets as secrets_lib
import uuid as uuid_lib
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Date, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.core.llm_client import _CORRUPTION_CHARS
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user, require_admin
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.llm_call import LLMCall
from api.models.llm_payload import LLMPayload
from api.models.school import School
from api.models.user import User
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL, time_range

router = APIRouter()

# Cap each dispatched text field so client_payload stays well under GitHub's
# ~64KB repository_dispatch limit.
_DISPATCH_TEXT_CAP = 20000


def _escape_like(term: str) -> str:
    """Escape LIKE/ILIKE wildcards so a free-text search term matches
    literally — an operator searching for "50%" or "user_id" shouldn't get
    surprise wildcard behavior. Backslash first so we don't double-escape."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/llm-calls")
async def llm_calls(
    hours: int = Query(default=168, ge=1, le=8760),
    function: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    submission_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
    school_id: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = time_range(hours)

    # Reject malformed UUIDs up front so a typo in the URL surfaces
    # as a clean 400 rather than asyncpg's invalid-text-representation
    # bubbling out as a 500. Same defensive pattern admin_school_overview
    # uses on its own school_id path segment.
    for label, value in (
        ("user_id", user_id),
        ("submission_id", submission_id),
        ("session_id", session_id),
    ):
        if value:
            try:
                uuid_lib.UUID(value)
            except ValueError as e:
                raise HTTPException(
                    status_code=400, detail=f"invalid {label}",
                ) from e
    if school_id and school_id != INTERNAL_SCHOOL_SENTINEL:
        try:
            uuid_lib.UUID(school_id)
        except ValueError as e:
            raise HTTPException(
                status_code=400, detail="invalid school_id",
            ) from e

    # Build base filter conditions
    base_filters = [LLMCall.created_at >= since]
    if user_id:
        base_filters.append(LLMCall.user_id == user_id)
    if submission_id:
        # Per-submission flight-recorder filter — pulls every Vision +
        # equivalence + agent + grading call for one homework so the
        # admin dashboard can render the full pipeline trace in one
        # place. Indexed on submission_id, instant.
        base_filters.append(LLMCall.submission_id == submission_id)
    if session_id:
        # Session scope — pulls every call sharing one conversational
        # session (understanding-check turns, tutoring, learn/practice/
        # integrity chat) across submissions. Powers both the "session
        # link" in a row's detail and the "view the whole session" jump
        # from the submission trace. Indexed on session_id, instant.
        base_filters.append(LLMCall.session_id == session_id)
    if school_id == INTERNAL_SCHOOL_SENTINEL:
        # The "Internal" pseudo-school — LLMCall rows with school_id
        # IS NULL. Post-bp1000059 that's admin/system calls plus
        # legacy pre-backfill rows (LLMCall.school_id snapshots the
        # user's school at write time and isn't rewritten when an
        # indie teacher is later linked to their individual school).
        base_filters.append(LLMCall.school_id.is_(None))
    elif school_id:
        # Scope to a specific school. Indexed; instant.
        base_filters.append(LLMCall.school_id == school_id)

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

    # Window-level latency percentile. p95 is the operator's tail-latency
    # signal — a mean hides the slow calls that actually hurt. Over every
    # call in the window (not just successes) so a stalled/retried call
    # still counts. None on an empty window → 0.0.
    p95_latency = (await db.execute(
        select(func.percentile_cont(0.95).within_group(LLMCall.latency_ms.asc()))
        .where(*base_filters)
    )).scalar()

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

    # Recent calls (paginated) — join user info
    calls_query = (
        select(LLMCall, User.email.label("user_email"), User.name.label("user_name"))
        .outerjoin(User, User.id == LLMCall.user_id)
        .where(*base_filters)
    )
    # Filters that scope only the paginated call list (not the window
    # aggregates in the strip): the function selector, the success/
    # failure toggle, and the free-text search over prompt + response.
    row_filters = []
    if function:
        row_filters.append(LLMCall.function == function)
    if success is not None:
        # Powers the dashboard success/failure toggle: scopes the paginated
        # list (and total_count below) so the filter + pagination happen
        # server-side instead of on one page.
        row_filters.append(LLMCall.success.is_(success))
    if search:
        # Free-text search over the exact prompt in / response out — the
        # operator's primary "find that one call" tool. %/_ are escaped so
        # a search term reads as a literal, not a wildcard.
        like = f"%{_escape_like(search)}%"
        row_filters.append(or_(
            LLMCall.input_text.ilike(like, escape="\\"),
            LLMCall.output_text.ilike(like, escape="\\"),
        ))

    calls_query = (
        calls_query.where(*row_filters)
        # `id` breaks ties: created_at defaults to now(), the TRANSACTION
        # timestamp, so calls logged in one transaction share a value and
        # OFFSET paging over an unstable order repeats and skips rows.
        .order_by(LLMCall.created_at.desc(), LLMCall.id)
        .offset(offset)
        .limit(limit)
    )
    calls = (await db.execute(calls_query)).all()

    total_count = (await db.execute(
        select(func.count()).select_from(LLMCall).where(*base_filters, *row_filters)
    )).scalar() or 0

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

    failure_count = (await db.execute(
        select(func.count()).select_from(LLMCall).where(*failure_filters)
    )).scalar() or 0

    total_calls_count = (await db.execute(
        select(func.count()).select_from(LLMCall).where(*base_filters)
    )).scalar() or 0

    failure_rate = round(failure_count / total_calls_count * 100, 1) if total_calls_count else 0.0

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
    user_dropdown_filters = [
        LLMCall.created_at >= since,
        LLMCall.user_id.isnot(None),
    ]
    if school_id == INTERNAL_SCHOOL_SENTINEL:
        user_dropdown_filters.append(LLMCall.school_id.is_(None))
    elif school_id:
        user_dropdown_filters.append(LLMCall.school_id == school_id)
    user_rows = (await db.execute(
        select(User.id, User.email)
        .where(
            User.id.in_(
                select(func.distinct(LLMCall.user_id))
                .where(*user_dropdown_filters)
            )
        )
        .order_by(User.email)
    )).all()

    return {
        "total_count_window": total_calls_count,
        "total_cost_window": round(
            sum(float(r.total_cost or 0) for r in stats), 4,
        ),
        "p95_latency_ms": round(float(p95_latency or 0), 1),
        "failure_count": failure_count,
        "failure_rate": failure_rate,
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
                "submission_id": str(c.submission_id) if c.submission_id else None,
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
            for c, user_email, user_name in calls
        ],
        "total_count": total_count,
        # Case-file identity for the single-submission trace view. Null on the
        # general list. See submission_summary above.
        "submission": submission_summary,
        "users": [
            {"id": str(r.id), "email": r.email}
            for r in user_rows
        ],
        # Lets the dashboard build a "Debug results" link to the GitHub issue the
        # debug agent files (labelled llm-debug, with the call id in its body).
        "repo": settings.github_repo,
    }


# --- production-defect channel (autonomous improver) ----------------------
# Surfaces defective prod LLM calls so the improver can propose fixes from REAL
# failures (the LaTeX-class bug lived here). Read-only; the CI scan calls this
# with an admin token so prod DB credentials never leave the backend.

_DEFECT_SAMPLE_CAP = 2000  # per-group sample text — enough to recognize the bug
_CHAR_NAMES = {
    "\f": "formfeed(\\f)", "\v": "vtab(\\v)",
    "\b": "backspace(\\b)", "\r": "carriage-return(\\r)",
}


def _corruption_chars(output_text: str | None) -> str:
    """The distinct control chars (the LaTeX-class fingerprint) in a logged
    output. Structured outputs are stored as `json.dumps(result)`, where the
    corruption hides as control chars INSIDE parsed string values — so parse
    first and walk the structure; fall back to the raw string for non-JSON
    (free-text) outputs. Returns "" when clean."""
    if not output_text:
        return ""
    try:
        obj: object = json.loads(output_text)
    except (json.JSONDecodeError, ValueError):
        obj = output_text
    found: set[str] = set()

    def _walk(o: object) -> None:
        if isinstance(o, str):
            found.update(c for c in _CORRUPTION_CHARS if c in o)
        elif isinstance(o, list):
            for x in o:
                _walk(x)
        elif isinstance(o, dict):
            for v in o.values():
                _walk(v)

    _walk(obj)
    return "".join(sorted(found))


def _defect_of(row: LLMCall) -> tuple[str, str] | None:
    """Classify a logged call: ('failed', '') for an errored call, ('corrupt',
    <chars>) for control-char corruption, else None (healthy)."""
    if not row.success:
        return ("failed", "")
    chars = _corruption_chars(row.output_text)
    return ("corrupt", chars) if chars else None


def _defect_signature(function: str, kind: str, fingerprint: str) -> str:
    """Stable 12-char key collapsing recurring instances of the SAME defect into
    one group, so a bug hitting thousands of calls is one proposal, not a flood.
    Keyed on (function, kind, corruption fingerprint)."""
    marker = fingerprint.encode().hex() if fingerprint else kind
    return hashlib.sha1(f"{function}:{kind}:{marker}".encode()).hexdigest()[:12]


def _parse_cursor(since: str | None, hours: int) -> tuple[datetime, uuid_lib.UUID | None]:
    """Parse the opaque scan cursor into a keyset `(created_at, id)` position.

    The cursor is `"<iso-timestamp>|<uuid>"` (the `|<uuid>` half is optional, so a
    human can pass a plain ISO timestamp). Including the row id makes paging a
    true keyset: scanning `(created_at, id) > (since_ts, since_id)` can never skip
    or double-count rows that share a `created_at` at the `limit` boundary. A
    naive timestamp (no offset) is assumed UTC so it compares against the
    tz-aware `created_at` instead of raising. Empty cursor → last `hours`."""
    if not since:
        return time_range(hours), None
    ts_part, _, id_part = since.partition("|")
    try:
        ts = datetime.fromisoformat(ts_part)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid since timestamp") from e
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    cursor_id: uuid_lib.UUID | None = None
    if id_part:
        try:
            cursor_id = uuid_lib.UUID(id_part)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid since cursor id") from e
    return ts, cursor_id


# Optional bearer so the dependency can fall through to service-key auth when no
# JWT is presented (the default HTTPBearer would 403 before our code runs).
_optional_bearer = HTTPBearer(auto_error=False)


async def require_admin_or_service_key(
    x_improver_key: str | None = Header(default=None, alias="X-Improver-Key"),
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Authorize the defect endpoint by EITHER the static improver service key
    (for the scheduled CI scanner — admin JWTs expire in minutes, useless as a
    stored secret) OR a normal admin JWT (interactive/dashboard use). The key
    compare is constant-time; an empty configured key disables service-key auth."""
    key = settings.improver_api_key
    if key and x_improver_key and secrets_lib.compare_digest(x_improver_key, key):
        return
    if credentials is not None:
        user = await get_current_user(credentials, db)  # full check; raises on bad/expired/inactive
        if user.role == "admin":
            return
    raise HTTPException(status_code=403, detail="admin access or improver service key required")


@router.get("/llm-calls/defects")
async def llm_call_defects(
    since: str | None = Query(default=None, description="keyset cursor '<iso>|<id>'; URL-encode the '+'"),
    hours: int = Query(default=24, ge=1, le=720),
    limit: int = Query(default=1000, ge=1, le=5000),
    _: None = Depends(require_admin_or_service_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Recent LLM calls whose output looks defective — failed calls, or outputs
    carrying the control-char corruption fingerprint (the LaTeX-class bug) —
    grouped by (function, signature) so a recurring defect is ONE row. Drives
    the improver's production-defect channel.

    `watermark` is an opaque keyset cursor `'<iso>|<id>'` of the last row scanned;
    pass it back as `since` next run for incremental, skip-free scans. Callers
    MUST URL-encode it (the ISO offset contains a `+`)."""
    since_ts, since_id = _parse_cursor(since, hours)
    # Keyset pagination on (created_at, id): a unique tiebreak so truncating at
    # `limit` can never skip or double-count rows sharing a created_at.
    if since_id is None:
        keyset = LLMCall.created_at > since_ts
    else:
        keyset = or_(
            LLMCall.created_at > since_ts,
            and_(LLMCall.created_at == since_ts, LLMCall.id > since_id),
        )
    rows = (await db.execute(
        select(LLMCall)
        .where(keyset)
        .order_by(LLMCall.created_at, LLMCall.id)
        .limit(limit)
    )).scalars().all()

    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        defect = _defect_of(row)
        if defect is None:
            continue
        kind, fingerprint = defect
        sig = _defect_signature(row.function, kind, fingerprint)
        group = groups.get(sig)
        if group is None:
            # rows are ascending by created_at, so the first hit is the earliest.
            groups[sig] = {
                "signature": sig, "function": row.function, "kind": kind,
                "corruption_chars": [_CHAR_NAMES.get(c, repr(c)) for c in fingerprint],
                "count": 1,
                "first_seen": row.created_at.isoformat(),
                "last_seen": row.created_at.isoformat(),
                "sample_call_id": str(row.id),
                "sample_model": row.model,
                "sample_input": (row.input_text or "")[:_DEFECT_SAMPLE_CAP],
                "sample_output": (row.output_text or "")[:_DEFECT_SAMPLE_CAP],
            }
        else:
            group["count"] += 1
            group["last_seen"] = row.created_at.isoformat()

    defects = sorted(groups.values(), key=lambda d: d["count"], reverse=True)
    # Composite watermark = the last scanned row's keyset position. On an empty
    # scan, echo the input cursor back so the caller holds its place.
    if rows:
        last = rows[-1]
        watermark = f"{last.created_at.isoformat()}|{last.id}"
    else:
        watermark = since or since_ts.isoformat()
    return {
        "since": since,
        "watermark": watermark,
        "scanned": len(rows),
        "defect_groups": len(defects),
        "defects": defects,
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
