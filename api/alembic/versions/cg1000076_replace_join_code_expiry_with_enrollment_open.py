"""replace sections.join_code_expires_at with sections.enrollment_open

Revision ID: cg1000076
Revises: cf1000075
Create Date: 2026-08-23 00:00:00.000000

Join codes expired 7 days after they were minted and nothing ever
extended them. A class runs a semester, so every section older than a
week was sitting on a dead code — while the teacher UI kept displaying
that code as live, with no expiry rendered anywhere. Teachers read the
resulting "Join code expired" as the feature being broken.

Enrollment is a state the teacher controls, not a countdown:

  1. Add `sections.enrollment_open` (bool, NOT NULL, server_default
     TRUE). The server default backfills every existing row to TRUE in
     the same statement — that is the repair: every section currently
     stuck behind an expired code starts admitting students again.
  2. Drop `join_code_expires_at`. Both join paths (POST /teacher/join
     and the join_code branch of /auth/register) now gate on
     enrollment_open.

Rotating the code (POST .../join-code) stays the break-glass for a
leaked code; closing enrollment is the deliberate "no more students".
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
    op.drop_column("sections", "join_code_expires_at")


def downgrade() -> None:
    # Restored NULL, not now()+7d. The pre-migration check read
    # `if expires_at and expires_at < now()`, so NULL means "never
    # expires" — a downgrade that re-stamped a 7-day timer would
    # re-break every section the moment it ran.
    op.add_column(
        "sections",
        sa.Column("join_code_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_column("sections", "enrollment_open")
