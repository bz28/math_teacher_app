"""drop rubric_suggestions (phase 2 — the contract half)

Revision ID: cx1000093
Revises: cv1000091
Create Date: 2026-10-29 00:00:00.000000

The rubric rule suggestion feature ("Want the AI to grade this way next
time?") was removed in the previous PR: its routes, model, Haiku call,
card and settings list are gone, and nothing in the codebase reads or
writes this table any more — `grep -rn rubric_suggestion api` returns
only cr1000087 (which created it) and this revision.

The table was left in place there on purpose. Railway overlaps the old
and new containers on deploy (the new one runs `alembic upgrade head` at
boot while the old one still serves), so dropping it in the same deploy
would have 500'd the old container's suggestion routes for the length of
the overlap. Same expand/contract shape as cg1000076 → ch1000077.

Nothing of value is lost: production holds exactly one row, a pending
offer the teacher never answered. No rule was ever added through it.

**MERGE ORDER MATTERS.** This must not ship until the removal PR is live
in production. Check before merging:

    curl -s https://mathteacherapp-production.up.railway.app/openapi.json \
      | grep -c rubric-suggestion

`0` means the deploy landed and this is safe. Anything else means
production is still on the old code, and merging this would drop a table
the running container still maps — an outage, not a cleanup.

Ordering: PR #954 adds cw1000092, also on top of cv1000091. Whichever of
the two merges second must re-point its `down_revision` at the other, or
alembic ends up with two heads.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cx1000093"
down_revision: str | None = "cv1000091"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IF EXISTS drops the index with the table; it also keeps a database
    # that never had the table (a later baseline) upgrading cleanly.
    op.execute("DROP TABLE IF EXISTS rubric_suggestions")


def downgrade() -> None:
    # The table as cr1000087 created it, empty. The dropped rows are not
    # coming back; there was one unanswered offer.
    op.create_table(
        "rubric_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("submission_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("problem_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("points", sa.Integer, nullable=True),
        sa.Column("source_label", sa.String(300), nullable=True),
        sa.Column("teacher_comment", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_rubric_suggestions_course_id", "rubric_suggestions", ["course_id"])
