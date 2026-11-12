"""late penalty on the grade

Revision ID: de1000101
Revises: dd1000100
Create Date: 2026-11-11 00:00:00.000000

The late policy (`assignments.late_policy`) starts doing what it says
(api/core/late_policy.py). A grade now records the points the policy took
off its `final_score` (`late_penalty` — the policy takes a percent of the
score, 10 per started day late, and this is the points that came to), the
snapshot of that at publish (`published_late_penalty`), and whether the
teacher waived it for this student (`late_penalty_waived`).

Backfill: 0, 0 and false — the server defaults — are the true values for
every existing row. Every homework in production is on the `none` policy
(read-only check, Nov 11 2026: 13 published + 6 drafts, all `none`), which
takes nothing off, so no existing `final_score` or `published_final_score`
had a penalty in it and none moves.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "de1000101"
down_revision: str | None = "dd1000100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "submission_grades",
        sa.Column("late_penalty", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "submission_grades",
        sa.Column("published_late_penalty", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "submission_grades",
        sa.Column("late_penalty_waived", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    # Before this revision nothing took points off for lateness, so put
    # them back rather than leave scores cut by a penalty nobody can see.
    op.execute(
        "UPDATE submission_grades SET final_score = final_score + late_penalty "
        "WHERE final_score IS NOT NULL AND late_penalty <> 0"
    )
    op.execute(
        "UPDATE submission_grades "
        "SET published_final_score = published_final_score + published_late_penalty "
        "WHERE published_final_score IS NOT NULL AND published_late_penalty <> 0"
    )
    op.drop_column("submission_grades", "late_penalty_waived")
    op.drop_column("submission_grades", "published_late_penalty")
    op.drop_column("submission_grades", "late_penalty")
