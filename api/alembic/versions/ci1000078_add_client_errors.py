"""add client_errors — capture browser crashes instead of discarding them

Revision ID: ci1000078
Revises: ch1000077
Create Date: 2026-08-24 00:00:00.000000

The web ErrorBoundary logged to console in development and dropped the
error entirely in production, so a crash in a real teacher's browser
produced a retry card for her and silence for us. This table is where
those reports land.

Additive: a new table only, no existing column touched, so the deploy
overlap Railway creates (new container migrating while the old one
serves) is a non-issue here.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ci1000078"
down_revision: str | None = "ch1000077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_errors",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False,
        ),
        # SET NULL, not CASCADE: a crash report is evidence about the
        # product, and stays useful after the account is gone.
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("user_role", sa.String(20), nullable=True),
        sa.Column(
            "school_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("schools.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("stack", sa.Text(), nullable=True),
        sa.Column("component_stack", sa.Text(), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("route", sa.String(512), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("context", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
    )
    op.create_index("ix_client_errors_created", "client_errors", ["created_at"])
    op.create_index(
        "ix_client_errors_user_created", "client_errors", ["user_id", "created_at"],
    )
    op.create_index("ix_client_errors_fingerprint", "client_errors", ["fingerprint"])
    op.create_index("ix_client_errors_kind", "client_errors", ["kind"])
    op.create_index("ix_client_errors_school_id", "client_errors", ["school_id"])


def downgrade() -> None:
    op.drop_table("client_errors")
