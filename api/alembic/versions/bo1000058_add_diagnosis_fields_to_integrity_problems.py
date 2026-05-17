"""add diagnosis_note + diagnosis_kind to integrity_check_problems

Revision ID: bo1000058
Revises: bn1000057
Create Date: 2026-05-16 00:00:00.000000

Adds two nullable columns to `integrity_check_problems` so each row can
carry a silent per-problem misconception diagnosis alongside the chat-
probed row's rubric/ai_reasoning. New rows with `status='diagnosis_only'`
exist one-per-wrong-problem (excluding the chat-probed one) and use
these columns; chat-probed rows leave both null.

Columns:
- `diagnosis_note` (text, nullable) — 2-3 sentence AI hypothesis of the
  student's likely misunderstanding.
- `diagnosis_kind` (varchar(32), nullable) — categorical bucket:
  procedural_slip / conceptual_gap (LLM-emitted) or blank / unreadable
  / error (pipeline-side).

Pre-launch: no backfill — existing rows get NULL and render as no-diagnosis
in the UI.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bo1000058"
down_revision: str | None = "bn1000057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_problems",
        sa.Column("diagnosis_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "integrity_check_problems",
        sa.Column("diagnosis_kind", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("integrity_check_problems", "diagnosis_kind")
    op.drop_column("integrity_check_problems", "diagnosis_note")
