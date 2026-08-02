"""add grading_jobs — durable queue for AI grading.

Grading was an in-memory `asyncio.create_task` spawned from the confirm
endpoint: a promise with no row behind it, so a restart lost the work
silently and a transient LLM error was permanent. Deferring grading to an
assignment's due date stretches that promise from one minute to several
days, which in-memory cannot survive. This table is where the intent gets
written down before it is worked.

## Backfill

Every submission that is still ungraded gets a row, so the queue is a
complete picture of outstanding work from the moment it exists rather
than only knowing about submissions made after deploy.

They are backfilled with **`scheduled_for = NULL`** — deliberately, and
this is the load-bearing decision in this migration. Backfilling with
each assignment's real `due_at` would be the "natural" choice and would
be wrong: nearly every historical due date is already in the past, so the
first drain would immediately grade the entire backlog of every school on
the platform. That is a large surprise bill and a pile of AI grades on
homework teachers may have long since finished with by hand.

NULL means "queued, waiting for a teacher to ask" — the same state a
no-due-date assignment uses. Nothing is lost and nothing is hidden: an
ungraded submission already surfaces in the teacher's to-review count
(`_to_review_case` counts any submission without a published grade), and
a teacher who wants them graded presses "Grade all". Only work created
after this migration gets automatic due-time scheduling.

Scope is narrowed to assignments with `ai_grading_enabled` — a HW with AI
grading switched off should not acquire a grading job it will never want.

Revision ID: ce1000074
Revises: cd1000073
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ce1000074"
down_revision: str | None = "cd1000073"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "grading_jobs",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "submission_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="queued",
        ),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "requested_by_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # Unique, not just indexed: this is what makes enqueueing idempotent.
    # A double-confirm or a concurrent regrade collapses onto one row via
    # ON CONFLICT rather than queueing the same submission twice.
    op.create_index(
        "ix_grading_jobs_submission_id",
        "grading_jobs",
        ["submission_id"],
        unique=True,
    )
    op.create_index(
        "ix_grading_jobs_assignment_id", "grading_jobs", ["assignment_id"],
    )
    # The drain's hot path is "queued AND scheduled_for <= now()", so it
    # reads both columns together.
    op.create_index(
        "ix_grading_jobs_status_scheduled_for",
        "grading_jobs",
        ["status", "scheduled_for"],
    )

    # Backfill: every ungraded submission on an AI-graded assignment,
    # parked at scheduled_for = NULL. See the module docstring for why
    # NULL and not due_at.
    #
    # "Ungraded" mirrors run_ai_grading_for_submission's own idempotency
    # check — it skips when final_score IS NOT NULL — so a submission the
    # grader would decline to touch never gets a job.
    op.execute(
        """
        INSERT INTO grading_jobs (
            id, submission_id, assignment_id, status, scheduled_for,
            attempts, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), s.id, s.assignment_id, 'queued', NULL,
            0, now(), now()
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        LEFT JOIN submission_grades g ON g.submission_id = s.id
        WHERE a.ai_grading_enabled IS TRUE
          AND g.final_score IS NULL
        """,
    )


def downgrade() -> None:
    op.drop_index("ix_grading_jobs_status_scheduled_for", table_name="grading_jobs")
    op.drop_index("ix_grading_jobs_assignment_id", table_name="grading_jobs")
    op.drop_index("ix_grading_jobs_submission_id", table_name="grading_jobs")
    op.drop_table("grading_jobs")
