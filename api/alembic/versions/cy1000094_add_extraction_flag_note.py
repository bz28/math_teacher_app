"""add submissions.extraction_flag_note

Revision ID: cy1000094
Revises: cx1000093
Create Date: 2026-10-29 00:00:00.000000

The student's optional short note ("What did it get wrong?") sent with
"Most of it is wrong" on the post-submit confirm screen, shown to the
teacher on the flagged-reading callout. Nullable, and NULL is the true
value for every existing row: flags before this shipped carried no note
(the endpoint took no body), so there is nothing to backfill. Edits the
student made before flagging reuse the existing `extraction_edits` /
`extraction_edited_at` columns.

Adding a nullable column is safe while the old container still serves:
it never reads or writes the column.

Numbered cy1000094 because cw1000092 (#954), cz1000095 / da1000096
(#958) and cx1000093 (#960) were taken by PRs that merged first; this
chains onto cx1000093, main's head when this was last merged with main.
If another migration lands on main first, re-point down_revision at the
new head, or alembic sees two heads.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "cy1000094"
down_revision: str | None = "cx1000093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("submissions", sa.Column("extraction_flag_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("submissions", "extraction_flag_note")
