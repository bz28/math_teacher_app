"""add sections.enrollment_open (phase 1 of replacing join_code_expires_at)

Revision ID: cg1000076
Revises: cf1000075
Create Date: 2026-08-23 00:00:00.000000

Join codes expired 7 days after they were minted and nothing ever
extended them. A class runs a semester, so every section older than a
week was sitting on a dead code — while the teacher UI kept displaying
that code as live, with no expiry rendered anywhere. Teachers read the
resulting "Join code expired" as the feature being broken.

Enrollment is a state the teacher controls, not a countdown. This adds
`enrollment_open` (bool, NOT NULL, server_default TRUE). The server
default backfills every existing row in the same statement — that is
the repair: every section currently stuck behind an expired code starts
admitting students again.

**Expand/contract — `join_code_expires_at` is deliberately NOT dropped
here.** Railway overlaps the old and new containers during a deploy
(the new one runs `alembic upgrade head` at boot while the old one is
still serving), and SQLAlchemy emits explicit column lists — so
dropping the column in this migration would 500 every section read on
the old container for the length of the overlap. The column is unmapped
as of this revision: new code never selects it, old code still finds it
in the DB, and nothing writes anything that matters to it. A follow-up
migration drops it once this revision is fully rolled out.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cg1000076"
down_revision: str | None = "cf1000075"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sections",
        sa.Column(
            "enrollment_open", sa.Boolean(),
            nullable=False, server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("sections", "enrollment_open")
