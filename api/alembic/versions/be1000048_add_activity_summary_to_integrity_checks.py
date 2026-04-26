"""add activity_summary to integrity_check_submissions

Revision ID: be1000048
Revises: bd1000047
Create Date: 2026-04-26 00:00:00.000000

Adds a precomputed `activity_summary` JSON blob to the
integrity-check-submission row. The blob rolls up per-turn telemetry
(focus/blur, paste, typing cadence) into a session-level level
(clean / notable / heavy), a totals dict the teacher panel can
display verbatim, and a list of notable turns with the reasons each
turn was flagged. Computed once at finish_check (and force-finalize)
so the queue overview can render an Activity pill without
loading every turn's telemetry per row.

Pre-launch: existing integrity_check_submissions rows get NULL and
will render as no-pill in the UI. No backfill — per CLAUDE.md.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "be1000048"
down_revision: str | None = "bd1000047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column("activity_summary", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("integrity_check_submissions", "activity_summary")
