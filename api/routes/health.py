import logging
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import text

from api.database import get_session_factory

router = APIRouter()

logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check(deep: bool = Query(default=False)) -> dict[str, Any]:
    result: dict[str, Any] = {"status": "healthy"}

    # Always check DB
    async with get_session_factory()() as session:
        await session.execute(text("SELECT 1"))

    if not deep:
        return result

    # Deep check: verify LLM API reachability
    checks: dict[str, str] = {}
    try:
        from api.core.llm_client import get_client

        client = get_client()
        # Minimal API call to check connectivity (count endpoint, not a message)
        await client.models.list(limit=1)
        checks["llm_api"] = "ok"
    except Exception as e:
        checks["llm_api"] = f"error: {e}"
        result["status"] = "degraded"
        logger.warning("Deep health check: LLM API unreachable: %s", e)

    # Check cost tracker state
    try:
        from api.core.cost_tracker import cost_tracker

        remaining = cost_tracker.remaining_budget()
        checks["cost_tracker"] = f"ok (${remaining:.2f} remaining)"
        if remaining <= 0:
            checks["cost_tracker"] = "budget_exhausted"
            result["status"] = "degraded"
    except Exception as e:
        checks["cost_tracker"] = f"error: {e}"

    result["checks"] = checks
    return result
