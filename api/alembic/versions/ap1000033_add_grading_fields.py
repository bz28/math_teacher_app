"""add rubric, breakdown, grade_published_at for grading workflow

Revision ID: ap1000033
Revises: ao1000032
Create Date: 2026-04-16 10:00:00.000000

v1 teacher-grading workflow scaffolding. `rubric` is a structured
JSON blob (grading mode + full/partial criteria + optional notes)
authored now and consumed by the AI grader in a follow-up PR.
`breakdown` is a per-problem grade JSON — authoritative final grades,
agnostic to AI vs teacher authorship. `grade_published_at` drives
student visibility: null = teacher draft, set = students see the
grade.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ap1000033"
down_revision: str | None = "ao1000032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("rubric", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "submission_grades",
        sa.Column("breakdown", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "submission_grades",
        sa.Column("grade_published_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submission_grades", "grade_published_at")
    op.drop_column("submission_grades", "breakdown")
    op.drop_column("assignments", "rubric")
