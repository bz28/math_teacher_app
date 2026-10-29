"""add integrity_check_submissions.incomplete_reason

Revision ID: cz1000095
Revises: cv1000091
Create Date: 2026-10-29 00:00:00.000000

Why a complete understanding check has no disposition: `not_started`
(confirmed the reading, never answered), `left_partway` (answered, then
walked away), or `turn_cap` (talked to the hard cap, no verdict). The
teacher sees the first two as "Didn't finish the check" and the third as
"Inconclusive"; before this they were all "Inconclusive".

Backfill, same migration. Every existing no-disposition check was closed
by one of the two force-finalizes, and each wrote a fixed summary:

- abandoned  → headline "Interview incomplete", split on whether any
  student turn exists (prod 2026-10-29: 17 never answered, 5 left
  partway);
- turn cap   → overall_summary starting "Conversation hit the turn cap"
  (none in prod yet, but dev/staging may have them).

Rows the agent finished keep NULL, which is the correct value for them.
Additive only: the previous release never reads this column, so it keeps
serving untouched while this runs at boot.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "cz1000095"
down_revision: str | None = "cv1000091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column("incomplete_reason", sa.String(length=32), nullable=True),
    )
    op.execute(
        """
        UPDATE integrity_check_submissions AS c
        SET incomplete_reason = CASE
            WHEN EXISTS (
                SELECT 1 FROM integrity_conversation_turns t
                WHERE t.integrity_check_submission_id = c.id
                  AND t.role = 'student'
            ) THEN 'left_partway'
            ELSE 'not_started'
        END
        WHERE c.status = 'complete'
          AND c.disposition IS NULL
          AND c.headline = 'Interview incomplete'
        """
    )
    op.execute(
        """
        UPDATE integrity_check_submissions
        SET incomplete_reason = 'turn_cap'
        WHERE status = 'complete'
          AND disposition IS NULL
          AND incomplete_reason IS NULL
          AND overall_summary LIKE 'Conversation hit the turn cap%'
        """
    )


def downgrade() -> None:
    op.drop_column("integrity_check_submissions", "incomplete_reason")
