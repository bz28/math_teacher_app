"""add final_answers column to submissions

Revision ID: ah1000025
Revises: ag1000024
Create Date: 2026-04-08 17:00:00.000000

The school-student homework submission flow lets the kid type a final
answer per HW primary problem AND upload one whole-HW image of their
work. The image lives in the existing image_data column. The per-
problem typed answers live in this new JSON column as a flat map of
{bank_item_id: answer_text}.

JSON (not JSONB) keeps this consistent with the rest of the schema —
we don't query individual answers across submissions, so JSONB's
indexing wouldn't pay for itself.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ah1000025"
down_revision: str | None = "ag1000024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("final_answers", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submissions", "final_answers")
