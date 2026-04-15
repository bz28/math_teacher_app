"""add student_flagged_extraction to integrity_check_submissions

Revision ID: ao1000032
Revises: an1000031
Create Date: 2026-04-15 14:30:00.000000

Adds a boolean flag the student sets from the post-extraction confirm
screen when the Vision reader misread their handwritten work. Teacher
sees the flag on the submission detail panel and can weigh the check
accordingly. Additive, no backfill needed — existing rows get the
default `false`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ao1000032"
down_revision: str | None = "an1000031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column(
            "student_flagged_extraction",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("integrity_check_submissions", "student_flagged_extraction")
