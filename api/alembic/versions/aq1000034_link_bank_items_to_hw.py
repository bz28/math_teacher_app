"""link bank items + generation jobs to their originating homework

Revision ID: aq1000034
Revises: ap1000033
Create Date: 2026-04-16 14:00:00.000000

Every AI-generated bank item is now born from a specific homework —
the teacher can only kick off generation from inside a HW. That
contract is enforced schema-side: `originating_assignment_id` is
NOT NULL on both the item and the job row, with ON DELETE CASCADE
so deleting a HW cleans up its problems.

Legacy bank data is wiped as part of the migration. The schools
platform is pre-launch, so a clean slate is expected and there is
no real content worth preserving. FKs with ON DELETE CASCADE on
bank_consumption and integrity_check_problems clean themselves up;
assignments.content.problems[].bank_item_id is JSON and may dangle,
which is acceptable for the throwaway dev/staging content being
wiped here.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aq1000034"
down_revision: str | None = "ap1000033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Pre-launch wipe so the NOT NULL add succeeds on envs that have
    # existing rows (prod). No-op on envs already at a clean slate
    # (CI, fresh local). See module docstring for the rationale.
    op.execute("DELETE FROM question_bank_items")
    op.execute("DELETE FROM question_bank_generation_jobs")

    op.add_column(
        "question_bank_items",
        sa.Column(
            "originating_assignment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_question_bank_items_originating_assignment_id",
        "question_bank_items",
        ["originating_assignment_id"],
    )
    op.add_column(
        "question_bank_generation_jobs",
        sa.Column(
            "originating_assignment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("question_bank_generation_jobs", "originating_assignment_id")
    op.drop_index(
        "ix_question_bank_items_originating_assignment_id",
        table_name="question_bank_items",
    )
    op.drop_column("question_bank_items", "originating_assignment_id")
