"""integrity adaptive probing: 4-way disposition, rubric, telemetry, inline variant

Revision ID: au1000038
Revises: at1000037
Create Date: 2026-04-22 00:00:00.000000

Pre-scale cutover for the adaptive-probing redesign. Replaces the
likely/uncertain/unlikely badge scheme with a four-way disposition
(PASS / NEEDS_PRACTICE / TUTOR_PIVOT / FLAG_FOR_REVIEW), adds a
six-dimension rubric per probed problem, adds behavioral telemetry
per student turn, and adds fields tracking which problem the pipeline
picked and the outcome of the inline disambiguator variant.

No real-user data is at stake (pre-launch), so old integrity checks
get cleared by this migration — dropping and adding columns keeps it
simple.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "au1000038"
down_revision: str | None = "at1000037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Clear out pre-launch integrity data so the schema swap is clean.
    # Turns cascade when their parent submission is deleted.
    op.execute("DELETE FROM integrity_check_submissions")

    # ── integrity_check_submissions ────────────────────────────────
    op.drop_column("integrity_check_submissions", "overall_badge")
    op.drop_column("integrity_check_submissions", "overall_confidence")
    op.add_column(
        "integrity_check_submissions",
        sa.Column("disposition", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column("probe_selection_reason", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column(
            "inline_variant_used",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column("inline_variant_result", sa.String(length=32), nullable=True),
    )

    # ── integrity_check_problems ──────────────────────────────────
    op.drop_column("integrity_check_problems", "badge")
    op.drop_column("integrity_check_problems", "confidence")
    op.add_column(
        "integrity_check_problems",
        sa.Column("rubric", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "integrity_check_problems",
        sa.Column("selected_reason", sa.String(length=32), nullable=True),
    )

    # ── integrity_conversation_turns ──────────────────────────────
    op.add_column(
        "integrity_conversation_turns",
        sa.Column("telemetry", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.execute("DELETE FROM integrity_check_submissions")

    op.drop_column("integrity_conversation_turns", "telemetry")

    op.drop_column("integrity_check_problems", "selected_reason")
    op.drop_column("integrity_check_problems", "rubric")
    op.add_column(
        "integrity_check_problems",
        sa.Column("confidence", sa.Float(), nullable=True),
    )
    op.add_column(
        "integrity_check_problems",
        sa.Column("badge", sa.String(length=20), nullable=True),
    )

    op.drop_column("integrity_check_submissions", "inline_variant_result")
    op.drop_column("integrity_check_submissions", "inline_variant_used")
    op.drop_column("integrity_check_submissions", "probe_selection_reason")
    op.drop_column("integrity_check_submissions", "disposition")
    op.add_column(
        "integrity_check_submissions",
        sa.Column("overall_confidence", sa.Float(), nullable=True),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column("overall_badge", sa.String(length=20), nullable=True),
    )
