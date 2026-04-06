"""add question bank and generation job tables

Revision ID: x1000015
Revises: w1000014
Create Date: 2026-04-06 20:00:00.000000

The question bank is the pool of teacher-approved questions for a course.
Everything student-facing eventually pulls from here. Generation runs as
an in-process FastAPI BackgroundTask and writes results into both tables.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "x1000015"
down_revision: str | None = "w1000014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── question_bank_items ──
    op.create_table(
        "question_bank_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("units.id", ondelete="SET NULL"), nullable=True),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("solution_steps", postgresql.JSON(), nullable=True),
        sa.Column("final_answer", sa.Text, nullable=True),
        sa.Column("difficulty", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        # source: which docs the question was generated from + the prompt used
        sa.Column("source_doc_ids", postgresql.JSON(), nullable=True),
        sa.Column("generation_prompt", sa.Text, nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(op.f("ix_question_bank_items_course_id"), "question_bank_items", ["course_id"])
    op.create_index(op.f("ix_question_bank_items_unit_id"), "question_bank_items", ["unit_id"])
    op.create_index(
        "ix_question_bank_items_course_status",
        "question_bank_items",
        ["course_id", "status"],
    )

    # ── question_bank_generation_jobs ──
    # Tracks an in-flight (or completed) AI generation request. Polled by the
    # frontend and resolved by an in-process FastAPI BackgroundTask. NOT a
    # durable queue — jobs lost on process restart are acceptable for v1.
    op.create_table(
        "question_bank_generation_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("units.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # status: queued / running / done / failed
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("requested_count", sa.Integer, nullable=False),
        sa.Column("difficulty", sa.String(20), nullable=False, server_default="mixed"),
        sa.Column("constraint", sa.Text, nullable=True),
        sa.Column("source_doc_ids", postgresql.JSON(), nullable=True),
        sa.Column("produced_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(op.f("ix_qb_jobs_course_id"), "question_bank_generation_jobs", ["course_id"])
    op.create_index(op.f("ix_qb_jobs_status"), "question_bank_generation_jobs", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_qb_jobs_status"), table_name="question_bank_generation_jobs")
    op.drop_index(op.f("ix_qb_jobs_course_id"), table_name="question_bank_generation_jobs")
    op.drop_table("question_bank_generation_jobs")
    op.drop_index("ix_question_bank_items_course_status", table_name="question_bank_items")
    op.drop_index(op.f("ix_question_bank_items_unit_id"), table_name="question_bank_items")
    op.drop_index(op.f("ix_question_bank_items_course_id"), table_name="question_bank_items")
    op.drop_table("question_bank_items")
