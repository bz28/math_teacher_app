"""add extraction_jobs — durable queue for the Vision read.

Extraction was the last hop still held in one web server's memory:
submit called `asyncio.create_task(_run_extraction_background(...))` and
hoped. That spawn was the function's only caller — no queue, no sweeper,
no admin re-run — so a task that died took the work with it, leaving a
durable submission that could never be confirmed or graded and no record
anywhere that a read was ever owed.

On 2026-09-03 the anthropic SDK floated to 1.3.0 and dropped the
`temperature` kwarg; every extraction raised TypeError. Recovering ONE
student's homework needed a hand-written script and production write
credentials. This table is so the next one recovers itself.

## Backfill

Submissions that are still owed a read get a `queued` row, so the queue
describes all outstanding work from the moment it exists rather than only
knowing about submissions made after deploy. "Owed" is the same condition
the app uses to spawn extraction in the first place:

    extraction IS NULL
    AND (integrity_check_enabled OR ai_grading_enabled)

Both halves matter. Without the toggle check the backfill would enqueue
every submission on assignments that never wanted a read — a Vision call
each, for work nobody asked for. That is `stage_for`'s
`extraction_off` vs `awaiting_extraction` distinction, and it is the
difference between a backfill that heals a backlog and one that invents
one.

Submissions the student already confirmed or flagged are excluded by
`extraction IS NULL` on its own: neither stamp is reachable without an
extraction to rule on.

Unlike grading's backfill, these are queued to run rather than parked.
There is no batching benefit to waiting — each submission is its own set
of photos — and a stuck submission is a student who cannot proceed, so
the correct schedule is "as soon as the drain comes round".
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cn1000083"
down_revision: str | Sequence[str] | None = "cm1000082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "extraction_jobs",
        sa.Column(
            "id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
        ),
        sa.Column(
            "submission_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="queued",
        ),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # UNIQUE index, not a unique constraint plus a plain index. The model
    # declares `unique=True, index=True`, which SQLAlchemy renders as a
    # single unique index — emitting a constraint here instead makes
    # `alembic check` propose dropping and recreating it forever.
    op.create_index(
        "ix_extraction_jobs_submission_id",
        "extraction_jobs",
        ["submission_id"],
        unique=True,
    )
    op.create_index(
        "ix_extraction_jobs_assignment_id", "extraction_jobs", ["assignment_id"],
    )
    # The drain's only hot query: "queued rows, oldest first".
    op.create_index(
        "ix_extraction_jobs_status_created_at",
        "extraction_jobs",
        ["status", "created_at"],
    )

    op.execute(
        """
        INSERT INTO extraction_jobs
            (id, submission_id, assignment_id, status, attempts)
        SELECT gen_random_uuid(), s.id, s.assignment_id, 'queued', 0
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        WHERE s.extraction IS NULL
          AND (a.integrity_check_enabled OR a.ai_grading_enabled)
        """
    )


def downgrade() -> None:
    op.drop_index("ix_extraction_jobs_status_created_at", "extraction_jobs")
    op.drop_index("ix_extraction_jobs_assignment_id", "extraction_jobs")
    op.drop_index("ix_extraction_jobs_submission_id", "extraction_jobs")
    op.drop_table("extraction_jobs")
