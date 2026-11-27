"""GET /v1/admin/unit-economics — repricing and thin-data findings pinned
from #1025's review rounds, split from test_admin_unit_economics.py (the
file-size rule); it reuses that file's seed and helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.model_pricing import cost_usd
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from tests.test_admin_unit_economics import (
    _OPUS,
    _SONNET,
    _WHEN,
    _get,
    _price,
    _seed,
    _unit,
    _World,
)

# --------------------------------------------------------------------------
# Review round 1 — findings pinned so they fail on revert
# --------------------------------------------------------------------------

async def test_reprice_at_measured_model_reproduces_recorded_cost(
    client: AsyncClient,
) -> None:
    """The trust check must converge even on skewed token counts.

    The profile reconstructs a COST, so it has to be the mean: only the
    mean satisfies sum = mean x count. A median profile understates every
    right-skewed distribution, and four INDEPENDENT medians additionally
    drop the cache-read term whenever fewer than half the calls cache.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "DELETE FROM llm_calls WHERE function <> 'integrity_extract'",
            ),
        )
        subs = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' "
                    "ORDER BY s.id",
                ),
            )
        ).scalars().all()
        # Skewed on purpose: mostly small and uncached, a few huge and cached.
        shapes = [(400, 100, 0)] * 4 + [(40_000, 3_000, 90_000)] * 2
        for sub, (tin, tout, cread) in zip(subs, shapes, strict=False):
            await s.execute(
                text("DELETE FROM llm_calls WHERE submission_id = :s"),
                {"s": sub},
            )
            s.add(
                LLMCall(
                    function="integrity_extract", model=_OPUS,
                    input_tokens=tin, output_tokens=tout,
                    cache_read_tokens=cread, cache_write_tokens=0,
                    latency_ms=1.0,
                    cost_usd=cost_usd(_price(_OPUS), tin, tout, cread, 0),
                    success=True, school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    fn = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "integrity_extract"
    ][0]
    assert fn["reprice"][_OPUS] == pytest.approx(fn["cost_per_unit"], rel=1e-6)


async def test_reprice_profile_keeps_cache_reads_when_a_minority_cache(
    client: AsyncClient,
) -> None:
    """Independent medians zeroed this term; the mean keeps it."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        subs = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 4",
                ),
            )
        ).scalars().all()
        for sub in subs:
            await s.execute(
                text(
                    "UPDATE llm_calls SET cache_read_tokens = 0 "
                    "WHERE submission_id = :s AND function = 'integrity_extract'",
                ),
                {"s": sub},
            )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    fn = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "integrity_extract"
    ][0]
    assert fn["tokens"]["cache_read"] > 0, (
        "4 of 6 calls have no cache traffic, so a median reads 0 and the "
        "repriced figure silently drops a term the recorded cost includes"
    )


async def test_short_window_marks_residual_rates_insufficient(
    client: AsyncClient,
) -> None:
    """A month's rate read off half an hour is arithmetic, not measurement.

    The default window is "since the model changed", so this is exactly
    the state of the page in the hour after a model switch.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        for i in range(6):
            s.add(
                LLMCall(
                    function="step_chat", model=_SONNET,
                    input_tokens=500, output_tokens=200, latency_ms=1.0,
                    cost_usd=0.03, success=True,
                    school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]),
                    created_at=datetime.now(UTC) - timedelta(minutes=30),
                ),
            )
        await s.commit()

    row = _unit(await _get(client, w.admin_id, days=1), "residual:student")
    assert row["n"] >= 5, "sample size alone would call this sufficient"
    assert row["sufficient"] is False, (
        "a per-month rate extrapolated from under a week must not be "
        "presented as measured"
    )
    # Public and typed: the page uses it to say WHY a row is insufficient,
    # since "too few observations" and "window too short to extrapolate"
    # send an operator to look at completely different things.
    assert row["window_too_short"] is True


async def test_residual_median_resists_one_heavy_user(
    client: AsyncClient,
) -> None:
    """The dashboard column is headed Median, so it had better be one."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        for i in range(6):
            s.add(
                LLMCall(
                    function="step_chat", model=_SONNET,
                    input_tokens=500, output_tokens=200, latency_ms=1.0,
                    cost_usd=50.0 if i == 0 else 0.01,
                    success=True, school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]), created_at=_WHEN,
                ),
            )
        await s.commit()

    row = _unit(await _get(client, w.admin_id, days=30), "residual:student")
    assert row["cost_median"] < row["cost_mean"], (
        "one $50 user must drag the mean and leave the median alone"
    )


async def test_opus_5_is_not_labelled_as_running(client: AsyncClient) -> None:
    """Prefix matching marked it configured: opus-5-5 starts with opus-5.

    Different models at different prices ($5/$25 vs $4/$20, and 0.1x vs
    0.05x on cache reads), so the label is a real mispricing cue.
    """
    w = await _seed(homework_submissions=1)
    body = await _get(client, w.admin_id, days=30)
    catalog = {m["id"]: m for m in body["model_catalog"]}
    assert catalog["claude-opus-5-5"]["is_configured"] is True
    assert catalog["claude-opus-5"]["is_configured"] is False


async def test_cache_write_mult_comes_from_the_catalog(
    client: AsyncClient,
) -> None:
    """A second copy of a rate, inside the panel built to detect drift."""
    from api.core.model_pricing import CACHE_WRITE_MULT

    w = await _seed(homework_submissions=1)
    for m in (await _get(client, w.admin_id, days=30))["model_catalog"]:
        assert m["cache_write_mult"] == pytest.approx(CACHE_WRITE_MULT)


async def test_reprice_source_is_chosen_by_spend_not_call_count(
    client: AsyncClient,
) -> None:
    """Many cheap calls must not set the profile for a few expensive ones."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        sub = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 1",
                ),
            )
        ).scalar_one()
        # Clear the seeded grading calls so this test measures only the
        # many-cheap vs few-expensive contrast it is about.
        await s.execute(text("DELETE FROM llm_calls WHERE function = 'ai_grading'"))
        for _ in range(20):
            s.add(
                LLMCall(
                    function="ai_grading", model="claude-haiku-4-5-20251001",
                    input_tokens=100, output_tokens=20, latency_ms=1.0,
                    cost_usd=0.0002, success=True,
                    school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        s.add(
            LLMCall(
                function="ai_grading", model=_OPUS,
                input_tokens=50_000, output_tokens=4_000, latency_ms=1.0,
                cost_usd=cost_usd(_price(_OPUS), 50_000, 4_000, 0, 0),
                success=True, school_id=uuid.UUID(w.school_id),
                submission_id=sub, created_at=_WHEN,
            ),
        )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    grading = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "ai_grading"
    ][0]
    assert grading["measured_model"] == _OPUS, (
        "21 calls dominated by Opus in SPEND, which is what the repriced "
        "cost is reconstructed from"
    )


# --------------------------------------------------------------------------
# Review round 2 — defects the round-1 fixes introduced or left behind
# --------------------------------------------------------------------------

async def _mixed_model_grading(w: _World) -> None:
    """One function spanning two models with very different per-call costs.

    This is the DEFAULT shape in the week after a model cutover, not a
    contrived case: the window starts at the first call on the new model
    while the old one is still serving.
    """
    async with get_session_factory()() as s:
        await s.execute(text("DELETE FROM llm_calls WHERE function = 'ai_grading'"))
        sub = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 1",
                ),
            )
        ).scalar_one()
        for _ in range(20):
            s.add(
                LLMCall(
                    function="ai_grading", model="claude-haiku-4-5-20251001",
                    input_tokens=100, output_tokens=20, latency_ms=1.0,
                    cost_usd=cost_usd(_price("claude-haiku-4-5"), 100, 20, 0, 0),
                    success=True, school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        s.add(
            LLMCall(
                function="ai_grading", model=_OPUS,
                input_tokens=50_000, output_tokens=4_000, latency_ms=1.0,
                cost_usd=cost_usd(_price(_OPUS), 50_000, 4_000, 0, 0),
                success=True, school_id=uuid.UUID(w.school_id),
                submission_id=sub, created_at=_WHEN,
            ),
        )
        await s.commit()


async def test_mixed_model_group_is_repriced_leg_by_leg(
    client: AsyncClient,
) -> None:
    """Repricing a group's TOTAL calls off one model's profile is wrong.

    `calls_per_unit` spans every model in the group. Multiplying it by a
    single model's token profile overstates a mixed group by the ratio
    between them — measured at 20.7x on this exact shape, in the number
    the margin is built from.
    """
    w = await _seed(homework_submissions=6)
    await _mixed_model_grading(w)

    body = await _get(client, w.admin_id, days=30)
    grading = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "ai_grading"
    ][0]

    # Priced on the models it really ran on, it must reproduce what we paid.
    assert grading["self_reprice"] == pytest.approx(
        grading["cost_per_unit"], rel=1e-6,
    )
    # And no target may be an order of magnitude off the measured cost
    # purely because one leg is expensive.
    assert grading["reprice"][_OPUS] < grading["cost_per_unit"] * 10


async def test_self_reprice_sums_to_the_unit_cost_across_every_family(
    client: AsyncClient,
) -> None:
    """The invariant the whole simulator rests on, including mixed groups."""
    w = await _seed(homework_submissions=6, generation_units=2)
    await _mixed_model_grading(w)

    body = await _get(client, w.admin_id, days=30)
    for kind, fns in body["functions_by_unit"].items():
        unit = [u for u in body["units"] if u["kind"] == kind]
        if not unit or unit[0]["cost_mean"] is None:
            continue
        total = 0.0
        for f in fns:
            assert f["self_reprice"] is not None, f"{kind}/{f['function']} unpriced"
            total += f["self_reprice"]
        assert total == pytest.approx(unit[0]["cost_mean"], rel=1e-6), (
            f"{kind}: legs repriced on their own models must sum to the "
            "measured unit cost"
        )


async def test_window_too_short_never_leaks_on_the_thin_branch(
    client: AsyncClient,
) -> None:
    """`and` short-circuits, so folding the pop into it left the key behind.

    The untested branch was the common one: every row with fewer than
    min_sample observations, including every row with none at all.
    """
    w = await _seed(homework_submissions=6)
    body = await _get(client, w.admin_id, days=30, min_sample=1000)

    for u in body["units"]:
        assert u["sufficient"] is False, "min_sample=1000 fails every row"
        # Present and typed, never a leaked internal — the page uses it to
        # say WHY a row is insufficient.
        assert isinstance(u["window_too_short"], bool)


async def test_thin_and_short_are_distinguishable(client: AsyncClient) -> None:
    """Sample size and window length are different problems.

    The page's warning copy blamed sample size for both, so an operator
    chasing a short-window artefact was sent to look at the wrong thing.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        for i in range(6):
            s.add(
                LLMCall(
                    function="step_chat", model=_SONNET,
                    input_tokens=500, output_tokens=200, latency_ms=1.0,
                    cost_usd=0.03, success=True,
                    school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]),
                    created_at=datetime.now(UTC) - timedelta(minutes=30),
                ),
            )
        await s.commit()

    short = _unit(await _get(client, w.admin_id, days=1), "residual:student")
    assert short["window_too_short"] is True
    assert short["n"] >= 5, "not thin — the window is the problem"

    wide = _unit(await _get(client, w.admin_id, days=30), "submission:homework")
    assert wide["window_too_short"] is False


async def test_dominant_model_is_stable_across_identical_requests(
    client: AsyncClient,
) -> None:
    """A bare max() returns whichever row Postgres emitted first.

    That flips the seeded picker and the trust check between identical
    requests whenever two models tie on spend.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        await s.execute(text("DELETE FROM llm_calls WHERE function = 'ai_grading'"))
        sub = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 1",
                ),
            )
        ).scalar_one()
        for model in (_OPUS, _SONNET):
            s.add(
                LLMCall(
                    function="ai_grading", model=model,
                    input_tokens=1_000, output_tokens=500, latency_ms=1.0,
                    cost_usd=0.01, success=True,  # deliberately identical
                    school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        await s.commit()

    seen = set()
    for _ in range(4):
        body = await _get(client, w.admin_id, days=30)
        grading = [
            f for f in body["functions_by_unit"]["submission:homework"]
            if f["function"] == "ai_grading"
        ][0]
        seen.add(grading["measured_model"])
    assert len(seen) == 1, f"tie broke differently across requests: {seen}"
