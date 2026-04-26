"""require unit_id on documents and question_bank_items

Revision ID: bd1000047
Revises: bc1000046
Create Date: 2026-04-26 00:00:00.000000

Removes the "Uncategorized" bucket. Every document and question bank
item now belongs to a real unit. Pre-launch (no real users yet, per
CLAUDE.md), so we drop nullability directly without a backfill step
and switch the foreign-key behavior from ON DELETE SET NULL to
ON DELETE RESTRICT — the application layer blocks unit deletion
when contents exist and surfaces a "move them first" message
(teacher_units.delete_unit), so the database constraint is the
defense-in-depth backstop.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bd1000047"
down_revision: str | None = "bc1000046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # documents.unit_id: SET NULL → RESTRICT, then NOT NULL.
    op.drop_constraint("documents_unit_id_fkey", "documents", type_="foreignkey")
    op.create_foreign_key(
        "documents_unit_id_fkey",
        "documents", "units",
        ["unit_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.alter_column("documents", "unit_id", nullable=False)

    # question_bank_items.unit_id: SET NULL → RESTRICT, then NOT NULL.
    op.drop_constraint(
        "question_bank_items_unit_id_fkey",
        "question_bank_items",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "question_bank_items_unit_id_fkey",
        "question_bank_items", "units",
        ["unit_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.alter_column("question_bank_items", "unit_id", nullable=False)

    # question_bank_generation_jobs.unit_id: same treatment. With
    # Uncategorized removed at the modal level, every job is for a
    # real unit; making the column NOT NULL kills the no-unit fallback
    # branch in core/question_bank_generation.py.
    op.drop_constraint(
        "question_bank_generation_jobs_unit_id_fkey",
        "question_bank_generation_jobs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "question_bank_generation_jobs_unit_id_fkey",
        "question_bank_generation_jobs", "units",
        ["unit_id"], ["id"],
        ondelete="RESTRICT",
    )
    op.alter_column("question_bank_generation_jobs", "unit_id", nullable=False)


def downgrade() -> None:
    op.alter_column("question_bank_generation_jobs", "unit_id", nullable=True)
    op.drop_constraint(
        "question_bank_generation_jobs_unit_id_fkey",
        "question_bank_generation_jobs",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "question_bank_generation_jobs_unit_id_fkey",
        "question_bank_generation_jobs", "units",
        ["unit_id"], ["id"],
        ondelete="SET NULL",
    )

    op.alter_column("question_bank_items", "unit_id", nullable=True)
    op.drop_constraint(
        "question_bank_items_unit_id_fkey",
        "question_bank_items",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "question_bank_items_unit_id_fkey",
        "question_bank_items", "units",
        ["unit_id"], ["id"],
        ondelete="SET NULL",
    )

    op.alter_column("documents", "unit_id", nullable=True)
    op.drop_constraint("documents_unit_id_fkey", "documents", type_="foreignkey")
    op.create_foreign_key(
        "documents_unit_id_fkey",
        "documents", "units",
        ["unit_id"], ["id"],
        ondelete="SET NULL",
    )
