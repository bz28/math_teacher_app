"""gate integrity + grading on extraction_confirmed_at

Revision ID: ax1000041
Revises: aw1000040
Create Date: 2026-04-23 18:00:00.000000

Adds `submissions.extraction_confirmed_at`. Null means the student
hasn't signed off on the Vision extraction yet; background integrity
+ grading pipelines are gated on this column and won't fire until
the student hits Confirm (or Flag) on the post-submit "does this
match what you wrote?" screen.

Existing submissions (pre-gate) don't have a confirmation step — the
pipeline ran automatically at submit time on main. Back-filling via
server_default=now() at migration time would misrepresent history;
leave them null and let the teacher-side review treat them as
"no confirm action on record" — the grades already exist regardless.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ax1000041"
down_revision: str | None = "aw1000040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column(
            "extraction_confirmed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("submissions", "extraction_confirmed_at")
