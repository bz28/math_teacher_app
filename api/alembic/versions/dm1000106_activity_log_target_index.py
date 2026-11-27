"""index activity_log by target

The admin case file's grade timeline reads every row about one
submission and its homework (`target_type`, `target_id`); without an
index that is a scan of the whole log per case opened.

Revision ID: dm1000106
Revises: di1000105
"""
from collections.abc import Sequence

from alembic import op

revision: str = "dm1000106"
down_revision: str | None = "di1000105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_activity_log_target", "activity_log", ["target_type", "target_id"])


def downgrade() -> None:
    op.drop_index("ix_activity_log_target", table_name="activity_log")
