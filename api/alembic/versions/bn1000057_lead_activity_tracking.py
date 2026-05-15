"""lead activity tracking

Revision ID: bn1000057
Revises: bm1000056
Create Date: 2026-05-15 00:00:00.000000

- contact_leads: add `source` (NOT NULL, default 'inbound_form') and
  `referred_by` (nullable text) to support manually-added warm-intro
  / outbound leads.
- contact_leads: drop `notes` — notes move to `lead_notes`, which
  supports a real timeline with author + timestamp per entry.
- New table `lead_meetings`: one row per scheduled meeting with a
  prospect. Each lead can have many. `scheduled_at` is when the
  meeting is planned; `held_at` / `cancelled_at` are set later when
  the operator marks the outcome.
- New table `lead_notes`: freeform timestamped notes attached to a
  lead.

Pre-launch: no existing notes data is preserved (CLAUDE.md says
skip migration backfills for old rows).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bn1000057"
down_revision: str | None = "bm1000056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # contact_leads alterations
    op.add_column(
        "contact_leads",
        sa.Column("source", sa.String(20), nullable=False, server_default="inbound_form"),
    )
    op.add_column("contact_leads", sa.Column("referred_by", sa.Text(), nullable=True))
    op.drop_column("contact_leads", "notes")

    # lead_meetings — one per scheduled prospect meeting.
    op.create_table(
        "lead_meetings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lead_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("held_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("agenda", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_name", sa.String(200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_name", sa.String(200), nullable=True),
        sa.ForeignKeyConstraint(
            ["lead_id"], ["contact_leads.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"], ["users.id"], ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_lead_meetings_lead_id", "lead_meetings", ["lead_id"],
    )

    # lead_notes — freeform timestamped notes on a lead.
    op.create_table(
        "lead_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lead_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_name", sa.String(200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["lead_id"], ["contact_leads.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lead_notes_lead_id", "lead_notes", ["lead_id"])


def downgrade() -> None:
    op.drop_index("ix_lead_notes_lead_id", table_name="lead_notes")
    op.drop_table("lead_notes")
    op.drop_index("ix_lead_meetings_lead_id", table_name="lead_meetings")
    op.drop_table("lead_meetings")
    op.add_column("contact_leads", sa.Column("notes", sa.Text(), nullable=True))
    op.drop_column("contact_leads", "referred_by")
    op.drop_column("contact_leads", "source")
