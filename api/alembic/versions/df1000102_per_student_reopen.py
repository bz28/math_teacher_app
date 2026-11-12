"""per-student due dates, reopen, and the attempts history

Revision ID: df1000102
Revises: de1000101
Create Date: 2026-11-11 00:00:00.000000

A teacher can reopen a homework for one student (api/core/late_policy.py,
POST /teacher/assignments/{id}/students/{student_id}/reopen):

- `student_due_dates` — that student's personal due date, which replaces
  the class date for them everywhere the date counts (closing, `is_late`,
  the late penalty);
- `submissions.reopened_at` — set when the student had already turned it
  in: they may turn it in once more, by the personal date;
- `submission_attempts` — every turn-in a newer one replaced, kept whole:
  a retake's original photos and reading (until now the one-off
  `submissions.retake_original`), or the turn-in a reopen replaced with
  its grade and understanding check.

Backfill: every `retake_original` object becomes attempt 1 of its
submission (reason "retake", replaced when the retake happened), carrying
the same files, reading, edits, flag, note, submitted_at and is_late; then
the column goes. A JSON null (`'null'::json`, which `IS NOT NULL` lets
through) is no original and moves nothing. No submission has been
reopened yet and no personal date exists, so the other two start empty —
which is true for every existing row.

Downgrade rebuilds `retake_original` from each submission's latest retake
attempt. A reopen's archived attempt has nowhere to go in the old shape
and is lost — downgrade is for local development only.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "df1000102"
down_revision: str | None = "de1000101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_due_dates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "assignment_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "student_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "set_by", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("assignment_id", "student_id", name="uq_student_due_dates_assignment_student"),
    )
    op.create_index("ix_student_due_dates_assignment_id", "student_due_dates", ["assignment_id"])
    op.create_index("ix_student_due_dates_student_id", "student_due_dates", ["student_id"])

    op.create_table(
        "submission_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "submission_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("files", sa.JSON(), nullable=True),
        sa.Column("extraction", sa.JSON(), nullable=True),
        sa.Column("extraction_edits", sa.JSON(), nullable=True),
        sa.Column("extraction_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extraction_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extraction_flagged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extraction_flag_note", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("grade", sa.JSON(), nullable=True),
        sa.Column("integrity", sa.JSON(), nullable=True),
        sa.Column("replaced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "reopened_by", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.UniqueConstraint("submission_id", "number", name="uq_submission_attempts_submission_number"),
    )
    op.create_index("ix_submission_attempts_submission_id", "submission_attempts", ["submission_id"])

    op.add_column("submissions", sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True))

    # Every retake's original becomes attempt 1. `->>` reads a missing or
    # JSON-null key as SQL NULL, so a partial object still moves; the
    # submitted_at it lacks falls back to the row's (never NULL).
    op.execute(
        """
        INSERT INTO submission_attempts (
            id, submission_id, number, reason, files, extraction,
            extraction_edits, extraction_edited_at, extraction_flagged_at,
            extraction_flag_note, submitted_at, is_late, replaced_at
        )
        SELECT
            gen_random_uuid(), s.id, 1, 'retake',
            s.retake_original -> 'files',
            s.retake_original -> 'extraction',
            s.retake_original -> 'extraction_edits',
            (s.retake_original ->> 'extraction_edited_at')::timestamptz,
            (s.retake_original ->> 'extraction_flagged_at')::timestamptz,
            s.retake_original ->> 'extraction_flag_note',
            COALESCE((s.retake_original ->> 'submitted_at')::timestamptz, s.submitted_at),
            COALESCE((s.retake_original ->> 'is_late')::boolean, false),
            COALESCE(s.retaken_at, s.submitted_at)
        FROM submissions s
        WHERE s.retake_original IS NOT NULL
          AND json_typeof(s.retake_original) = 'object'
        """
    )
    # A JSON null under a key (`"files": null`) arrives as the JSON value
    # null, not SQL NULL; store it as no value like every other row.
    for col in ("files", "extraction", "extraction_edits"):
        op.execute(
            f"UPDATE submission_attempts SET {col} = NULL "  # noqa: S608 - fixed column names
            f"WHERE {col} IS NOT NULL AND json_typeof({col}) = 'null'"
        )

    op.drop_column("submissions", "retake_original")


def downgrade() -> None:
    op.add_column("submissions", sa.Column("retake_original", sa.JSON(), nullable=True))
    op.execute(
        """
        UPDATE submissions s
        SET retake_original = json_build_object(
            'files', a.files,
            'extraction', a.extraction,
            'extraction_edits', a.extraction_edits,
            'extraction_edited_at', a.extraction_edited_at,
            'extraction_flagged_at', a.extraction_flagged_at,
            'extraction_flag_note', a.extraction_flag_note,
            'submitted_at', a.submitted_at,
            'is_late', a.is_late
        )
        FROM (
            SELECT DISTINCT ON (submission_id) *
            FROM submission_attempts
            WHERE reason = 'retake'
            ORDER BY submission_id, number DESC
        ) a
        WHERE a.submission_id = s.id
        """
    )
    op.drop_column("submissions", "reopened_at")
    op.drop_index("ix_submission_attempts_submission_id", table_name="submission_attempts")
    op.drop_table("submission_attempts")
    op.drop_index("ix_student_due_dates_student_id", table_name="student_due_dates")
    op.drop_index("ix_student_due_dates_assignment_id", table_name="student_due_dates")
    op.drop_table("student_due_dates")
