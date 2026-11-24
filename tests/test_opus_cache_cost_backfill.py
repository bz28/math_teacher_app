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

import pytest

from api.core.model_pricing import cost_usd, price_for

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
