"""enforce mutual exclusion of extraction confirm/flag at DB layer

Revision ID: az1000043
Revises: ay1000042
Create Date: 2026-04-23 23:00:00.000000

Adds a CHECK constraint that rejects any row where both
`extraction_confirmed_at` and `extraction_flagged_at` are set. The
application endpoints already validate this invariant, but a plain
SELECT + conditional UPDATE leaves a window where two concurrent
requests (double-tap, retry storm) can both pass validation and both
commit, landing the row in an impossible state where grading runs on
a flagged submission. The constraint is the last-line guard; the
endpoints switched to atomic conditional updates in the same commit.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "az1000043"
down_revision: str | None = "ay1000042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_submissions_extraction_confirm_flag_exclusive",
        "submissions",
        "NOT (extraction_confirmed_at IS NOT NULL "
        "AND extraction_flagged_at IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_submissions_extraction_confirm_flag_exclusive",
        "submissions",
        type_="check",
    )
