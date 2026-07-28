"""Service-authenticated trigger for the grading queue.

Queued grading work has to be picked up by *something*. That something is
deliberately not an in-process timer: the whole point of `grading_jobs` is
that the work survives this process, and a scheduler living inside the web
app would put the trigger right back where the durability problem was.

So the trigger is an HTTP endpoint an external clock calls — a platform
cron (Railway/Vercel), a GitHub Actions schedule, anything that can make
a POST. The queue is the durable part; the clock is swappable.

Guarded by a shared secret (`X-Grading-Token`), never a user session, and
disabled with a 503 when the token isn't configured — same shape as the
harness ingest endpoint. Without that, an unauthenticated caller could
force every pending class on the platform to grade on demand, which is
real money.

The endpoint is safe to call as often as you like and safe to call
concurrently with itself: `drain()` claims rows with `FOR UPDATE SKIP
LOCKED`, so two overlapping calls take disjoint work rather than grading
(and billing for) the same submission twice.
"""

import secrets

from fastapi import APIRouter, Header, HTTPException, status

from api.config import settings
from api.core.grading_queue import DEFAULT_DRAIN_LIMIT, drain

router = APIRouter(prefix="/internal/grading", tags=["internal"])


@router.post("/drain")
async def drain_grading_queue(
    x_grading_token: str | None = Header(default=None),
    limit: int = DEFAULT_DRAIN_LIMIT,
) -> dict[str, int]:
    """Run one drain pass; report what it did.

    Returns per-pass counters (`reclaimed` / `claimed` / `assignments` /
    `succeeded` / `failed`) so the caller's logs answer "did anything
    happen, and did it work?" without a database session. A cron that
    silently 200s while grading nothing is indistinguishable from a
    healthy one otherwise.
    """
    token = settings.grading_drain_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Grading drain not configured",
        )
    # Compare as bytes: Starlette decodes headers as Latin-1, so a
    # non-ASCII token would make compare_digest raise (→ 500) rather
    # than cleanly failing closed.
    supplied = (x_grading_token or "").encode("utf-8")
    if not secrets.compare_digest(supplied, token.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid grading token",
        )
    # Bounded so one pass can't run past a platform request timeout and
    # get killed halfway. Anything unclaimed stays queued for next time.
    return await drain(limit=max(1, min(limit, DEFAULT_DRAIN_LIMIT)))
