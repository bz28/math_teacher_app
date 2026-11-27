"""remember the resolution a teacher's last resolve replaced, for Undo

Revision ID: dk1000107
Revises: dj1000106
Create Date: 2026-11-26 00:00:00.000000

The review page raises an Undo toast for ~8 s after every resolve of an
integrity check. Undo must put back exactly what was there before —
the outcome AND who resolved it and when (a co-teacher's resolution
from last week must not come back stamped as "you, just now"). The
client can't be trusted to send who/when, so the server keeps the
replaced state in three nullable columns, written by each resolve and
cleared by the undo.

No backfill: NULL means "nothing to undo", which is the true state of
every existing row — no resolve has happened since these columns
existed. Adding nullable columns without a default is catalog-only.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "dk1000107"
down_revision: str | None = "dj1000106"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column("prev_resolution", sa.String(32), nullable=True),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column("prev_resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column("prev_resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_ics_prev_resolved_by_users",
        "integrity_check_submissions",
        "users",
        ["prev_resolved_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_ics_prev_resolved_by_users",
        "integrity_check_submissions",
        type_="foreignkey",
    )
    op.drop_column("integrity_check_submissions", "prev_resolved_at")
    op.drop_column("integrity_check_submissions", "prev_resolved_by")
    op.drop_column("integrity_check_submissions", "prev_resolution")
