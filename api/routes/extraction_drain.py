"""Service-authenticated trigger for the extraction queue.

Same shape and same reasoning as `grading_drain`: the durable part is the
table, the clock is swappable, and an in-process timer would put the
trigger back inside the process whose death the queue exists to survive.

Deliberately a separate endpoint rather than a second call inside the
grading drain. Extraction and grading fail for different reasons and at
different rates — the 2026-09-03 outage broke every extraction while
generation kept working — and one combined endpoint would report a single
verdict for two independent pipelines, so a total extraction failure could
hide behind healthy grading counters. Separate endpoints mean the cron can
alert on each, and a stuck extraction queue is visible on its own.

Reuses `settings.grading_drain_token`: it is the same operator calling on
the same schedule, and a second secret to rotate buys nothing here.
"""

import secrets

from fastapi import APIRouter, Header, HTTPException, status

from api.config import settings
from api.core.extraction_queue import DEFAULT_DRAIN_LIMIT, drain

# include_in_schema=False: service-to-service. Publishing it would put
# the path and its auth header into the public OpenAPI spec and both
# generated TypeScript clients.
router = APIRouter(
    prefix="/internal/extraction", tags=["internal"], include_in_schema=False,
)


@router.post("/drain")
async def drain_extraction_queue(
    x_grading_token: str | None = Header(default=None),
    limit: int = DEFAULT_DRAIN_LIMIT,
) -> dict[str, int]:
    """Run one drain pass; report what it did.

    Returns per-pass counters (`reclaimed` / `claimed` / `succeeded` /
    `skipped` / `failed`) so the caller's logs answer "did anything
    happen, and did it work?" without a database session. `skipped`
    counts jobs that were claimed and then found to owe nothing — the
    assignment's AI toggles had been switched off — and is deliberately
    apart from `failed` so a closed door does not read as an incident. A cron that silently 200s while
    extracting nothing is indistinguishable from a healthy one otherwise
    — which is precisely how the outage went unnoticed until a student
    complained.

    Alert on `failed`. A non-zero count means submissions are burning
    retry budget, and once a job exhausts it the row parks as `failed`
    with the exception on it, waiting for a human.

    Safe to call as often and as concurrently as you like: `drain()`
    claims rows with `FOR UPDATE SKIP LOCKED`, so overlapping calls take
    disjoint work rather than billing the same Vision call twice.
    """
    token = settings.grading_drain_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Extraction drain not configured",
        )
    # Compare as bytes: Starlette decodes headers as Latin-1, so a
    # non-ASCII token would make compare_digest raise (→ 500) rather than
    # cleanly failing closed.
    supplied = (x_grading_token or "").encode("utf-8")
    if not secrets.compare_digest(supplied, token.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid grading token",
        )
    # Bounded so one pass can't run past a platform request timeout and
    # get killed halfway. Anything unclaimed stays queued for next time.
    return await drain(limit=max(1, min(limit, DEFAULT_DRAIN_LIMIT)))
