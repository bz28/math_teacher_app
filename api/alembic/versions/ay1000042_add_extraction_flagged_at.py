"""record student-flagged extractions on submissions

Revision ID: ay1000042
Revises: ax1000041
Create Date: 2026-04-23 19:00:00.000000

Adds `submissions.extraction_flagged_at`: timestamp stamped when the
student hits "Reader got something wrong" on the post-submit confirm
screen. Pairs with `extraction_confirmed_at` as mutually-exclusive
terminal signals — a submission is either confirmed (grading ran) or
flagged (goes to the teacher for manual grading, no AI calls
downstream).

Previously the flag lived on `IntegrityCheckSubmission.student_flagged_extraction`,
but post-gating the IntegrityCheckSubmission row isn't created until
the student confirms. A student who flags BEFORE confirming has no
integrity row to write to — hence moving the flag to the submission
row where it's always addressable.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ay1000042"
down_revision: str | None = "ax1000041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column(
            "extraction_flagged_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("submissions", "extraction_flagged_at")
