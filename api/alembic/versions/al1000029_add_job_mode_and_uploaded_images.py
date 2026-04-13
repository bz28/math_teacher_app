"""add mode and uploaded_images to question_bank_generation_jobs

Revision ID: al1000029
Revises: ak1000028
Create Date: 2026-04-13 10:00:00.000000

Supports worksheet upload: mode distinguishes generate vs upload jobs,
and uploaded_images stores the transient base64 images for extraction.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "al1000029"
down_revision: str | None = "ak1000028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_generation_jobs",
        sa.Column(
            "mode",
            sa.String(20),
            nullable=False,
            server_default="generate",
        ),
    )
    op.add_column(
        "question_bank_generation_jobs",
        sa.Column("uploaded_images", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_bank_generation_jobs", "uploaded_images")
    op.drop_column("question_bank_generation_jobs", "mode")
