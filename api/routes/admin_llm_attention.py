"""What on the AI side needs a human right now — the Calls page's band.

Three things, each a fact about the last 24 hours, each a link into the
calls behind it:

* a FUNCTION failing: of its most recent calls (up to 20) in the last
  24 h, at least `FAIL_MIN` failed and they are at least `FAIL_SHARE` of
  them. A handful of retries-exhausted timeouts on a busy function is
  noise; two of its last five is a broken prompt or a provider incident.
* a SCHOOL with failed calls: `SCHOOL_FAIL_MIN` or more in 24 h, by the
  school stamped on the call — where the complaints will come from.
* a function's p95 latency UP: successful calls only (a timeout is a
  failure, not latency), the last 24 h against the 7 days before them,
  when both have enough calls to mean something and the tail grew both
  by a ratio and by seconds a student would notice.

Thresholds are deliberately plain constants: the band is read by a
person deciding where to look, not alerted on.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.llm_attribution import school_calls
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.school import School
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL, Window

router = APIRouter()

RECENT_CALLS = 20
FAIL_MIN = 2
FAIL_SHARE = 0.10
SCHOOL_FAIL_MIN = 3
P95_MIN_RECENT = 5
P95_MIN_BEFORE = 10
P95_RATIO = 1.5
P95_MIN_RISE_MS = 5000.0


async def attention_items(
    db: AsyncSession, school_id: str | None, now: datetime | None = None,
) -> list[dict[str, Any]]:
    end = now or datetime.now(UTC)
    day = Window(end - timedelta(days=1), end)
    week_before = Window(day.start - timedelta(days=7), day.start)
    place: list[Any] = []
    if school_id:
        place.append(school_calls(None if school_id == INTERNAL_SCHOOL_SENTINEL else school_id))

    items: list[dict[str, Any]] = []

    # ── Functions failing among their most recent calls ──────────────
    ranked = (
        select(
            LLMCall.function,
            LLMCall.success,
            func.row_number().over(
                partition_by=LLMCall.function,
                order_by=(LLMCall.created_at.desc(), LLMCall.id),
            ).label("rn"),
        )
        .where(day.covers(LLMCall.created_at), *place)
        .subquery()
    )
    recent = (await db.execute(
        select(
            ranked.c.function,
            func.count().label("of"),
            func.count().filter(ranked.c.success.is_(False)).label("failed"),
        )
        .where(ranked.c.rn <= RECENT_CALLS)
        .group_by(ranked.c.function)
    )).all()
    for r in sorted(recent, key=lambda r: (-r.failed / r.of, r.function)):
        if r.failed >= FAIL_MIN and r.failed / r.of >= FAIL_SHARE:
            items.append({
                "kind": "function_failing", "function": r.function,
                "failed": int(r.failed), "of": int(r.of),
            })

    # ── Schools with failed calls ────────────────────────────────────
    schools = (await db.execute(
        select(LLMCall.school_id, School.name, func.count().label("failed"))
        .outerjoin(School, School.id == LLMCall.school_id)
        .where(day.covers(LLMCall.created_at), LLMCall.success.is_(False), *place)
        .group_by(LLMCall.school_id, School.name)
        .having(func.count() >= SCHOOL_FAIL_MIN)
        .order_by(func.count().desc(), School.name)
    )).all()
    for r in schools:
        items.append({
            "kind": "school_failures",
            "school_id": str(r.school_id) if r.school_id else INTERNAL_SCHOOL_SENTINEL,
            "school_name": r.name or "Internal",
            "failed": int(r.failed),
        })

    # ── p95 latency up against the week before ───────────────────────
    async def p95_by_function(window: Window) -> dict[str, tuple[float, int]]:
        rows = (await db.execute(
            select(
                LLMCall.function,
                func.percentile_cont(0.95).within_group(LLMCall.latency_ms.asc()).label("p95"),
                func.count().label("n"),
            )
            .where(window.covers(LLMCall.created_at), LLMCall.success.is_(True), *place)
            .group_by(LLMCall.function)
        )).all()
        return {r.function: (float(r.p95), int(r.n)) for r in rows}

    now_p95 = await p95_by_function(day)
    before_p95 = await p95_by_function(week_before)
    rises = []
    for fn, (p95, n) in now_p95.items():
        was = before_p95.get(fn)
        if was is None or n < P95_MIN_RECENT or was[1] < P95_MIN_BEFORE:
            continue
        if p95 >= was[0] * P95_RATIO and p95 - was[0] >= P95_MIN_RISE_MS:
            rises.append({
                "kind": "p95_up", "function": fn,
                "p95_ms": round(p95, 1), "was_ms": round(was[0], 1), "n": n,
            })
    items.extend(sorted(rises, key=lambda r: (-(r["p95_ms"] - r["was_ms"]), r["function"])))
    return items


@router.get("/llm-calls/attention")
async def llm_attention(
    school_id: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The band above the Calls table: what's failing or slowing now."""
    if school_id and school_id != INTERNAL_SCHOOL_SENTINEL:
        try:
            uuid.UUID(school_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid school_id") from e
    return {"items": await attention_items(db, school_id)}
