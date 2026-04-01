"""add school system tables (schools, teacher_invites, contact_leads) and school_id/section_id FKs

Revision ID: l1000003
Revises: k1000002
Create Date: 2026-04-01 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "l1000003"
down_revision: str | None = "k1000002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Schools
    op.create_table(
        "schools",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("state", sa.String(50), nullable=True),
        sa.Column("contact_name", sa.String(200), nullable=False),
        sa.Column("contact_email", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # Teacher invites
    op.create_table(
        "teacher_invites",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("school_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("invited_by", sa.UUID(), nullable=True),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_teacher_invites_school_id", "teacher_invites", ["school_id"])
    op.create_index("ix_teacher_invites_email", "teacher_invites", ["email"])

    # Contact leads
    op.create_table(
        "contact_leads",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("school_name", sa.String(200), nullable=False),
        sa.Column("contact_name", sa.String(200), nullable=False),
        sa.Column("contact_email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default=sa.text("'teacher'")),
        sa.Column("approx_students", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'new'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # Add school_id to users (for teachers)
    op.add_column("users", sa.Column("school_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_users_school_id", "users", "schools", ["school_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_users_school_id", "users", ["school_id"])

    # Add section_id to sessions (for school student analytics)
    op.add_column("sessions", sa.Column("section_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_sessions_section_id", "sessions", "sections", ["section_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_sessions_section_id", "sessions", ["section_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_section_id", table_name="sessions")
    op.drop_constraint("fk_sessions_section_id", "sessions", type_="foreignkey")
    op.drop_column("sessions", "section_id")

    op.drop_index("ix_users_school_id", table_name="users")
    op.drop_constraint("fk_users_school_id", "users", type_="foreignkey")
    op.drop_column("users", "school_id")

    op.drop_table("contact_leads")
    op.drop_index("ix_teacher_invites_email", table_name="teacher_invites")
    op.drop_index("ix_teacher_invites_school_id", table_name="teacher_invites")
    op.drop_table("teacher_invites")
    op.drop_table("schools")
