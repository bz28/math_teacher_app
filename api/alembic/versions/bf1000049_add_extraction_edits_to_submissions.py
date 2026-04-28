"""add extraction_edits + extraction_edited_at to submissions

Revision ID: bf1000049
Revises: be1000048
Create Date: 2026-04-28 00:00:00.000000

Adds two columns to `submissions` so a student can correct Vision's
OCR misreads on the post-submit confirm screen before AI grading runs.

- extraction_edits: sparse JSON map keyed by "{problem_position}:{step_num}"
  (for steps) and "{problem_position}:final" (for final answers). Value
  is the student-supplied plain-English text. Null when the student made
  no edits — the original Vision extraction stands.
- extraction_edited_at: timestamp stamped when the student saved any
  edits at confirm time. Null when there were no edits.

The original Vision output stays in `submissions.extraction` (immutable
source of truth). Edits are an overlay applied at grading + teacher-
review render time so the original is always preserved for audit.

Pre-launch: no real users; no backfill.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bf1000049"
down_revision: str | None = "be1000048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("extraction_edits", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "submissions",
        sa.Column(
            "extraction_edited_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("submissions", "extraction_edited_at")
    op.drop_column("submissions", "extraction_edits")
