"""unique constraint on (assignment_id, student_id) for submissions

Revision ID: ai1000026
Revises: ah1000025
Create Date: 2026-04-08 17:30:00.000000

The new submit endpoint guards against double-submit with a SELECT-
then-INSERT pattern, which has a race window where two parallel
requests can both pass the check and create duplicate rows. Lock it
down at the DB level. v1 enforces "one submission per (student, HW)"
at the product layer, so this matches the spec exactly.

No backfill: a clean local dev DB has no duplicates. If a stale dev
DB does, the upgrade will fail loudly and the dev can clean
manually — better than silently ignoring it.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "ai1000026"
down_revision: str | None = "ah1000025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_submissions_assignment_student",
        "submissions",
        ["assignment_id", "student_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_submissions_assignment_student",
        "submissions",
        type_="unique",
    )
