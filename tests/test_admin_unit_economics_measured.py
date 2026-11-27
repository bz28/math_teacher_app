"""GET /v1/admin/unit-economics — the figures the margin simulator seeds
itself from, and the calls whose submission was deleted.

Split from test_admin_unit_economics.py (which is past the file-size
rule); it reuses that file's seed.

- A grading/reading call whose submission is gone is SUBMISSION cost. It
  must raise what one submission costs, and never land in self-study,
  where it would be charged to every active student as a monthly rate.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from api.core.model_pricing import cost_usd
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from tests.test_admin_unit_economics import (
    _OPUS,
    _get,
    _hw_cost,
    _price,
    _seed,
    _unit,
)

_WHEN = datetime.now(UTC) - timedelta(days=2)


def _deleted_call_cost() -> float:
    return cost_usd(_price(_OPUS), 4200, 850, 1000, 0)


async def _add_deleted_submission_calls(w, count: int) -> None:  # type: ignore[no-untyped-def]
    """`count` reads whose submission was deleted (submission_id SET NULL)."""
    async with get_session_factory()() as s:
        for i in range(count):
            s.add(
                LLMCall(
                    function="integrity_extract", model=_OPUS,
                    input_tokens=4200, output_tokens=850,
                    cache_read_tokens=1000, cache_write_tokens=0,
                    latency_ms=10.0, cost_usd=_deleted_call_cost(), success=True,
                    school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]),
                    submission_id=None, created_at=_WHEN,
                ),
            )
        await s.commit()


async def test_deleted_submission_calls_are_never_self_study(
    client: AsyncClient,
) -> None:
    w = await _seed(homework_submissions=6)
    await _add_deleted_submission_calls(w, 3)

    body = await _get(client, w.admin_id, days=30)

    self_study = _unit(body, "residual:student")
    assert self_study["n"] == 0
    assert self_study["cost_total"] == 0.0
    assert "residual:student" not in body["functions_by_unit"]


async def test_deleted_submission_calls_raise_the_per_submission_cost(
    client: AsyncClient,
) -> None:
    """3 deleted reads spread over the window's 6 surviving submissions."""
    w = await _seed(homework_submissions=6, test_submissions=0)
    await _add_deleted_submission_calls(w, 3)

    body = await _get(client, w.admin_id, days=30)

    overhead = 3 * _deleted_call_cost() / 6
    hw = _unit(body, "submission:homework")
    assert hw["n"] == 6
    assert hw["cost_median"] == pytest.approx(_hw_cost() + overhead)
    assert hw["cost_total"] == pytest.approx(6 * _hw_cost() + 3 * _deleted_call_cost())

    # The per-function legs carry it too, so the simulator's sum still
    # reconstructs the headline unit cost.
    fns = body["functions_by_unit"]["submission:homework"]
    assert sum(f["cost_per_unit"] for f in fns) == pytest.approx(hw["cost_mean"])
    read = next(f for f in fns if f["function"] == "integrity_extract")
    assert read["calls_per_unit"] == pytest.approx(1 + 3 / 6)

    assert body["deleted_submissions"] == {
        "calls": 3,
        "cost_usd": pytest.approx(3 * _deleted_call_cost()),
        "per_submission_usd": pytest.approx(overhead),
        "spread_over_submissions": 6,
    }


async def test_deleted_overhead_is_shared_pro_rata_across_kinds(
    client: AsyncClient,
) -> None:
    """Which kind a deleted submission was is unknowable; every surviving
    submission carries the same share, whatever its kind."""
    w = await _seed(homework_submissions=6, test_submissions=2)
    # Every kind costs the same before the overhead, so equal shares show.
    await _add_deleted_submission_calls(w, 4)

    body = await _get(client, w.admin_id, days=30)

    overhead = 4 * _deleted_call_cost() / 8
    hw = _unit(body, "submission:homework")
    test = _unit(body, "submission:test")
    assert hw["cost_median"] == pytest.approx(_hw_cost() + overhead)
    assert test["cost_median"] == pytest.approx(_hw_cost() + overhead)
    total_cost = sum(
        f["cost_per_unit"] * u["n"]
        for u in (hw, test)
        for f in body["functions_by_unit"][u["kind"]]
    )
    assert total_cost == pytest.approx(8 * _hw_cost() + 4 * _deleted_call_cost())
