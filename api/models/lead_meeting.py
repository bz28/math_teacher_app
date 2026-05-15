"""Lead meeting model — one row per scheduled meeting with a prospect.

A meeting is in one of four derived states (computed in the API
response, not stored):
- upcoming: scheduled_at is in the future, not cancelled, not held
- past_unmarked: scheduled_at is in the past, not cancelled, not held
  → operator needs to either mark it held or cancel it
- held: held_at is set
- cancelled: cancelled_at is set
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class LeadMeeting(Base):
    __tablename__ = "lead_meetings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("contact_leads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # demo / follow_up / onboarding / other — validated at the route
    # layer (matches the existing pattern for lead.status).
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    held_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    agenda: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    updated_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
