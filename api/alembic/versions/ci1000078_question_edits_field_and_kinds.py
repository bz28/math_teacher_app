"""question_edits: record WHICH field changed, and rename kind to the action.

## Why a `field` column

`question_edits` was built to answer "is the generation prompt wrong?",
so it only ever stored the question text. But a bank item is produced by
TWO separate LLM calls — `generate_questions` writes the prose,
`generate_solutions` (via `decompose`) works the answer — plus a third,
`generate_distractors`, for the MCQ choices. A teacher fixing the
solution is evidence against a different prompt than a teacher fixing
the question, and the table could not tell them apart.

Worse, it recorded neither: the writer compared `previous_question` to
`question` and returned early when they matched, so an edit that touched
only the solution produced no row at all — even though `snapshot_history`
had already saved the before-value one line earlier.

`field` makes each row name the call it indicts.

## Why the kind values are renamed

`kind` held `manual` / `chat`, which describe the CHANNEL the teacher
used. The new values describe the ACTION they took, because that is what
the severity of the signal depends on — a typo fix and a "bin it" are
not the same evidence. Mixing both vocabularies in one column would be
worse than either, so the old values are migrated rather than joined:

    manual -> edit_manual
    chat   -> edit_workshop

and three genuinely new actions become recordable (`regen_guided`,
`regen_fresh`, `reject`), none of which had any representation before.

## Backfill

Every existing row is a question edit by construction — that is the only
thing the old writer could produce — so `field` backfills to 'question'
with certainty, not assumption. The column is then made NOT NULL.

Revision ID: ci1000078
Revises: ch1000077
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ci1000078"
down_revision: str | None = "ch1000077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add `field` nullable so existing rows survive the ALTER, backfill
    #    every one to 'question' (the only thing the old writer emitted),
    #    then close it to NOT NULL. Three steps, one migration — a bare
    #    NOT NULL add would fail on any non-empty table.
    op.add_column(
        "question_edits",
        sa.Column("field", sa.String(length=20), nullable=True),
    )
    op.execute("UPDATE question_edits SET field = 'question' WHERE field IS NULL")
    op.alter_column("question_edits", "field", nullable=False)
    op.create_index(
        "ix_question_edits_field", "question_edits", ["field"], unique=False,
    )

    # 2. Migrate the kind vocabulary from channel to action.
    op.execute("UPDATE question_edits SET kind = 'edit_manual' WHERE kind = 'manual'")
    op.execute("UPDATE question_edits SET kind = 'edit_workshop' WHERE kind = 'chat'")


def downgrade() -> None:
    op.execute("UPDATE question_edits SET kind = 'manual' WHERE kind = 'edit_manual'")
    op.execute("UPDATE question_edits SET kind = 'chat' WHERE kind = 'edit_workshop'")
    # The actions with no pre-existing equivalent collapse to the closest
    # old value rather than being dropped — losing the row would lose the
    # fact that a teacher intervened at all.
    op.execute(
        "UPDATE question_edits SET kind = 'manual' "
        "WHERE kind IN ('regen_guided', 'regen_fresh', 'reject')"
    )
    op.drop_index("ix_question_edits_field", table_name="question_edits")
    op.drop_column("question_edits", "field")
