"""add reteach_reasons — why a period lost points on a flagged problem.

Student Insights now says why points came off a flagged problem, grouped
from the teacher's own approved feedback by one cheap model call per
problem (`api.core.reteach_reasons`). The answer is stored here, one row
per homework × section, so opening Insights never calls a model.

## Backfill

Nothing to copy: no existing row has a column to fill, and the rows this
table holds are model output. History is caught up by the grading drain
instead: its first pass finds every homework × section whose approved or
published grades this table hasn't seen (`grades_signature` is NULL for
all of them) and writes reasons for the problems the new rule flags. On
production (read-only count, Nov 26 2026) that is 25 problems across 12
of 20 homework × period pairs, one Haiku call each with at most 16
students' feedback — a few cents in all. A migration can't make those calls, and must not:
a deploy would wait on the network and bill inside a transaction.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "do1000107"
down_revision: str | Sequence[str] | None = "dj1000106"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reteach_reasons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "assignment_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "section_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sections.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("grades_signature", sa.Text(), nullable=True),
        sa.Column("problems", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("assignment_id", "section_id", name="uq_reteach_reasons_pair"),
    )


def downgrade() -> None:
    op.drop_table("reteach_reasons")
