"""add student_record_access_log table for FERPA audit trail

Revision ID: bu1000064
Revises: bt1000063
Create Date: 2026-05-23 00:00:00.000000

FERPA requires schools to maintain a record of disclosures of and
accesses to a student's education records. This table records every
read of a student record by a teacher or admin user via the API. The
canonical query is "show me everyone who accessed student X's records
in the last N days" — indexed on (target_student_id, accessed_at).

Columns are denormalized (accessor_role, school_id) at write time so
audit reports remain useful even after the accessor account or school
linkage is changed or deleted.

Pre-launch: no backfill — historical reads before this migration are
not retroactively logged.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bu1000064"
down_revision: str | None = "bt1000063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "student_record_access_log",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        # SET NULL on accessor + target deletion so audit history
        # survives user removal — FERPA records need to outlast the
        # accounts they describe.
        sa.Column(
            "accessor_user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("accessor_role", sa.String(length=20), nullable=False),
        sa.Column(
            "target_student_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("record_type", sa.String(length=40), nullable=False),
        sa.Column("record_id", sa.UUID(as_uuid=True), nullable=True),
        # Denormalized so district admins can scope reports to their
        # own school without a multi-hop join. Snapshot semantics:
        # this stays the school where the access happened, even if
        # the user is later moved.
        sa.Column(
            "school_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("schools.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column(
            "accessed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # Canonical FERPA query: "everyone who touched this student's
    # records in time range T." Index covers target + time range
    # scans without needing a separate single-column index.
    op.create_index(
        "ix_student_record_access_log_target_time",
        "student_record_access_log",
        ["target_student_id", "accessed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_student_record_access_log_target_time",
        table_name="student_record_access_log",
    )
    op.drop_table("student_record_access_log")
