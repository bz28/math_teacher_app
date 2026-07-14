"""generalize admin_audit_log into role-agnostic activity_log

Revision ID: ca1000070
Revises: bz1000069
Create Date: 2026-07-14 00:00:00.000000

Broadens the admin-only audit log into one role-agnostic activity log
so teacher writes (assignment/generation/grade mutations) land in the
same stream as admin writes. Renames the table + the two admin-specific
columns to their actor-agnostic equivalents and adds a denormalized
`school_id` snapshot for whole-school filtering.

Pre-launch: no rows to preserve, but a rename keeps the migration
chain honest rather than dropping and recreating.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ca1000070"
down_revision: str | None = "bz1000069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("admin_audit_log", "activity_log")

    op.alter_column("activity_log", "admin_user_id", new_column_name="actor_user_id")
    op.alter_column("activity_log", "admin_role", new_column_name="actor_role")

    # Keep index names aligned with what the model's create_all would
    # generate (ix_<table>_<column>), so the migrated schema matches the
    # metadata schema tests build.
    op.execute(
        "ALTER INDEX ix_admin_audit_log_admin_user_id "
        "RENAME TO ix_activity_log_actor_user_id"
    )
    op.execute("ALTER INDEX ix_admin_audit_log_action RENAME TO ix_activity_log_action")
    op.execute(
        "ALTER INDEX ix_admin_audit_log_performed_at "
        "RENAME TO ix_activity_log_performed_at"
    )

    op.add_column(
        "activity_log",
        sa.Column(
            "school_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("schools.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_activity_log_school_id", "activity_log", ["school_id"])


def downgrade() -> None:
    op.drop_index("ix_activity_log_school_id", table_name="activity_log")
    op.drop_column("activity_log", "school_id")

    op.execute(
        "ALTER INDEX ix_activity_log_performed_at "
        "RENAME TO ix_admin_audit_log_performed_at"
    )
    op.execute("ALTER INDEX ix_activity_log_action RENAME TO ix_admin_audit_log_action")
    op.execute(
        "ALTER INDEX ix_activity_log_actor_user_id "
        "RENAME TO ix_admin_audit_log_admin_user_id"
    )

    op.alter_column("activity_log", "actor_role", new_column_name="admin_role")
    op.alter_column("activity_log", "actor_user_id", new_column_name="admin_user_id")

    op.rename_table("activity_log", "admin_audit_log")
