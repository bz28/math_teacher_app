"""The harness → golden_cases seam: persist_golden_cases upserts each
scenario's outcome into the main DB so the dashboard shows live per-case
health. Guards the two behaviours the console depends on: a first run seeds a
case, and a second run that flips pass → fail records the regression
(prev_status carried forward).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select, text

from api.config import settings
from api.database import get_session_factory
from api.models.golden_case import GoldenCase
from tests.harness.explorer import (
    ExploreResult,
    Scenario,
    ScenarioResult,
    persist_golden_cases,
)


def _result(det_pass: int) -> ExploreResult:
    sc = Scenario(
        name="Sliver triangle", constraint="draw a near-degenerate sliver",
        expected_shapes=["triangle"], adversarial=True, rationale="edge case",
    )
    # A scenario passes only when items>0, all det checks pass, and shape matches.
    res = ScenarioResult(
        scenario=sc, items=1, det_pass=det_pass, det_total=1, shape_match=True,
    )
    return ExploreResult(probe_name="geometry", results=[res])


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE golden_cases RESTART IDENTITY CASCADE"))
        await s.commit()


async def test_first_run_seeds_then_regression_flips() -> None:
    await _wipe()
    db_url = settings.database_url

    # First corpus run: the case passes.
    written = await persist_golden_cases(_result(det_pass=1), str(uuid.uuid4()), "claude-x", db_url)
    assert written == 1
    async with get_session_factory()() as s:
        row = (await s.execute(select(GoldenCase))).scalar_one()
        assert row.last_status == "pass"
        assert row.prev_status is None
        assert row.adversarial is True
        assert row.expected_shapes == ["triangle"]

    # Second run: same case now fails a deterministic check → regression.
    run2 = str(uuid.uuid4())
    written = await persist_golden_cases(_result(det_pass=0), run2, "claude-x", db_url)
    assert written == 1
    async with get_session_factory()() as s:
        row = (await s.execute(select(GoldenCase))).scalar_one()
        assert row.last_status == "fail"
        assert row.prev_status == "pass"  # the regression signal
        assert str(row.last_run_id) == run2
        assert "check" in (row.last_output or "").lower()
