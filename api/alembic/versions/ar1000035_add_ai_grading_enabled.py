"""add ai_grading_enabled toggle to assignments

Revision ID: ar1000035
Revises: aq1000034
Create Date: 2026-04-16 17:30:00.000000

Independent toggle for the AI grading pipeline. Defaults to true so
existing HWs get auto-grading without teacher intervention.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ar1000035"
down_revision: str | None = "aq1000034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "ai_grading_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )


def downgrade() -> None:
    op.drop_column("assignments", "ai_grading_enabled")
