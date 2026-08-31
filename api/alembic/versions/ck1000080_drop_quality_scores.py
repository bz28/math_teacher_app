"""Drop quality_scores — the table an LLM judge never wrote to.

`quality_scores` was written by exactly one function,
`judge.fire_and_forget_judge`. That function was never called. The commit
that introduced it added the call site ALREADY COMMENTED OUT, with a
`TODO: re-enable once judge prompt is refined`, and a later commit
removed the dead comment. So the table is empty by construction, not by
coincidence: no code path in any released version could put a row in it.

The Solution-quality page it backed now reads teacher repairs to the
worked answer instead — a free signal that exists, on a call
(`decompose`) that runs behind five surfaces.

## The guard, and why it is not paranoia

This project has real users and a rule that their data survives every
change. "Empty by construction" is an argument, not a measurement, and
the cost of being wrong is silently destroying rows nobody can get back.
So the upgrade REFUSES to run if the table has any content — better a
failed deploy than an unrecoverable delete. If it ever fires, the rows
came from somewhere this reasoning did not anticipate and deserve a look
before anything drops them.

The downgrade recreates the table empty. That is honest rather than
lossy: there is nothing to restore, and a rollback lands on code whose
only writer was already dead.

Revision ID: ck1000080
Revises: cj1000079
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ck1000080"
down_revision: str | None = "cj1000079"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    remaining = conn.execute(
        sa.text("SELECT count(*) FROM quality_scores")
    ).scalar_one()
    if remaining:
        raise RuntimeError(
            f"quality_scores holds {remaining} row(s); this migration expects "
            "it to be empty because its only writer was never called. "
            "Investigate the rows before dropping the table."
        )
    op.drop_table("quality_scores")


def downgrade() -> None:
    op.create_table(
        "quality_scores",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("correctness", sa.Integer(), nullable=False),
        sa.Column("optimality", sa.Integer(), nullable=False),
        sa.Column("clarity", sa.Integer(), nullable=False),
        sa.Column("flow", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("issues", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # UNIQUE, matching the original migration and the deleted model: one
    # judge score per session. Recreating it non-unique would land a
    # rollback on a table that permits duplicates and show as autogenerate
    # drift.
    op.create_index(
        "ix_quality_scores_session_id", "quality_scores", ["session_id"],
        unique=True,
    )
