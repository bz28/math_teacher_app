"""drop IntegrityCheckSubmission.student_flagged_extraction

Revision ID: ba1000044
Revises: az1000043
Create Date: 2026-04-23 23:30:00.000000

Post-gating (see ay1000042) the "Reader got something wrong" signal
lives on `submissions.extraction_flagged_at` instead. The
IntegrityCheckSubmission-level flag is no longer reachable from any
UI path: the old flag endpoint is removed in the same commit. Drop
the column to prevent drift where new code could accidentally set
the dead flag and the teacher UI silently read it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ba1000044"
down_revision: str | None = "az1000043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("integrity_check_submissions", "student_flagged_extraction")


def downgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column(
            "student_flagged_extraction",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
