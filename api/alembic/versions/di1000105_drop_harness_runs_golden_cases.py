"""drop harness_runs and golden_cases.

Both tables only fed admin pages that are gone: harness_runs held the
autonomous improver's run summaries (529 rows, all from the removed
improver), golden_cases the never-populated eval golden set (0 rows). The
harness still writes its HTML reports to disk; nothing reads these tables.

Downgrade recreates both empty, exactly as their create migrations
(bs1000062, cc1000072) made them — the dropped rows are not restored.

Revision ID: di1000105
Revises: dh1000104
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "di1000105"
down_revision: str | None = "dh1000104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The indexes and the unique constraint go with their tables.
    op.drop_table("harness_runs")
    op.drop_table("golden_cases")


def downgrade() -> None:
    op.create_table(
        "harness_runs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("probe", sa.String(length=50), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("items_generated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("det_pass", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("det_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("captures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("judge_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("judge_mean", sa.Float(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("report_html", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index("ix_harness_runs_probe", "harness_runs", ["probe"])
    op.create_index("ix_harness_runs_created_at", "harness_runs", ["created_at"])

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
    op.create_unique_constraint(
        "uq_golden_cases_probe_name", "golden_cases", ["probe", "name"],
    )
