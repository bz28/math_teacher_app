"""require final_answer on question_bank_items

Revision ID: bi1000052
Revises: bh1000051
Create Date: 2026-04-30 00:00:00.000000

The integrity-checker chat assumed final_answer might be missing on
"legacy items" and the prompt carried a defensive "if the answer key
is missing, lean wrong" branch. Pre-launch (no real users) so we
flatten that: every bank item gets a non-null final_answer (empty
string for any existing null rows), and the approve route enforces
non-empty before a teacher can flip status to "approved". The
integrity check only ever sees approved items, so the agent's prompt
branch becomes unreachable and gets removed.

Pending items can still have empty final_answer (the LLM didn't
produce one yet, or the teacher is mid-edit) — only the approval
gate insists on non-empty.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "bi1000052"
down_revision: str | None = "bh1000051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Coalesce any existing NULLs to '' so the NOT NULL alter doesn't
    # fail on dev DBs that pre-date the AI-generation always-set path.
    op.execute(
        "UPDATE question_bank_items SET final_answer = '' "
        "WHERE final_answer IS NULL",
    )
    op.alter_column(
        "question_bank_items", "final_answer",
        nullable=False, server_default="",
    )


def downgrade() -> None:
    op.alter_column(
        "question_bank_items", "final_answer",
        nullable=True, server_default=None,
    )
