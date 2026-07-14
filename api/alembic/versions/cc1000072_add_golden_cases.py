"""add golden_cases table.

The curated eval golden set (regression corpus) plus each case's most-recent
eval outcome, surfaced in the admin dashboard's "Generation QA" tab. The
harness upserts these rows into the main app DB after each corpus run so the
dashboard shows live per-case pass/fail and catches regressions.

Revision ID: cc1000072
Revises: cb1000071
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cc1000072"
down_revision: str | None = "cb1000071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "golden_cases",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("probe", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("constraint", sa.Text(), nullable=False),
        sa.Column("adversarial", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("expected_shapes", postgresql.JSONB(), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("last_status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("prev_status", sa.String(length=12), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_model", sa.String(length=80), nullable=True),
        sa.Column("last_run_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("last_output", sa.Text(), nullable=True),
        sa.Column("rerun_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retired", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index("ix_golden_cases_probe", "golden_cases", ["probe"])
    # One row per (probe, name) — the natural key the harness upserts on.
    op.create_unique_constraint(
        "uq_golden_cases_probe_name", "golden_cases", ["probe", "name"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_golden_cases_probe_name", "golden_cases", type_="unique")
    op.drop_index("ix_golden_cases_probe", table_name="golden_cases")
    op.drop_table("golden_cases")
