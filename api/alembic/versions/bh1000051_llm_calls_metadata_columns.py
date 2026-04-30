"""add school_id, submission_id, metadata to llm_calls

Revision ID: bh1000051
Revises: bg1000050
Create Date: 2026-04-30 13:30:00.000000

Three additive columns for per-school filtering + structured debugging:

- school_id (UUID, FK schools, SET NULL, indexed): denormalized at
  write time from users.school_id so the dashboard can filter calls
  by school without a multi-hop join. Null = "Internal" bucket
  (founder/test accounts/non-school users).
- submission_id (UUID, FK submissions, SET NULL, indexed): the per-
  submission flight-recorder key — every Vision/equivalence/agent/
  grading call for one homework shares the same submission_id, so
  one query pulls the full LLM trace.
- metadata (JSONB, nullable): free-form per-call structured tags
  (posture, tier, selection_reason, student_turn, loop_iter, phase,
  etc). Schema-by-convention, not strict — different functions stamp
  different keys.

All three are nullable so existing rows aren't touched. Pre-launch,
no backfill (CLAUDE.md).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bh1000051"
down_revision: str | None = "bg1000050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "llm_calls",
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_llm_calls_school_id",
        "llm_calls", "schools",
        ["school_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_llm_calls_school_id",
        "llm_calls",
        ["school_id"],
    )

    op.add_column(
        "llm_calls",
        sa.Column("submission_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_llm_calls_submission_id",
        "llm_calls", "submissions",
        ["submission_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_llm_calls_submission_id",
        "llm_calls",
        ["submission_id"],
    )

    # Column is named `call_metadata` (not `metadata`) because
    # SQLAlchemy's Base class has a `metadata` attribute reserved for
    # schema introspection — using it as a column triggers warnings
    # and lookup conflicts. Dashboard responses still expose the field
    # as `metadata` to consumers.
    op.add_column(
        "llm_calls",
        sa.Column("call_metadata", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("llm_calls", "call_metadata")

    op.drop_index("ix_llm_calls_submission_id", "llm_calls")
    op.drop_constraint("fk_llm_calls_submission_id", "llm_calls", type_="foreignkey")
    op.drop_column("llm_calls", "submission_id")

    op.drop_index("ix_llm_calls_school_id", "llm_calls")
    op.drop_constraint("fk_llm_calls_school_id", "llm_calls", type_="foreignkey")
    op.drop_column("llm_calls", "school_id")
