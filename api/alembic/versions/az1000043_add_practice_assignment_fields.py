"""add source_homework_id to assignments for practice-from-HW cloning

Revision ID: az1000043
Revises: ay1000042
Create Date: 2026-04-23 22:00:00.000000

Adds `assignments.source_homework_id`: nullable self-referential FK that
points at the homework a practice set was cloned from. Only set when a
teacher clicks "Clone from a homework" in the new Practice tab wizard.
ON DELETE SET NULL so deleting the source HW doesn't cascade-nuke the
practice set — the practice stays usable, just loses its "Cloned from"
label.

The `type` column stays a free-form String(20); the validator in
CreateAssignmentRequest is what gates accepted values. That validator
extends to accept "practice" in the same PR.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "az1000043"
down_revision: str | None = "ay1000042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "source_homework_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_assignments_source_homework_id",
        "assignments",
        ["source_homework_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_assignments_source_homework_id", table_name="assignments")
    op.drop_column("assignments", "source_homework_id")
