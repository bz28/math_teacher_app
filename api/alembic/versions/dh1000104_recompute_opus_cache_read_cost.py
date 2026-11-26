"""Recompute cost_usd on Opus 5.5 rows priced with the wrong cache-read rate

Revision ID: dh1000104
Revises: dg1000103
Create Date: 2026-11-24 00:00:00.000000

Until api/core/model_pricing.py landed, llm_client priced a prompt-cache
HIT at a flat 0.1x base input for every model. Anthropic prices that
per-model, and Opus 5.5 reads a cached prefix at 0.05x. So every Opus 5.5
call we logged charged itself twice what the cache read actually cost, and
the admin spend dashboard has been OVERSTATING our spend since Opus 5.5
went live on 2026-10-28.

This rewrites those rows from the token counts already stored on them.
Nothing is estimated: input/output/cache_read/cache_write are all
recorded per call, so the corrected figure is the same arithmetic the
code now does, applied to history.

Scope and safety
----------------
- Only `claude-opus-5-5%` rows. Every other model's 0.1x read multiplier
  was and remains correct, so their cost_usd is untouched.
- Only rows with cache_read_tokens > 0. A call that read no cache was
  priced correctly either way; rewriting it would be churn.
- Cache-token instrumentation landed 2026-07-27 (f011e50f) and Opus 5.5
  landed 2026-10-28, so every row in scope has real counts. Pre-instrument
  rows carry a backfilled 0 meaning "not measured", and would be silently
  mispriced by this arithmetic — they are excluded by the > 0 filter and
  by model, belt and braces.
- The correction can only move cost DOWN. The migration raises a NOTICE
  with the before/after totals so the deploy log records what we had
  overstated.
- Self-identifying rather than time-bounded: a row is in scope only if
  its stored cost still matches what the OLD formula produces. Both
  directions are therefore idempotent, and neither can touch a row the
  other already handled.

Rolling-deploy residue is self-healing as a result: the old container
keeps writing flat-rate rows after this runs, and replaying the migration
corrects exactly those without disturbing anything else.

Rates used (published, checked 2026-11-24): Opus 5.5 input $4/MTok.
Correction per row = cache_read_tokens * $4e-6 * (0.1 - 0.05).
"""
from collections.abc import Sequence

from alembic import op

revision: str = "dh1000104"
down_revision: str | None = "dg1000103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Opus 5.5 published rates, USD per token.
_OPUS_INPUT_PER_TOKEN = 4.0 / 1_000_000
_OPUS_OUTPUT_PER_TOKEN = 20.0 / 1_000_000
_CACHE_WRITE_MULT = 1.25
_WRONG_READ_MULT = 0.1
_CORRECT_READ_MULT = 0.05

# Rows written by the OLD code — the only ones carrying the error.
#
# Identified by RECOMPUTING what the old formula would have produced and
# matching the stored value against it, rather than by a timestamp.
#
# A date cutoff cannot express this. Pinned to the authoring date it
# misses every row the old container wrote between authoring and deploy
# (days, on a branch -> PR -> CI -> merge workflow) and those stay
# overstated forever. Pinned to now() it is complete going forward but
# makes `downgrade` add a delta to every row the NEW code has since
# written correctly, over-pricing live history.
#
# Matching the formula has neither failure. It is exact (every input to
# the old computation is stored on the row), complete (no time bound to
# miss rows), and idempotent in both directions: once corrected a row no
# longer matches the old formula, so a replayed upgrade is a no-op, and
# a downgrade only touches rows matching the NEW one.
_OLD_COST = (
    f"(input_tokens * {_OPUS_INPUT_PER_TOKEN!r} "
    f"+ output_tokens * {_OPUS_OUTPUT_PER_TOKEN!r} "
    f"+ cache_read_tokens * {_OPUS_INPUT_PER_TOKEN!r} * {_WRONG_READ_MULT!r} "
    f"+ cache_write_tokens * {_OPUS_INPUT_PER_TOKEN!r} * {_CACHE_WRITE_MULT!r})"
)
_NEW_COST = (
    f"(input_tokens * {_OPUS_INPUT_PER_TOKEN!r} "
    f"+ output_tokens * {_OPUS_OUTPUT_PER_TOKEN!r} "
    f"+ cache_read_tokens * {_OPUS_INPUT_PER_TOKEN!r} * {_CORRECT_READ_MULT!r} "
    f"+ cache_write_tokens * {_OPUS_INPUT_PER_TOKEN!r} * {_CACHE_WRITE_MULT!r})"
)

_BASE = "model LIKE 'claude-opus-5-5%' AND cache_read_tokens > 0"

_DELTA = (
    f"cache_read_tokens * {_OPUS_INPUT_PER_TOKEN!r} "
    f"* ({_WRONG_READ_MULT!r} - {_CORRECT_READ_MULT!r})"
)

# Matched on the ROUNDED value, because that is literally what was
# stored: llm_client writes `round(cost, 6)` (llm_client.py:359, :374).
#
# An absolute tolerance was the wrong tool. The earlier `delta/2` band
# was justified as absorbing "float8 round-trip noise" (~1e-16), but the
# real discrepancy is the 1e-6 quantisation, up to 5e-7 — which exceeds
# delta/2 whenever cache_read_tokens is small. At cache_read_tokens = 3 a
# row the NEW code wrote lands 2.0e-7 from the old formula against a
# 3.0e-7 band, so it would be "corrected" a second time. Unreachable in
# practice (Anthropic's minimum cacheable prefix is 1024 tokens, where
# the margin is ~200x), but the reasoning was wrong and the SQL-level
# tests only ever exercised cache_read = 38,000.
#
# Comparing rounded to rounded needs no tolerance at all and is exact at
# every token count. The `<>` guard skips rows where the correction is
# below storage precision and the two forms are indistinguishable —
# nothing to correct there anyway.
_ROUND = "round(({expr})::numeric, 6)"
_STORED = "round(cost_usd::numeric, 6)"
_OLD_R = _ROUND.format(expr=_OLD_COST)
_NEW_R = _ROUND.format(expr=_NEW_COST)

UPGRADE_SCOPE = f"{_BASE} AND {_STORED} = {_OLD_R} AND {_OLD_R} <> {_NEW_R}"
DOWNGRADE_SCOPE = f"{_BASE} AND {_STORED} = {_NEW_R} AND {_OLD_R} <> {_NEW_R}"

def _report(direction: str) -> str:
    return f"""
    DO $$
    DECLARE
        n bigint;
        shift double precision;
    BEGIN
        SELECT count(*), COALESCE(sum({_DELTA}), 0)
          INTO n, shift
          FROM llm_calls
         WHERE {UPGRADE_SCOPE};
        RAISE NOTICE
            'dh1000104: % Opus 5.5 rows {direction} by $% (cache-read 0.1x -> 0.05x)',
            n, round(shift::numeric, 4);
    END $$;
    """


def upgrade() -> None:
    op.execute(_report("corrected down"))
    op.execute(
        f"UPDATE llm_calls SET cost_usd = {_NEW_R} WHERE {UPGRADE_SCOPE}",
    )


def downgrade() -> None:
    """Restore the flat 0.1x figure these rows were originally written with.

    Matches rows priced the NEW way, so it cannot reach a row the old
    code wrote or double-apply on a replay.
    """
    op.execute(
        f"UPDATE llm_calls SET cost_usd = {_OLD_R} WHERE {DOWNGRADE_SCOPE}",
    )
