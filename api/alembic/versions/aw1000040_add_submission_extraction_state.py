"""extraction state on submissions

Revision ID: aw1000040
Revises: av1000039
Create Date: 2026-04-23 00:00:00.000000

Adds the columns the student extraction-confirmation flow needs:
  extraction_status      — pending / awaiting_confirmation / confirmed / unreadable_final
  extraction_attempts    — number of Vision passes burned on this submission
  raw_extraction         — what Vision read on the latest successful pass
  confirmed_extraction   — what the student approved (possibly edited)

Existing submissions were created under the old fire-and-forget
pipeline (extraction ran silently, grading auto-ran). Backfilled to
`extraction_status='confirmed'` so the new flow doesn't accidentally
show a "please confirm your extraction" screen for HWs that already
have grades. Confirmed-but-no-extraction is benign — the status just
means "move on to grading" to new code paths.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aw1000040"
down_revision: str | None = "av1000039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column(
            "extraction_status",
            sa.String(length=32),
            nullable=False,
            server_default="confirmed",
        ),
    )
    op.add_column(
        "submissions",
        sa.Column(
            "extraction_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "submissions",
        sa.Column("raw_extraction", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column("confirmed_extraction", postgresql.JSON(), nullable=True),
    )
    # Drop the server_default for extraction_status so new rows must go
    # through the Python layer (which defaults to 'pending' for fresh
    # submissions under the new flow). Existing rows already backfilled
    # to 'confirmed' by the add_column server_default above.
    op.alter_column(
        "submissions", "extraction_status", server_default=None,
    )


def downgrade() -> None:
    op.drop_column("submissions", "confirmed_extraction")
    op.drop_column("submissions", "raw_extraction")
    op.drop_column("submissions", "extraction_attempts")
    op.drop_column("submissions", "extraction_status")
