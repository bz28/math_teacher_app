"""add submissions.retaken_at + submissions.retake_original

Revision ID: dd1000100
Revises: dd1000099
Create Date: 2026-11-07 00:00:00.000000

A student who flagged the reading of their homework ("The whole reading
is wrong") can now replace their photos once, while nothing has been
graded, for a fresh reading. The replacement must not destroy evidence:
the teacher review page shows that the student retook, with the
original photos one click away.

- `retaken_at` — when the student retook. NULL means "never retook".
- `retake_original` — the turn-in it replaced: files, the reading and
  any student edits to it, the flag and its note, and the original
  `submitted_at` / `is_late`. NULL when there was no retake.

No backfill: NULL is the true value for every existing row — retaking
did not exist before this migration, so no row has a replaced turn-in
to record. Both columns are nullable, so the old container keeps
serving while this deploys: it never reads or writes them.

One retake per submission, so one snapshot column is enough to keep
the original; a history table would only earn its keep if retakes were
repeatable.

Downgrade drops both columns — including `retake_original`, the only
copy of a retaken turn-in's first photos. Don't downgrade past this on
a database with real retakes without exporting them first.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "dd1000100"
down_revision: str | None = "dd1000099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("retaken_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("submissions", sa.Column("retake_original", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("submissions", "retake_original")
    op.drop_column("submissions", "retaken_at")
