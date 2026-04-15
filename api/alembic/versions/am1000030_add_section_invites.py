"""add section_invites table

Revision ID: am1000030
Revises: al1000029
Create Date: 2026-04-14 10:00:00.000000

Tracks email invitations for students to join a section. Mirrors the
teacher_invites pattern: pending/accepted/expired/revoked status, unique
token, 14-day expiry. Partial unique index prevents duplicate pending
invites for the same section+email.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "am1000030"
down_revision: str | None = "al1000029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "section_invites",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("section_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("invited_by", sa.UUID(), nullable=True),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_section_invites_section_id", "section_invites", ["section_id"])
    op.create_index("ix_section_invites_email", "section_invites", ["email"])
    op.create_index(
        "ux_section_invites_pending_email",
        "section_invites",
        ["section_id", "email"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("ux_section_invites_pending_email", table_name="section_invites")
    op.drop_index("ix_section_invites_email", table_name="section_invites")
    op.drop_index("ix_section_invites_section_id", table_name="section_invites")
    op.drop_table("section_invites")
