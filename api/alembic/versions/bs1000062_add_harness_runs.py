"""add harness_runs table.

Run-level summaries for the autonomous test harness (tests/harness),
surfaced in the admin dashboard's "Harness Runs" tab. The harness runs
against a separate DB but writes these summaries into the main app DB so
the dashboard can show history/scores/cost without a cross-DB connection.

Revision ID: bs1000062
Revises: br1000061
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bs1000062"
down_revision: str | None = "br1000061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
        sa.Column("report_path", sa.Text(), nullable=True),
        sa.Column("report_html", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index("ix_harness_runs_probe", "harness_runs", ["probe"])
    op.create_index("ix_harness_runs_created_at", "harness_runs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_harness_runs_created_at", table_name="harness_runs")
    op.drop_index("ix_harness_runs_probe", table_name="harness_runs")
    op.drop_table("harness_runs")
