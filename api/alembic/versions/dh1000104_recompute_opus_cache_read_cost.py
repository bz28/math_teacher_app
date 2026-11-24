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
- Bounded by `created_at` so neither direction can touch a row the new
  code wrote at the correct rate. Without that bound a `downgrade` would
  over-price every row written since the deploy, because the filter
  cannot otherwise tell corrected rows from never-wrong ones.

Known residue: during a rolling deploy the old container keeps writing
Opus rows at the flat 0.1x after this has run. Those stay overstated.
The direction is conservative and the window is one deploy, but it is
why the reconciliation panel may show a small permanent gap for a window
spanning the release.

Rates used (published, checked 2026-11-24): Opus 5.5 input $4/MTok.
Correction per row = cache_read_tokens * $4e-6 * (0.1 - 0.05).
"""
from collections.abc import Sequence

from alembic import op

revision: str = "dh1000104"
down_revision: str | None = "dg1000103"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Opus 5.5 base input rate, USD per token.
_OPUS_INPUT_PER_TOKEN = 4.0 / 1_000_000
_WRONG_READ_MULT = 0.1
_CORRECT_READ_MULT = 0.05

# Rows written by the OLD code — the only ones that carry the error.
#
# The cutoff is what makes this safe in both directions. Without it the
# WHERE clause cannot tell a mispriced row from one the new code wrote
# correctly at 0.05x, so `downgrade` would add the delta to rows that
# never had it and OVER-price current history. The upgrade has the mirror
# hazard if it is ever replayed.
#
# Set to the moment this migration was authored. Every row in scope
# predates the deploy that runs it; rows the new code writes afterwards
# are outside the window and are left alone by both directions.
_WRITTEN_BY_OLD_CODE_BEFORE = "2026-11-24 00:00:00+00"

_SCOPE = (
    "model LIKE 'claude-opus-5-5%' "
    "AND cache_read_tokens > 0 "
    f"AND created_at < TIMESTAMPTZ '{_WRITTEN_BY_OLD_CODE_BEFORE}'"
)
_DELTA = (
    f"cache_read_tokens * {_OPUS_INPUT_PER_TOKEN!r} "
    f"* ({_WRONG_READ_MULT!r} - {_CORRECT_READ_MULT!r})"
)


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
         WHERE {_SCOPE};
        RAISE NOTICE
            'dh1000104: % Opus 5.5 rows {direction} by $% (cache-read 0.1x -> 0.05x)',
            n, round(shift::numeric, 4);
    END $$;
    """


def upgrade() -> None:
    op.execute(_report("corrected down"))
    op.execute(f"UPDATE llm_calls SET cost_usd = cost_usd - ({_DELTA}) WHERE {_SCOPE}")


def downgrade() -> None:
    """Restore the flat 0.1x figure these rows were originally written with.

    Bounded by the same cutoff as the upgrade, so it cannot reach rows the
    new code already priced correctly.
    """
    op.execute(f"UPDATE llm_calls SET cost_usd = cost_usd + ({_DELTA}) WHERE {_SCOPE}")
