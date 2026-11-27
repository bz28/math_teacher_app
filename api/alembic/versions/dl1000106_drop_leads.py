"""drop contact_leads, lead_notes and lead_meetings.

The console's Leads pages were a sales notebook (14 leads, 2 notes, 2
meetings in prod), exported to a table in Ben's Blob Space on Nov 26, 2026.
The website contact form still emails the admins; it no longer keeps a
copy here. Children first: notes and meetings reference contact_leads.

Downgrade recreates all three empty, as prod had them — the dropped rows
are not restored (the export is their home).

Revision ID: dl1000106
Revises: dm1000106
"""
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "dl1000106"
down_revision: str | None = "dm1000106"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Indexes and foreign keys go with their tables.
    op.drop_table("lead_notes")
    op.drop_table("lead_meetings")
    op.drop_table("contact_leads")


def _by(column: str, fk_name: str | None = None) -> sa.Column[Any]:
    """A nullable 'who did it' column pointing at users."""
    return sa.Column(
        column, sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="SET NULL", name=fk_name), nullable=True,
    )


def _created_at() -> sa.Column[Any]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True),
        server_default=sa.func.now(), nullable=False,
    )


def _lead_id() -> sa.Column[Any]:
    return sa.Column(
        "lead_id", sa.UUID(as_uuid=True),
        sa.ForeignKey("contact_leads.id", ondelete="CASCADE"), nullable=False,
    )


def downgrade() -> None:
    op.create_table(
        "contact_leads",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_name", sa.String(length=200), nullable=False),
        sa.Column("contact_name", sa.String(length=200), nullable=False),
        sa.Column("contact_email", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="teacher"),
        sa.Column("approx_students", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="new"),
        _created_at(),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        _by("updated_by_id", "fk_contact_leads_updated_by"),
        sa.Column("updated_by_name", sa.String(length=200), nullable=True),
        sa.Column(
            "school_id", sa.UUID(as_uuid=True),
            sa.ForeignKey("schools.id", ondelete="SET NULL", name="fk_contact_leads_school"),
            nullable=True,
        ),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="inbound_form"),
        sa.Column("referred_by", sa.Text(), nullable=True),
    )

    op.create_table(
        "lead_meetings",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        _lead_id(),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("held_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("agenda", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        _created_at(),
        _by("created_by_id"),
        sa.Column("created_by_name", sa.String(length=200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        _by("updated_by_id"),
        sa.Column("updated_by_name", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_lead_meetings_lead_id", "lead_meetings", ["lead_id"])

    op.create_table(
        "lead_notes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        _lead_id(),
        sa.Column("body", sa.Text(), nullable=False),
        _created_at(),
        _by("created_by_id"),
        sa.Column("created_by_name", sa.String(length=200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_lead_notes_lead_id", "lead_notes", ["lead_id"])
