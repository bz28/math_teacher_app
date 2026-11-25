"""The dh1000104 backfill agrees with what the code now charges.

A data migration and the live pricing path are two implementations of the
same arithmetic, which is exactly how they drift. This pins them together:
rebuild a row the way the migration does, and assert it lands on the
number `cost_usd()` would produce today.

Also pins the scope. The migration must touch Opus 5.5 rows that read
cache and nothing else — a wider filter would corrupt correctly-priced
history, and for pre-2026-07-27 rows (cache counts backfilled to 0,
meaning "never measured") it would invent a correction from a zero.
"""

import uuid as _uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from api.alembic.versions import (  # type: ignore[import-not-found]
    dh1000104_recompute_opus_cache_read_cost as mig,
)
from api.core.model_pricing import cost_usd, price_for
from api.database import get_session_factory

_MIGRATION_OPUS_INPUT_PER_TOKEN = 4.0 / 1_000_000
_MIGRATION_WRONG_READ_MULT = 0.1
_MIGRATION_CORRECT_READ_MULT = 0.05


def _opus():
    p = price_for("claude-opus-5-5")
    assert p is not None
    return p


def _cost_under_old_flat_rate(
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cache_write_tokens: int,
) -> float:
    """What llm_client wrote to cost_usd before model_pricing landed."""
    p = _opus()
    return (
        input_tokens * p.input_per_token
        + output_tokens * p.output_per_token
        + cache_read_tokens * p.input_per_token * _MIGRATION_WRONG_READ_MULT
        + cache_write_tokens * p.input_per_token * 1.25
    )


def _migration_delta(cache_read_tokens: int) -> float:
    """The exact expression dh1000104 subtracts from cost_usd."""
    return (
        cache_read_tokens
        * _MIGRATION_OPUS_INPUT_PER_TOKEN
        * (_MIGRATION_WRONG_READ_MULT - _MIGRATION_CORRECT_READ_MULT)
    )


@pytest.mark.parametrize(
    ("fresh_in", "out", "cache_read", "cache_write"),
    [
        (120, 30, 4_096, 0),
        (4_200, 850, 38_000, 0),
        (0, 1, 1, 0),
        (9_000, 2_400, 120_000, 8_000),
    ],
)
def test_migration_lands_on_the_price_the_code_now_charges(
    fresh_in: int, out: int, cache_read: int, cache_write: int,
) -> None:
    stored = _cost_under_old_flat_rate(fresh_in, out, cache_read, cache_write)
    corrected = stored - _migration_delta(cache_read)

    assert corrected == pytest.approx(
        cost_usd(_opus(), fresh_in, out, cache_read, cache_write),
    )


def test_migration_rate_matches_the_catalog() -> None:
    """The migration hardcodes $4/MTok because SQL can't import the catalog.

    If the published Opus 5.5 input rate ever changes, the catalog moves
    and this fails — which is the signal that the already-applied
    migration priced history at a rate we no longer believe.
    """
    assert _opus().input_per_token == pytest.approx(_MIGRATION_OPUS_INPUT_PER_TOKEN)
    assert _opus().cache_read_mult == pytest.approx(_MIGRATION_CORRECT_READ_MULT)


def test_correction_only_ever_reduces_cost() -> None:
    assert _migration_delta(38_000) > 0
    assert _migration_delta(0) == 0


def test_rows_without_cache_reads_are_unaffected() -> None:
    """Why the migration filters on cache_read_tokens > 0."""
    stored = _cost_under_old_flat_rate(1_000, 500, 0, 0)
    assert stored == pytest.approx(cost_usd(_opus(), 1_000, 500, 0, 0))
    assert _migration_delta(0) == 0


def test_other_models_must_not_be_in_scope() -> None:
    """Sonnet/Haiku were always priced right; correcting them would corrupt."""
    for model_id in ("claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-5"):
        p = price_for(model_id)
        assert p is not None
        assert p.cache_read_mult == pytest.approx(_MIGRATION_WRONG_READ_MULT), (
            f"{model_id} shares the 0.1x rate, so its stored cost is already "
            "correct and dh1000104 must not touch it"
        )
        assert not model_id.startswith("claude-opus-5-5")


# --------------------------------------------------------------------------
# The SQL itself, not just the arithmetic
# --------------------------------------------------------------------------
#
# Everything above pins the FORMULA. It never runs the migration, so the
# LIKE pattern, the WHERE clause, the created_at bound, the float8/numeric
# interaction and idempotency were all unexercised — and the scope is the
# part that can corrupt rows rather than merely mis-state them.

# Scope is self-identifying now, so these only need to be plausible.
_BEFORE = datetime(2026, 11, 20, tzinfo=UTC)
_AFTER = datetime(2026, 11, 24, tzinfo=UTC) + timedelta(days=1)

# What the old and new formulas produce for 1000 in / 500 out / 38k reads.
_OLD = 1_000 * 4e-6 + 500 * 20e-6 + 38_000 * 4e-6 * 0.1
_NEW = 1_000 * 4e-6 + 500 * 20e-6 + 38_000 * 4e-6 * 0.05


async def _row(
    *, model: str, cache_read: int, created_at: datetime, cost: float,
) -> _uuid.UUID:
    rid = _uuid.uuid4()
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "INSERT INTO llm_calls (id, function, model, input_tokens, "
                "output_tokens, cache_read_tokens, cache_write_tokens, "
                "latency_ms, cost_usd, success, retry_count, created_at) "
                "VALUES (:id, 'integrity_extract', :m, 1000, 500, :cr, 0, "
                "1.0, :c, true, 0, :t)",
            ),
            {"id": rid, "m": model, "cr": cache_read, "c": cost, "t": created_at},
        )
        await s.commit()
    return rid


async def _cost(rid: _uuid.UUID) -> float:
    async with get_session_factory()() as s:
        return float(
            (
                await s.execute(
                    text("SELECT cost_usd FROM llm_calls WHERE id = :i"),
                    {"i": rid},
                )
            ).scalar_one(),
        )


async def _run(sql: str) -> None:
    async with get_session_factory()() as s:
        await s.execute(text(sql))
        await s.commit()


_UPGRADE = f"UPDATE llm_calls SET cost_usd = {mig._NEW_R} WHERE {mig.UPGRADE_SCOPE}"
_DOWNGRADE = f"UPDATE llm_calls SET cost_usd = {mig._OLD_R} WHERE {mig.DOWNGRADE_SCOPE}"


async def test_upgrade_sql_corrects_only_rows_in_scope() -> None:
    """Runs the real statement, not a Python restatement of it."""
    target = await _row(
        model="claude-opus-5-5", cache_read=38_000, created_at=_BEFORE, cost=_OLD,
    )
    no_cache = await _row(
        model="claude-opus-5-5", cache_read=0, created_at=_BEFORE, cost=0.014,
    )
    sonnet = await _row(
        model="claude-sonnet-4-6", cache_read=20_000, created_at=_BEFORE, cost=0.0165,
    )
    # Shorter id that the LIKE pattern must NOT match.
    opus5 = await _row(
        model="claude-opus-5", cache_read=38_000, created_at=_BEFORE, cost=_OLD,
    )

    await _run(_UPGRADE)

    assert await _cost(target) == pytest.approx(_NEW)
    assert await _cost(no_cache) == pytest.approx(0.014)
    assert await _cost(sonnet) == pytest.approx(0.0165)
    assert await _cost(opus5) == pytest.approx(_OLD), (
        "LIKE 'claude-opus-5-5%' must not match the shorter 'claude-opus-5'"
    )


async def test_rows_the_new_code_priced_are_never_corrected_again() -> None:
    """These were written at 0.05x and carry no error.

    A time-bounded filter could not tell them apart, so a downgrade would
    add a delta they never carried and over-price live history. Matching
    the old formula distinguishes them exactly.
    """
    fresh = await _row(
        model="claude-opus-5-5", cache_read=38_000, created_at=_AFTER, cost=_NEW,
    )
    await _run(_UPGRADE)
    assert await _cost(fresh) == pytest.approx(_NEW), (
        "an already-correct row must not be corrected a second time"
    )


async def test_upgrade_is_idempotent() -> None:
    """A replay must be a no-op, not a second halving.

    This is what makes the rolling-deploy residue safe to clean up: the
    old container keeps writing flat-rate rows after the migration has
    run, and re-running it fixes exactly those.
    """
    rid = await _row(
        model="claude-opus-5-5", cache_read=38_000, created_at=_BEFORE, cost=_OLD,
    )
    await _run(_UPGRADE)
    once = await _cost(rid)
    await _run(_UPGRADE)
    await _run(_UPGRADE)
    assert await _cost(rid) == pytest.approx(once)
    assert once == pytest.approx(_NEW)


async def test_replay_corrects_rows_written_after_the_first_run() -> None:
    """The rolling-deploy case, end to end."""
    already = await _row(
        model="claude-opus-5-5", cache_read=38_000, created_at=_BEFORE, cost=_OLD,
    )
    await _run(_UPGRADE)
    # The old container is still serving and writes another flat-rate row.
    straggler = await _row(
        model="claude-opus-5-5", cache_read=38_000, created_at=_AFTER, cost=_OLD,
    )
    await _run(_UPGRADE)
    assert await _cost(straggler) == pytest.approx(_NEW)
    assert await _cost(already) == pytest.approx(_NEW), "and not re-corrected"


async def test_downgrade_is_a_true_inverse_and_idempotent() -> None:
    rid = await _row(
        model="claude-opus-5-5", cache_read=38_000, created_at=_BEFORE, cost=_OLD,
    )
    await _run(_UPGRADE)
    await _run(_DOWNGRADE)
    assert await _cost(rid) == pytest.approx(_OLD)
    await _run(_DOWNGRADE)
    assert await _cost(rid) == pytest.approx(_OLD), "replay must not re-add"


async def test_tiny_cache_reads_are_never_double_corrected() -> None:
    """The case an absolute tolerance got wrong.

    cost_usd is stored as round(cost, 6), so a row sits up to 5e-7 from
    its own formula — which exceeded the old delta/2 band whenever
    cache_read_tokens was small. At cache_read_tokens = 3 a row the NEW
    code wrote fell inside the upgrade scope and was shaved a second
    time. Matching rounded-to-rounded has no band to straddle.
    """
    for cr in (1, 2, 3, 4, 5, 1024):
        correct = round(
            1_000 * 4e-6 + 500 * 20e-6 + cr * 4e-6 * 0.05, 6,
        )
        rid = await _row(
            model="claude-opus-5-5", cache_read=cr,
            created_at=_AFTER, cost=correct,
        )
        await _run(_UPGRADE)
        assert await _cost(rid) == pytest.approx(correct), (
            f"cache_read={cr}: an already-correct row was corrected again"
        )


async def test_small_cache_reads_are_still_corrected_when_wrong() -> None:
    """And the mirror: an old-code row must not be skipped."""
    for cr in (1024, 8192, 38_000):
        old = round(1_000 * 4e-6 + 500 * 20e-6 + cr * 4e-6 * 0.1, 6)
        new = round(1_000 * 4e-6 + 500 * 20e-6 + cr * 4e-6 * 0.05, 6)
        rid = await _row(
            model="claude-opus-5-5", cache_read=cr,
            created_at=_BEFORE, cost=old,
        )
        await _run(_UPGRADE)
        assert await _cost(rid) == pytest.approx(new), f"cache_read={cr}"
