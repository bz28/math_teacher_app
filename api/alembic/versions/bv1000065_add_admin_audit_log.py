"""add admin_audit_log table

Revision ID: bv1000065
Revises: bu1000064
Create Date: 2026-05-23 00:00:00.000000

Records administrative actions that mutate accounts, roles, or other
sensitive state: user deletion, role changes, data exports, school
membership changes, etc. Distinct from the student-record-access log
(which is read-side and FERPA-driven); this is write-side and
procurement-driven.

Action metadata is JSONB so each action type can stamp whatever
structured detail is useful for later forensics without schema churn.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bv1000065"
down_revision: str | None = "bu1000064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "admin_user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("admin_role", sa.String(length=20), nullable=False),
        # Free-form lowercase action verb — "user.delete",
        # "user.role_change", "school.deactivate", etc. Convention:
        # "<entity>.<verb>" so downstream queries can filter by prefix.
        sa.Column("action", sa.String(length=80), nullable=False, index=True),
        sa.Column("target_type", sa.String(length=40), nullable=False),
        sa.Column("target_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("action_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column(
            "performed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("admin_audit_log")
