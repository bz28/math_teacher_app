"""add prompt-cache token columns to llm_calls.

Anthropic reports prompt-cache traffic in `cache_read_input_tokens` and
`cache_creation_input_tokens`, which are SEPARATE from `input_tokens` —
we were dropping both on the floor, so cost_usd undercounted cached calls
and there was no way to see whether our cache_control was ever hitting.

Existing rows are backfilled to 0 (not NULL): those calls were made
before the instrumentation existed, so their real cache split is
unknowable. 0 means "unmeasured" and keeps the columns NOT NULL so
downstream SUM()s never have to coalesce. Their persisted `cost_usd` is
deliberately left untouched — it is the amount we actually recorded at
the time, and rewriting history would desync the admin dashboard's
spend totals from what was already reported.

Revision ID: cd1000073
Revises: cc1000072
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cd1000073"
down_revision: str | None = "cc1000072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default="0" backfills every existing row in the same
    # statement — no separate UPDATE pass needed, and no window where a
    # live row is NULL for a NOT NULL column.
    op.add_column(
        "llm_calls",
        sa.Column(
            "cache_read_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "llm_calls",
        sa.Column(
            "cache_write_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_calls", "cache_write_tokens")
    op.drop_column("llm_calls", "cache_read_tokens")
