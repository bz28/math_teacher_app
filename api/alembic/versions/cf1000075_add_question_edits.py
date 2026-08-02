"""add question_edits — record teacher edits to generated questions.

A generated question a teacher had to rewrite is the clearest signal
that the GENERATION PROMPT is wrong: one teacher fixing one question is
taste, four teachers fixing the same shape of question is a defect we
can fix at the source. Nothing recorded that — `question_bank_items`
carries only a ONE-LEVEL undo (`previous_*`), so a second edit erased
the first and "edited four times" was unanswerable.

## Deliberately NO backfill

Every other migration here backfills, because the data existed and only
the column was new. This is the opposite case: the EVENTS were never
recorded and the intermediate states are gone, so there is nothing to
reconstruct. Inventing rows would be worse than having none.

The honest handling is at the API instead: admin responses carry a
`tracking_since` date so a count of 0 reads as "not tracked then"
rather than "never edited" — which would quietly mislead exactly the
analysis this table exists to support.

Revision ID: cf1000075
Revises: ce1000074
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cf1000075"
down_revision: str | None = "ce1000074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "question_edits",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "bank_item_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "edited_by_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "school_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("schools.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("before", sa.Text(), nullable=True),
        sa.Column("after", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_question_edits_bank_item_id", "question_edits", ["bank_item_id"],
    )
    op.create_index(
        "ix_question_edits_edited_by_id", "question_edits", ["edited_by_id"],
    )
    op.create_index("ix_question_edits_school_id", "question_edits", ["school_id"])
    op.create_index("ix_question_edits_kind", "question_edits", ["kind"])
    op.create_index("ix_question_edits_created_at", "question_edits", ["created_at"])


def downgrade() -> None:
    for name in (
        "ix_question_edits_created_at",
        "ix_question_edits_kind",
        "ix_question_edits_school_id",
        "ix_question_edits_edited_by_id",
        "ix_question_edits_bank_item_id",
    ):
        op.drop_index(name, table_name="question_edits")
    op.drop_table("question_edits")
