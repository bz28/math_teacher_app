"""add teacher resolution to integrity_check_submissions

Revision ID: bz1000069
Revises: by1000068
Create Date: 2026-06-29 10:00:00.000000

Session-level teacher-action layer on top of the AI verdict. Lets a
teacher resolve a flagged integrity check so it clears from the roster
"needs attention" / flagged aggregate. `resolution` defaults to
"unresolved"; `resolved_by` / `resolved_at` record who/when. The AI's
`disposition` is untouched — this is purely a teacher-action layer.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bz1000069"
down_revision: str | None = "by1000068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column(
            "resolution",
            sa.String(length=32),
            nullable=False,
            server_default="unresolved",
        ),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "integrity_check_submissions",
        sa.Column(
            "resolved_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_ics_resolved_by_users",
        "integrity_check_submissions",
        "users",
        ["resolved_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_ics_resolved_by_users",
        "integrity_check_submissions",
        type_="foreignkey",
    )
    op.drop_column("integrity_check_submissions", "resolved_at")
    op.drop_column("integrity_check_submissions", "resolved_by")
    op.drop_column("integrity_check_submissions", "resolution")
